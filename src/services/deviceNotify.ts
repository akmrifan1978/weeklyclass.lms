import { Platform } from 'react-native';

import * as notificationService from './notificationService';
import type { AppNotification, AppUser } from '@/types';

/**
 * Raising a real notification on the phone, with no server anywhere.
 *
 * WHAT WAS MISSING AND WHY. Everything the app wrote went into its own
 * Notification Centre, which only exists while somebody is looking at it. The
 * lock-screen kind needs the Web Push protocol, and Web Push needs a private
 * key, and a private key cannot live in an app every student can read — so it
 * needs a sender running somewhere. On the free plan there is no server to run
 * it on, and until somebody runs `scripts/send-push.js` by hand, nothing
 * reaches a device at all. Measured: of the last eight notifications, three
 * were never even attempted.
 *
 * But the whole apparatus is only needed when the app is CLOSED. While it is
 * open — or merely in the background, which is most of the day on a phone —
 * the page is alive, its Firestore listener fires the instant a notification is
 * written, and the service worker it already registered can show a notification
 * directly. No key, no sender, no server, nothing to run and nothing to pay
 * for.
 *
 * So this covers everything except a fully killed app, immediately and for
 * free. Push remains the answer for the killed case and is unaffected by this;
 * the two are complementary and the tag makes them collapse into one notice
 * rather than arriving twice.
 *
 * PLATFORMS. Web only. Native builds already receive Expo push, which is a
 * different and better path — see `pushService`. On iOS the app must have been
 * added to the Home Screen for notifications to be permitted at all; that is
 * Apple's rule for web apps, not a choice made here.
 *
 * It never asks for permission. Being asked out of nowhere is how people learn
 * to say no, and the answer is remembered. The request belongs to the switch in
 * Profile, which the person went looking for.
 */

/** Ids already raised, so a reload does not announce yesterday again. */
const SEEN_KEY = '@weeklyclass/notify/seen';
/** Enough to cover any plausible backlog; small enough to keep in storage. */
const SEEN_LIMIT = 200;

function canNotify(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted' &&
    'serviceWorker' in navigator
  );
}

function readSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    // A private window, or storage switched off. Then nothing is remembered
    // across reloads, which is worse than remembering but far better than
    // failing to start.
    return new Set();
  }
}

function writeSeen(seen: Set<string>): void {
  try {
    window.localStorage.setItem(
      SEEN_KEY,
      JSON.stringify(Array.from(seen).slice(-SEEN_LIMIT))
    );
  } catch {
    // Not worth failing a notification over.
  }
}

async function raise(item: AppNotification): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();

  const options: NotificationOptions & { image?: string; renotify?: boolean } = {
    body: item.message ?? '',
    icon: '/icons/icon-192.png',
    // Android draws this as a white silhouette; the full-colour logo becomes a
    // white blob.
    badge: '/icons/badge-96.png',
    image: item.image ?? undefined,
    // The same tag the pushed copy uses, so if both arrive the second replaces
    // the first instead of the phone showing the same thing twice.
    tag: item.category ?? 'general',
    data: { route: item.route ?? '/', id: item.id },
  };

  if (registration) {
    await registration.showNotification(item.title ?? 'WeeklyClass LMS', options);
    return;
  }

  // No worker — a browser tab that never registered one. A page notification
  // still shows, it just cannot be clicked through to a route.
  new Notification(item.title ?? 'WeeklyClass LMS', options);
}

/**
 * Watches this person's inbox and announces anything new on the device.
 *
 * Returns a function that stops it. The first delivery is treated as the
 * baseline and announces nothing: everything already in the inbox when the app
 * opens is history, and a phone that buzzes twelve times on launch is a phone
 * whose notifications get switched off.
 */
export function startDeviceNotifications(user: AppUser): () => void {
  if (!canNotify()) return () => undefined;

  const seen = readSeen();
  let baselineTaken = false;

  const stop = notificationService.watchInbox(
    user,
    (items) => {
      if (!baselineTaken) {
        baselineTaken = true;
        for (const item of items) seen.add(item.id);
        writeSeen(seen);
        return;
      }

      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        // Not announced back to whoever just sent it. An admin pressing Send
        // does not need their own phone to tell them they pressed Send.
        if (item.createdBy === user.uid) continue;
        void raise(item).catch(() => undefined);
      }
      writeSeen(seen);
    },
    {
      // A listener that dies takes the notifications with it silently, so the
      // failure is at least recorded where the console will show it.
      onError: (error) => console.warn('[notify] inbox listener stopped', error),
    }
  );

  return stop;
}
