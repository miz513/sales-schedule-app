// Forces every request through the network instead of the browser's own HTTP
// cache. iOS "Add to Home Screen" apps are known to hold onto a stale copy of
// the page for a long time without this; this keeps updates showing up promptly.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
