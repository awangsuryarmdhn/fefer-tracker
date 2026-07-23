/* FEFER PWA — shell cache only; API always network */
const CACHE = "fefer-shell-v4";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-maskable.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // cross-origin (BasedBot chart) — browser handles; no SW
  if (url.origin !== self.location.origin) return;
  // live data never from SW cache
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
    e.respondWith(fetch(req));
    return;
  }
  // shell: network first, cache fallback (fresh deploys win)
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (url.pathname === "/" || SHELL.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html"))),
  );
});