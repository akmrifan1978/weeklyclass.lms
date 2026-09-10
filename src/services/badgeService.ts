import { Platform } from 'react-native';

/**
 * The count on the app icon, outside the app.
 *
 * WHAT THIS USES. The Badging API — `navigator.setAppBadge` — which is the only
 * way a web app can mark its own icon. It works on an INSTALLED app: Chrome and
 * Edge on Android and desktop, and Safari on iOS since 16.4. In an ordinary
 * browser tab there is no icon to badge and the call does nothing, which is the
 * correct outcome rather than a failure.
 *
 * WHAT IT CANNOT DO. Nothing here can override a person's notification
 * settings. If badges are switched off for this app in the operating system, or
 * the app was never added to the home screen, no count appears — and that is
 * the person's decision, not a bug to work around.
 *
 * EVERY CALL IS SWALLOWED. A badge is a nicety; an app that crashes because an
 * icon could not be marked has traded something valuable for something trivial.
 */

type BadgeCapable = {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

function api(): BadgeCapable | null {
  if (Platform.OS !== 'web') return null;
  if (typeof navigator === 'undefined') return null;
  const candidate = navigator as unknown as BadgeCapable;
  return typeof candidate.setAppBadge === 'function' ? candidate : null;
}

/** Whether this device can show a count on the icon at all. */
export function badgesSupported(): boolean {
  return api() !== null;
}

/**
 * Puts `count` on the icon, or takes the badge off when it is zero.
 *
 * Zero is cleared rather than shown, because a badge reading "0" is worse than
 * no badge: it draws the eye to say there is nothing to see.
 */
export async function setBadge(count: number): Promise<void> {
  const badge = api();
  if (!badge) return;

  try {
    if (count > 0) await badge.setAppBadge?.(count);
    else await badge.clearAppBadge?.();
  } catch {
    // Unsupported, denied, or not installed. All three mean "no badge", and
    // none of them is worth surfacing to somebody reading their lessons.
  }

  // And told to the service worker, which keeps its own running count for the
  // pushes that arrive while the app is closed. The app is the authority — it
  // is the one watching the inbox — so this overwrites whatever the worker had.
  tellWorker(count);
}

/** Hands the true count to the service worker. Silent when there is none. */
function tellWorker(count: number): void {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'badge', count });
  } catch {
    // No worker, or not controlled yet on a first load. The worker's own count
    // is corrected the next time this runs.
  }
}

/** Takes the badge off entirely. Used on sign-out. */
export async function clearBadge(): Promise<void> {
  const badge = api();
  if (!badge) return;
  try {
    await badge.clearAppBadge?.();
  } catch {
    // As above.
  }
  tellWorker(0);
}
