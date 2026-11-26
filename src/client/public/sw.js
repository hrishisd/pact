// The service worker: shows a push, sets the app icon's badge to the count it
// carries, and opens its page when it's tapped.
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
    Promise.all([
      self.registration.showNotification(message.title, {
        body: message.body,
        icon: "/icons/icon-192.png",
        data: { url: message.url },
      }),
      badgeIcon(message.badge),
    ]),
  );
});

/**
 * Sets the app icon's badge to `count`, the push's Review Queue size, or
 * clears it at 0, where the browser can. Never rejects, so a badge that
 * fails can't stop the notification showing.
 */
async function badgeIcon(count) {
  try {
    if (!Number.isInteger(count) || count < 0 || !("setAppBadge" in self.navigator)) return;
    await (count === 0 ? self.navigator.clearAppBadge() : self.navigator.setAppBadge(count));
  } catch {}
}

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
