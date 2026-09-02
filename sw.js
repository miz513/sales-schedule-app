// Also handles background push notifications (event reminders). Firebase
// Messaging looks for its handler on whichever service worker controls the
// page, so this lives in the same file as the cache-busting logic below
// rather than a separate firebase-messaging-sw.js — registering two workers
// at the same root scope would just have one silently override the other.
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDlTK2CEy0CJyz7RofxuHi-H37zr-V4i0M",
  authDomain: "sales-schedule-app-621b9.firebaseapp.com",
  projectId: "sales-schedule-app-621b9",
  storageBucket: "sales-schedule-app-621b9.firebasestorage.app",
  messagingSenderId: "1022100366188",
  appId: "1:1022100366188:web:19113b8e8cd840fe65c949",
});

const messaging = firebase.messaging();

function linkFromPayload(payload) {
  return (payload.fcmOptions && payload.fcmOptions.link) || (payload.data && payload.data.link) || self.registration.scope;
}

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "予定";
  const body = (payload.notification && payload.notification.body) || "";
  self.registration.showNotification(title, { body, data: { url: linkFromPayload(payload) } });
});

// Notifications have no built-in "open this URL" behavior once the app
// supplies its own onBackgroundMessage handler — without this, tapping one
// just dismisses it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          return client.navigate(url).then((c) => c && c.focus());
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

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
