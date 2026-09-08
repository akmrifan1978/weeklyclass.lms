/**
 * The service worker that makes this usable with no connection at all.
 *
 * It used to cache nothing on purpose, and that was the right call at the time:
 * a stale shell served from a worker is the commonest way a deploy fails to
 * reach anybody, and this app is deployed often. What changed is that the
 * hosting cache headers were fixed — HTML now goes out `no-cache` and the
 * hashed bundles go out `immutable` — so the two kinds of file can finally be
 * treated as the different things they are:
 *
 *   /_expo/** and /assets/** carry a content hash in the filename. A given URL
 *   can never mean anything else, so serving it from the cache forever is not
 *   staleness, it is the whole point of the hash.
 *
 *   The HTML shell is fetched from the network first, every time, and only
 *   falls back to the cached copy when the network cannot answer. So an online
 *   visit always gets the newest build, and an offline one gets the last build
 *   that worked instead of the browser's dinosaur.
 *
 * NOTHING ELSE IS CACHED, and that exclusion is load-bearing. Firestore's own
 * requests carry authentication and are already cached properly by the SDK in
 * IndexedDB; a service worker replaying them from its own cache would serve one
 * student another student's answer. So only same-origin static assets are ever
 * stored here.
 */
/**
 * The build this worker belongs to.
 *
 * THIS LINE IS REWRITTEN AT EXPORT TIME by scripts/stamp-sw.js, and everything
 * about updating an installed app depends on it changing.
 *
 * A browser decides whether to install a new worker by comparing the bytes of
 * sw.js with the copy it already has. This file used to be identical in every
 * deploy, so `registration.update()` fetched it, found nothing new, and stopped
 * there: no new worker, no `controllerchange`, and so the reload that picks up
 * the new bundle never happened. The app asked for updates perfectly and had
 * no way to notice one had arrived.
 *
 * The stamp is the entry bundle's content hash, not a timestamp, so the bytes
 * change when the app changes and not when it is merely redeployed — a deploy
 * of identical code does not reload anybody's phone for nothing.
 */
const BUILD = 'dev';
const VERSION = 'weeklyclass-' + BUILD;
const SHELL = '/index.html';

const OFFLINE_PAGE =
  '<!doctype html><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>WeeklyClass LMS</title>' +
  '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#041E4A;color:#fff;' +
  'font-family:system-ui,sans-serif;text-align:center;padding:24px">' +
  '<div><h1 style="font-size:20px;margin:0 0 8px">You are offline</h1>' +
  '<p style="opacity:.75;margin:0;font-size:14px">Open the app again once you have a connection.</p></div>';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Pull the shell in immediately so the very first offline visit works,
      // rather than only after the user has happened to load the app online
      // once since this worker took over.
      const cache = await caches.open(VERSION);
      await cache.add(new Request(SHELL, { cache: 'reload' })).catch(() => undefined);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Anything an earlier version cached is dropped, so a cache can never
      // outlive the code that understood its contents.
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

/** True for the content-hashed files it is always safe to serve from cache. */
function isImmutableAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/_expo/') ||
      url.pathname.startsWith('/assets/') ||
      url.pathname === '/favicon.ico' ||
      url.pathname === '/manifest.json')
  );
}

/**
 * A notification arriving while the app is closed.
 *
 * This is the whole point of push: the phone shows it on the lock screen, in
 * the shade and on the app icon, whether or not the app is running. Everything
 * the app itself puts in its Notification Centre already worked; none of it
 * ever left the app.
 *
 * The payload is JSON the sender composed. It is parsed defensively — a push
 * that arrives malformed must still show something, because a browser that is
 * handed a push and shows nothing at all is required to show its own "this
 * site has been updated in the background" notice instead, which is worse than
 * anything we could write.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'WeeklyClass LMS';

  const options = {
    body: payload.body || '',
    // The app's own mark, so the notification is recognisably from this app
    // among a dozen others in the shade.
    icon: payload.icon || '/icons/icon-192.png',
    // Android draws this as a white silhouette in the status bar. Passing the
    // full-colour logo here gets a white blob.
    badge: '/icons/badge-96.png',
    // The large picture, where the thing being announced has one — a lesson's
    // cover, an event's banner.
    image: payload.image || undefined,
    // Same tag replaces rather than stacks, so three edits to one lesson do
    // not become three notifications about it.
    tag: payload.tag || 'weeklyclass',
    /*
     * True, and reverted from false deliberately.
     *
     * Setting it false was meant to stop a second buzz when the pushed copy
     * replaces the one the app had already shown. But de-duplication was
     * already solved by giving both paths the same per-notification tag; this
     * was belt on top of braces, and iOS appears to take it as licence to
     * deliver the whole notification silently — which is indistinguishable
     * from push being broken, and was reported as exactly that.
     *
     * A notification that alerts twice in the rare case of both paths landing
     * is a far smaller fault than one that never alerts at all.
     */
    renotify: true,
    timestamp: payload.timestamp || Date.now(),
    requireInteraction: false,
    data: { route: payload.route || '/', id: payload.id || null },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);

      // The count on the app icon, where the platform supports it.
      if (typeof payload.badgeCount === 'number' && 'setAppBadge' in self.navigator) {
        await self.navigator.setAppBadge(payload.badgeCount).catch(() => undefined);
      }
    })()
  );
});

/**
 * Tapping the notification.
 *
 * An already-open window is focused and told where to go rather than a second
 * copy of the app being opened — somebody who taps a notification expects to
 * land in the app they already had, not a duplicate of it.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = (event.notification.data && event.notification.data.route) || '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        // The app routes on this message; posting is what lets a focused
        // window navigate without being reloaded out from under the reader.
        client.postMessage({ type: 'notification-open', route });
        return;
      }

      await self.clients.openWindow(route);
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is ever cacheable, and a request that opts out of the cache is
  // asking for the network for a reason.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // The page itself: network first, cache second, explanation last.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // Keep the newest shell for the next time there is no network. Only
          // a real answer is stored — caching a 404 or a captive-portal login
          // page would make the app unopenable until the cache was cleared.
          if (fresh && fresh.ok) {
            const cache = await caches.open(VERSION);
            await cache.put(SHELL, fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await caches.match(SHELL);
          return (
            cached ??
            new Response(OFFLINE_PAGE, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
      })()
    );
    return;
  }

  // Hashed assets: cache first. The filename is the version, so a hit is never
  // stale and a miss is fetched once and kept.
  if (isImmutableAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const fresh = await fetch(request);
        if (fresh && fresh.ok && fresh.type === 'basic') {
          const cache = await caches.open(VERSION);
          await cache.put(request, fresh.clone());
        }
        return fresh;
      })()
    );
    return;
  }

  // Everything else — Firestore, Cloudinary, fonts, the translation service —
  // goes straight to the network and is never stored. See the note at the top:
  // these carry credentials or per-user data and are not this worker's to keep.
});
