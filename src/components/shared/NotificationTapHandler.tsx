import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { notificationsRoute, routeForRole } from '@/services/notificationRoutes';

/**
 * Opens what a tapped phone notification is about, when the app is already open.
 *
 * The service worker handles the tap. With no window open it opens one at the
 * notification's page; with the app already open it brings it to the front and
 * posts a "notification-open" message saying where to go — and nothing in the
 * app was listening for that message. So tapping a notification while the app
 * was open, or running in the background, only brought the app forward.
 *
 * The page is translated into the reader's own section first (see
 * notificationRoutes), and a notification with no page opens the inbox.
 *
 * Draws nothing.
 */
export function NotificationTapHandler() {
  const router = useRouter();
  const { user } = useAuth();
  const role = useRef(user?.role);
  role.current = user?.role;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.serviceWorker) {
      return undefined;
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; route?: string } | null;
      if (!data || data.type !== 'notification-open') return;
      const to = routeForRole(data.route, role.current) ?? notificationsRoute(role.current);
      router.push(to as never);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);

  return null;
}
