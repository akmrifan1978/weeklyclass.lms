import { Platform } from 'react-native';

import type { AppNotification } from '@/types';

/**
 * Raising — and withdrawing — notifications on the device, with no server.
 *
 * WHAT WAS MISSING AND WHY. Everything the app wrote went into its own
 * Notification Centre, which only exists while somebody is looking at it. The
 * lock-screen kind needs the Web Push protocol, and Web Push needs a private
 * key, and a private key cannot live in an app every student can read — so it
 * needs a sender running somewhere. On the free plan there is no server to run
 * it on. Measured against the live database: of the last eight notifications,
 * three were never even attempted.
 *
 * But that apparatus is only needed when the app is CLOSED. While it is open,
 * or merely backgrounded — most of the day, on a phone — the page is alive, its
 * listener sees the write immediately, and the service worker it already
 * registered can raise the notification itself. No key, no sender, no server.
 *
 * WITHDRAWING matters as much as raising. A notification an admin has deleted
 * must not go on sitting in somebody's shade as though it still stood; that is
 * how a cancelled class gets attended. When one leaves the inbox, the copy on
 * the device is closed.
 *
 * PLATFORMS. Web only. Native builds receive Expo push, a different and better
 * path — see `pushService`. On iOS the app must have been added to the Home
 * Screen for notifications to be permitted at all; that is Apple's rule for web
 * apps, not a choice made here.
 *
 * It never asks for permission. Being asked out of nowhere is how people learn
 * to say no, and the answer is remembered. The asking belongs to the switch the
 * person went looking for.
 */

/** Ids already raised, so a reload does not announce yesterday again. */
const SEEN_KEY = '@weeklyclass/notify/seen';
/** Enough for any plausible backlog, small enough to keep in storage. */
const SEEN_LIMIT = 200;

export interface DeviceNotifier {
  /** Feed the current inbox. Announces what is new, withdraws what has gone. */
  sync: (items: AppNotification[], selfUid: string) => void;
  /** Forget everything — a different person is signing in on this device. */
  reset: () => void;
}

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
    // A private window, or site data switched off. Nothing is then remembered
    // across reloads — worse than remembering, far better than not starting.
    return new Set();
  }
}

function writeSeen(seen: Set<string>): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-SEEN_LIMIT)));
  } catch {
    // Not worth failing a notification over.
  }
}

async function raise(item: AppNotification): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();

  const options: NotificationOptions & { image?: string } = {
    body: item.message ?? '',
    icon: '/icons/icon-192.png',
    // Android draws this as a white silhouette; the full-colour logo becomes a
    // white blob.
    badge: '/icons/badge-96.png',
    image: item.image ?? undefined,
    // The id, not the category. The pushed copy of the same notification uses
    // the same tag, so if both arrive the second replaces the first rather than
    // the phone showing one thing twice — and a tag per notification is what
    // makes withdrawing a single one possible.
    tag: `note:${item.id}`,
    data: { route: item.route ?? `/notifications?open=${item.id}`, id: item.id },
  };

  if (registration) {
    await registration.showNotification(item.title ?? 'WeeklyClass LMS', options);
    return;
  }

  // No worker — a browser tab that never registered one. A page notification
  // still shows; it just cannot be clicked through to a route.
  new Notification(item.title ?? 'WeeklyClass LMS', options);
}

/** Closes any notification still on screen for these ids. */
async function withdraw(ids: Set<string>): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const shown = await registration.getNotifications();
  for (const notification of shown) {
    const id = (notification.data as { id?: string } | undefined)?.id;
    if (id && ids.has(id)) notification.close();
  }
}

export function createDeviceNotifier(): DeviceNotifier {
  let seen: Set<string> | null = null;
  let previous = new Set<string>();
  let baselineTaken = false;

  const reset = () => {
    seen = null;
    previous = new Set();
    baselineTaken = false;
  };

  const sync = (items: AppNotification[], selfUid: string) => {
    if (!canNotify()) return;
    if (!seen) seen = readSeen();

    const current = new Set(items.map((item) => item.id));

    // The first delivery is the baseline. Everything already in the inbox when
    // the app opens is history, and a phone that buzzes twelve times on launch
    // is a phone whose notifications get switched off.
    if (!baselineTaken) {
      baselineTaken = true;
      for (const id of current) seen.add(id);
      previous = current;
      writeSeen(seen);
      return;
    }

    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      // Not announced back to whoever just sent it. An admin pressing Send
      // does not need their own phone to tell them they pressed Send.
      if (item.createdBy === selfUid) continue;
      void raise(item).catch(() => undefined);
    }

    // Gone from the inbox — deleted by an admin, or cancelled. Anything of that
    // id still showing on the device is withdrawn.
    //
    // An item could in principle also leave by falling off the end of the page
    // as newer ones arrive. Closing an old notification in that case is
    // harmless, and far less harmful than the alternative it guards against:
    // a deleted notice left standing on a lock screen.
    const removed = new Set([...previous].filter((id) => !current.has(id)));
    if (removed.size > 0) void withdraw(removed).catch(() => undefined);

    previous = current;
    writeSeen(seen);
  };

  return { sync, reset };
}
