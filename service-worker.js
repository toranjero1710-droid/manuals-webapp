const CACHE_NAME = "manuals-webapp-v3-video-20260707";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./data/search-index.json",
  "./config/normalization-map.json",
  "./manifest.webmanifest",
  "./offline.html",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/favicon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.pathname.endsWith(".pdf")) return;

  const shouldUseNetworkFirst =
    url.origin === self.location.origin &&
    [
      "/index.html",
      "/styles.css",
      "/app.js",
      "/data/search-index.json",
      "/config/normalization-map.json",
      "/manifest.webmanifest",
      "/service-worker.js"
    ].some((path) => url.pathname.endsWith(path));

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./", copy));
          return response;
        })
        .catch(() => caches.match("./index.html").then((cached) => cached || caches.match("./offline.html")))
    );
    return;
  }

  if (shouldUseNetworkFirst) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          if (request.headers.get("accept")?.includes("text/html")) return caches.match("./offline.html");
          return Response.error();
        });
    })
  );
});
