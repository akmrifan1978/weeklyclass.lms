import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { clearQueryCache } from '@/services/firestore';
import type { Cursor, Page } from '@/services/firestore';

/**
 * Standard async-screen state: data, loading, error, retry, refresh.
 *
 * Every list and detail screen in the app uses one of these two hooks, which is
 * what makes loading skeletons, empty states and retry buttons consistent
 * without repeating the plumbing.
 */

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: unknown;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
  setData: (value: T | null) => void;
}

export function useAsync<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList = [],
  options: { enabled?: boolean } = {}
): AsyncState<T> {
  const enabled = options.enabled !== false;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (isRefresh: boolean) => {
      if (!enabled) {
        setLoading(false);
        return;
      }
      // Pulling to refresh is a request for the server's answer, not the one
      // this screen was given half a minute ago. See the cache in firestore.ts.
      if (isRefresh) {
        clearQueryCache();
        setRefreshing(true);
      } else setLoading(true);
      setError(null);
      try {
        const value = await loaderRef.current();
        if (mounted.current) setData(value);
      } catch (err) {
        if (mounted.current) setError(err);
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [enabled]
  );

  useEffect(() => {
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  useRefreshOnReturn(() => void run(true));

  return {
    data,
    loading,
    refreshing,
    error,
    reload: () => run(false),
    refresh: () => run(true),
    setData,
  };
}

/**
 * COMING BACK TO A SCREEN SHOWS WHAT IS THERE NOW.
 *
 * A screen in a stack is not unmounted when you move off it, so returning to
 * it ran no query at all: the list you were shown could be an hour old, and the
 * student who registered in the meantime was simply absent. The report was
 * "students are supposed to update automatically", and it was right.
 *
 * So returning to a screen reloads it - but only after half a minute away,
 * because stepping into a record and straight back out is the commonest
 * movement in the app and should not cost a round trip every time. The reload
 * goes through the refresh path, which clears the query cache first, so what
 * comes back is the server's answer and not the one from a moment ago.
 */
const REFRESH_AFTER_MS = 30_000;

function useRefreshOnReturn(reload: () => void): void {
  const left = useRef<number | null>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useFocusEffect(
    useCallback(() => {
      const away = left.current;
      if (away !== null && Date.now() - away >= REFRESH_AFTER_MS) reloadRef.current();
      left.current = null;
      return () => {
        left.current = Date.now();
      };
    }, [])
  );
}

export interface PaginatedState<T> {
  items: T[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: unknown;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
  /** Removes an item locally after a delete, without a round trip. */
  removeLocal: (id: string) => void;
}

/**
 * Cursor-based pagination over `listPage`. Nothing in the app ever loads a
 * whole collection, so this is the only list-loading primitive.
 */
export function usePaginated<T extends { id: string }>(
  fetchPage: (cursor: Cursor) => Promise<Page<T>>,
  deps: React.DependencyList = [],
  options: { enabled?: boolean } = {}
): PaginatedState<T> {
  const enabled = options.enabled !== false;
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cursor = useRef<Cursor>(null);
  const mounted = useRef(true);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadFirst = useCallback(
    async (isRefresh: boolean) => {
      if (!enabled) {
        setLoading(false);
        setItems([]);
        return;
      }
      // As above: a pull to refresh bypasses the query cache entirely.
      if (isRefresh) {
        clearQueryCache();
        setRefreshing(true);
      } else setLoading(true);
      setError(null);
      try {
        const page = await fetchRef.current(null);
        if (!mounted.current) return;
        setItems(page.items);
        cursor.current = page.cursor;
        setHasMore(page.hasMore);
      } catch (err) {
        if (mounted.current) setError(err);
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [enabled]
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading || !cursor.current) return;
    setLoadingMore(true);
    try {
      const page = await fetchRef.current(cursor.current);
      if (!mounted.current) return;
      // De-duplicate: a document edited between pages can otherwise repeat.
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...page.items.filter((item) => !seen.has(item.id))];
      });
      cursor.current = page.cursor;
      setHasMore(page.hasMore);
    } catch (err) {
      if (mounted.current) setError(err);
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }, [hasMore, loading, loadingMore]);

  useEffect(() => {
    cursor.current = null;
    void loadFirst(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  // As above: a list you walk back to shows what is there now, not what was
  // there when you first opened it.
  useRefreshOnReturn(() => {
    cursor.current = null;
    void loadFirst(true);
  });

  return {
    items,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    error,
    loadMore,
    refresh: () => loadFirst(true),
    reload: () => loadFirst(false),
    removeLocal: (id: string) => setItems((previous) => previous.filter((i) => i.id !== id)),
  };
}

/** Debounces a value — used by search boxes so typing does not hit Firestore. */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
