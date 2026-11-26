// The number on the app's icon on the Home Screen: the Review Queue's size,
// as the Review tab's badge shows it. A push sets it while the app is closed
// (public/sw.js); in the app, every load of the queue sets it
// (`loadReviewQueue`), and signing out clears it (`forgetThisDevice`, push.ts).

import type { ReviewQueueResponse } from "../shared/api.ts";
import { api } from "./api.ts";

/**
 * Loads the Review Queue and shows its size on the app's icon. Every load of
 * the queue goes through here, so the icon only shows a count fresh from the
 * server; one that fails leaves it as it was.
 */
export async function loadReviewQueue(): Promise<ReviewQueueResponse> {
  const queue = await api.reviewQueue();
  badgeAppIcon(queue.length);
  return queue;
}

/**
 * Shows `count` on the app's icon, or clears it at 0, where the browser can.
 * On iPhone, without notification permission the browser refuses; nothing
 * else depends on it, so that is ignored.
 */
export function badgeAppIcon(count: number): void {
  try {
    if (!("setAppBadge" in navigator)) return;
    (count === 0 ? navigator.clearAppBadge() : navigator.setAppBadge(count)).catch(() => {});
  } catch {
    // As refused.
  }
}
