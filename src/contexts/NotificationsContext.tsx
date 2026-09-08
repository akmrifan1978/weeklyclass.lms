import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { watchInbox, unreadCount } from '@/services/notificationService';
import { createDeviceNotifier } from '@/services/deviceNotify';
import type { AppNotification } from '@/types';

/**
 * One live subscription to this person's notifications, for the whole app.
 *
 * WHY IT IS SHARED. Three places want the same data: the inbox screen, the
 * unread badge on the tab bar, and the code that raises notifications on the
 * device. Each used to answer for itself — the screen fetched on mount, the
 * badge polled every two minutes, the notifier held listeners of its own. An
 * inbox is four or five queries, because Firestore cannot OR across fields, so
 * that was fifteen listeners and a poll costing five reads whether or not
 * anything had happened. One subscription, and everything derives from it.
 *
 * WHY IT IS LIVE. A deleted notification has to leave the reader's list at the
 * moment it is deleted, not the next time they happen to pull to refresh. A
 * notice about a cancelled class that goes on standing is worse than no notice.
 * Deletion is a soft delete, so the listener simply stops matching the row and
 * it disappears — from the list, from the badge, and from the device.
 *
 * It cannot come back. `deleted` is a field on the document, not a piece of
 * local state, so a refresh, a sign out and back in, or a second device all
 * read the same answer.
 */

interface NotificationsValue {
  items: AppNotification[];
  unread: number;
  loading: boolean;
  error: unknown;
  /** Re-subscribes. The only meaningful retry for a live query. */
  reload: () => void;
}

const NotificationsContext = createContext<NotificationsValue>({
  items: [],
  unread: 0,
  loading: true,
  error: null,
  reload: () => undefined,
});

/** How much history the inbox holds. Beyond this is the archive nobody reads. */
const PAGE_SIZE = 40;

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid;

  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // Held across renders so its baseline and its record of what has already been
  // announced survive; rebuilt only when the person changes.
  const notifier = useRef(createDeviceNotifier());

  useEffect(() => {
    if (!user || !uid) {
      notifier.current.reset();
      setItems([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError(null);
    notifier.current.reset();

    const stop = watchInbox(
      user,
      (next) => {
        setItems(next);
        setLoading(false);
        setError(null);
        notifier.current.sync(next, uid);
      },
      {
        pageSize: PAGE_SIZE,
        onError: (listenerError) => {
          setError(listenerError);
          setLoading(false);
        },
      }
    );

    return stop;
    // Keyed on the uid rather than the user object: the profile document
    // changes on every read of it, and rebuilding five listeners each time
    // would be a quiet waste of the free quota.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, attempt]);

  const value = useMemo<NotificationsValue>(
    () => ({
      items,
      unread: uid ? unreadCount(items, uid) : 0,
      loading,
      error,
      reload: () => setAttempt((n) => n + 1),
    }),
    [items, uid, loading, error]
  );

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsValue {
  return useContext(NotificationsContext);
}
