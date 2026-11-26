// The number on the app's icon on the Home Screen: the Review Queue's size,
// as the Review tab's badge shows it. A push sets it while the app is closed
// (public/sw.js); in the app, every load of the queue sets it and the tab's
// badge alike (`loadReviewQueue`, `onReviewCount`), and signing out clears it
// (`clearAppIcon`, from `forgetThisDevice` in push.ts).

import type { ReviewQueueResponse } from "../shared/api.ts";
import { api } from "./api.ts";

/** How many loads of the queue have started. */
let started = 0;
/**
 * The number of the latest-started load that set the count, or of the last
 * load started before signing out: no load up to it may set the count.
 */
let applied = 0;
const listeners = new Set<(count: number) => void>();

/**
 * Loads the Review Queue, shows its size on the app's icon and tells each
 * `onReviewCount` listener. Every load of the queue goes through here, so
 * the count only ever comes fresh from the server: one that fails changes
 * nothing, and so does one that answers after a later-started load has set
 * it, or after signing out. It still answers its caller.
 */
export async function loadReviewQueue(): Promise<ReviewQueueResponse> {
  const load = ++started;
  const queue = await api.reviewQueue();
  if (load > applied) {
    applied = load;
    badgeAppIcon(queue.length);
    for (const listener of [...listeners]) listener(queue.length);
  }
  return queue;
}

/** Calls `listener` with the queue's size each time a load of it sets the count, until the returned function stops it. */
export function onReviewCount(listener: (count: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For signing out: clears the icon, and no load of the queue started before now sets it again. */
export function clearAppIcon(): void {
  applied = started;
  badgeAppIcon(0);
}

/**
 * Shows `count` on the app's icon, or clears it at 0, where the browser can.
 * On iPhone, without notification permission the browser refuses; nothing
 * else depends on it, so that is ignored.
 */
function badgeAppIcon(count: number): void {
  try {
    if (!("setAppBadge" in navigator)) return;
    (count === 0 ? navigator.clearAppBadge() : navigator.setAppBadge(count)).catch(() => {});
  } catch {
    // As refused.
  }
}
