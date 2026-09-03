import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A read-through cache for anything the app fetches.
 *
 * WHY THIS EXISTS. Firestore's own offline persistence is only available on web
 * here: it is built on IndexedDB, which React Native has no equivalent of, so
 * `src/firebase/config.ts` falls back to an in-memory cache on a phone. That
 * cache dies with the process, which means the platform's own offline support is
 * exactly absent on the devices where being offline is most likely.
 *
 * So the app keeps its own. Every list this cache wraps is written to
 * AsyncStorage after a successful read, and served from there when the network
 * fails. The result is an app that opens to yesterday's lessons on a train
 * rather than to an error screen.
 *
 * What this deliberately does NOT do is queue writes. Marking attendance while
 * offline and having it appear to succeed, then silently fail or land hours
 * later against changed data, is worse than being told plainly that the write
 * needs a connection. Reads degrade; writes refuse.
 */

const PREFIX = '@weeklyclass/cache/';

/** Written alongside the payload so staleness can be reported honestly. */
interface Entry<T> {
  data: T;
  savedAt: string;
}

export interface CachedResult<T> {
  data: T;
  /** True when the network failed and this came from storage. */
  fromCache: boolean;
  /** When the cached copy was taken. Null for a fresh read. */
  savedAt: Date | null;
}

export async function readCache<T>(key: string): Promise<CachedResult<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    return { data: entry.data, fromCache: true, savedAt: new Date(entry.savedAt) };
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: Entry<T> = { data, savedAt: new Date().toISOString() };
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // A cache that cannot be written is a missing optimisation, not an error.
  }
}

/**
 * Runs `fetcher`, caching what comes back; falls back to the cache when it
 * throws.
 *
 * The fallback is deliberately not limited to network errors. A permission
 * denial while offline, a timeout, a malformed response on a captive-portal
 * wifi — from the reader's point of view these are all "it did not load", and
 * showing what they had a moment ago is the right answer to all of them. If
 * there is nothing cached, the original error propagates unchanged.
 */
export async function cached<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<CachedResult<T>> {
  try {
    const data = await fetcher();
    void writeCache(key, data);
    return { data, fromCache: false, savedAt: null };
  } catch (error) {
    const fallback = await readCache<T>(key);
    if (fallback) {
      console.info(`[WeeklyClass] serving "${key}" from the offline cache`);
      return fallback;
    }
    throw error;
  }
}

/** Clears everything cached. Used when signing out on a shared device. */
export async function clearCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(PREFIX));
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    // ignore
  }
}
