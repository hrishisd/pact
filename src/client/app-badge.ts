// The number on the app's icon on the Home Screen: the Review Queue's size,
// as the Review tab's badge shows it. A push sets it while the app is closed
// (public/sw.js); the app sets it from what it loads (`useReviewCount`,
// App.tsx), and clears it on signing out.

/**
 * Shows `count` on the app's icon, or clears it at 0, where the browser can.
 * Without notification permission the browser refuses; nothing else depends
 * on it, so that is ignored.
 */
export function badgeAppIcon(count: number): void {
  if (!("setAppBadge" in navigator)) return;
  try {
    (count === 0 ? navigator.clearAppBadge() : navigator.setAppBadge(count)).catch(() => {});
  } catch {
    // As refused.
  }
}
