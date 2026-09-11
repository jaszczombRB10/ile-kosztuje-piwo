const CACHE_NAME = "poilepiwko-v53";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.markercluster.js",
  "./vendor/leaflet/MarkerCluster.css",
  "./vendor/leaflet/MarkerCluster.Default.css",
  "./vendor/supabase/supabase.min.js",
  "./data/venues.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/syrenka-hero.png"
];

// Install Event: Cache Core Shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Pre-caching offline assets");
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Event: Clear Old Caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[SW] Removing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event: Stale-While-Revalidate Strategy
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Do not cache Supabase API calls, map tiles, serverless endpoints, or admin panel in Service Worker
  if (url.origin.includes("supabase.co") || url.origin.includes("cartocdn.com") || url.pathname.startsWith("/rest/v1") || url.pathname.startsWith("/api/") || url.pathname.includes("admin")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && event.request.method === "GET") {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Return cached response if offline
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
