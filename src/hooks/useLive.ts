import { useCallback, useEffect, useRef, useState } from 'react';

import type { AsyncState } from './useAsync';

/**
 * A screen that keeps itself up to date.
 *
 * Deliberately the same shape as `useAsync`, so converting a screen from one
 * to the other is a change of hook and nothing else — the loading skeleton,
 * the empty state, the error retry and pull-to-refresh all keep working
 * untouched. That matters more than it sounds: the alternative is rewriting
 * every list screen to a different contract, and a change that large gets made
 * carelessly or not at all.
 *
 * WHEN TO USE THIS RATHER THAN useAsync. Where somebody else's action should
 * show up without the reader doing anything: a lesson a teacher publishes, an
 * event an admin adds, a mark that has just been released. Not for data only
 * its owner can change — a profile form has nobody else editing it, and a
 * listener there costs a connection to watch for a change that cannot come.
 *
 * WHAT IT COSTS. A listener is charged one document read per document it
 * receives, the same as fetching the list once, and then one more per document
 * that actually changes. For lists that change rarely, that is cheaper than
 * somebody pulling to refresh. It is NOT free on a list that changes
 * constantly, and it holds an open connection while the screen is mounted.
 *
 * `reload` and `refresh` are kept for the same interface but resolve straight
 * away: the data is already current, and there is nothing to fetch.
 */
export function useLive<T>(
  /**
   * Starts the subscription and returns its unsubscribe function.
   *
   * Called again whenever `deps` change, and the previous subscription is
   * always torn down first — a screen that switches class must not keep
   * receiving the old one.
   */
  subscribe: (onNext: (value: T) => void, onError: (error: unknown) => void) => () => void,
  deps: React.DependencyList = [],
  options: { enabled?: boolean } = {}
): AsyncState<T> {
  const enabled = options.enabled !== false;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<unknown>(null);

  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    let live = true;
    setLoading(true);

    const stop = subscribeRef.current(
      (value) => {
        if (!live) return;
        setData(value);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (!live) return;
        // The last good data is KEPT. A listener that drops — a network blip,
        // a token being refreshed — should not blank a screen somebody is
        // reading. The error is exposed so a screen can say something if it
        // has nothing to show yet.
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      live = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  const noop = useCallback(async () => {
    // Nothing to do: the subscription is already delivering the current state.
    // Kept so pull-to-refresh and retry buttons need no special case.
  }, []);

  return {
    data,
    loading,
    refreshing: false,
    error,
    reload: noop,
    refresh: noop,
    setData,
  };
}
