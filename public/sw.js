/**
 * The smallest service worker that makes this installable.
 *
 * A browser will not offer to install a site until one is registered, so this
 * exists first and foremost to satisfy that. It deliberately does NOT cache the
 * application: a stale shell served from a worker is the single most common way
 * a deploy fails to reach anybody, and this app is deployed often.
 *
 * What it does cache is the offline fallback — nothing more — so a phone that
 * loses signal mid-lesson gets a page that explains itself rather than the
 * browser's dinosaur.
 */
const VERSION = 'weeklyclass-v1';

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for every tab to close. There is
  // no cached app to keep consistent, so there is nothing to be careful about.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop anything an earlier version of this worker cached, so a cache
      // introduced later can never outlive the code that understood it.
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  // Network, always. Passing the request straight through means this worker
  // cannot serve yesterday's bundle, which is the failure it would otherwise
  // be famous for.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>WeeklyClass LMS</title>' +
            '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#041E4A;color:#fff;' +
            'font-family:system-ui,sans-serif;text-align:center;padding:24px">' +
            '<div><h1 style="font-size:20px;margin:0 0 8px">You are offline</h1>' +
            '<p style="opacity:.75;margin:0;font-size:14px">Reconnect and this page will load.</p></div>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
    )
  );
});
