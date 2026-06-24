// Service worker for the Colorado Snow PWA.
// Bump VERSION on each deploy so clients pick up the new app shell on next launch.
const VERSION = "cosnow-v2";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  // Precache the app shell, then activate immediately (don't wait for old tabs to close).
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  // Drop caches from older versions, then take control of open pages right away.
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  // App page: network-first so a redeploy lands immediately; fall back to cached shell when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put("./index.html", copy)); return r; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  const dest = req.destination;

  // Map tiles / images: straight to network, fall back to cache only if we happen to have it (avoid bloat).
  if (dest === "image") {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Libraries (Leaflet CSS/JS/fonts): cache-first, refresh in the background.
  if (dest === "script" || dest === "style" || dest === "font") {
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(r => {
        const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return r;
      }))
    );
    return;
  }

  // Weather/data API (fetch calls): network-first, cache the last good response for offline viewing.
  e.respondWith(
    fetch(req)
      .then(r => { if (r && r.status === 200) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; })
      .catch(() => caches.match(req))
  );
});
