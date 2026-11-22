// The service worker: shows a push, and opens its page when it's tapped.
// iPhone revokes a subscription whose push doesn't show a notification, so every push shows one.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  // A payload that isn't our JSON still shows a notification: throwing here would show none.
  let message = null;
  try {
    message = event.data?.json() ?? null;
  } catch {}
  if (typeof message?.title !== "string") message = { title: "Pact", body: "", url: "/" };
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: "/icons/icon-192.png",
      data: { url: message.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    (async () => {
      const [open] = await self.clients.matchAll({ type: "window" });
      if (!open) return self.clients.openWindow(url);
      await open.focus();
      return open.navigate(url);
    })(),
  );
});
