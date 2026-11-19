const CACHE = "og-sabha-v14";
// Missing files are skipped (the JSON may live in data/ or in the main folder), so one 404 cannot break the install.
const FILES = ["./", "index.html", "classes.html", "bus.html", "bus-timings.html", "wall.html", "gigs.html", "about.html", "mess-menu.html", "timetable.html",
  "manifest.webmanifest", "images/vagamon-forest.webp", "icons/favicon.ico", "icons/favicon-32.png", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png",
  "data/menu.json", "data/timetable.json", "data/bus.json", "menu.json", "timetable.json", "bus.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(FILES.map((f) => c.add(f)))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
    // lets the browser start the page request while this worker wakes up
    self.registration.navigationPreload ? self.registration.navigationPreload.enable() : null
  ]).then(() => self.clients.claim()));
});

const keep = (req, res) => {
  if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
  return res;
};

// style.css?v=... and app.js?v=... change their address whenever their content changes (build_pages.py stamps them),
// so a cached copy is always the right one: serve it straight from the cache.
// Pages and JSON are network first, with the cache as the offline fallback, so menu updates always arrive.
// Only same-origin GET requests are handled, so Firebase, fonts and auth calls are left alone.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/__/")) return;

  if (url.search.startsWith("?v=")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => keep(req, res))));
    return;
  }

  e.respondWith((async () => {
    try {
      const pre = e.preloadResponse ? await e.preloadResponse : null;
      return keep(req, pre || (await fetch(req)));
    } catch {
      const hit = await caches.match(req);
      return hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error());
    }
  })());
});
