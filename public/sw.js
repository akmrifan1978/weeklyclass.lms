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
const VERSION = 'weeklyclass-v2';
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
