// The owner's waiting list: every review item of theirs still waiting for a
// decision, of all five kinds, from the registry. Today shows all of it, a
// pact page the part that concerns the pact.
//
// Its own module, imported by today.ts and core.ts only: pacts.ts and
// change-requests.ts import each other, so pacts.ts importing the registry
// could build it before `changeRequestKind` exists. `pactPage` takes this
// function as a parameter instead.

import type { AccountId, PactWaitingItem, TodayWaitingItem } from "../shared/types.ts";
import type { CoreContext } from "./context.ts";
import { REQUEST_HANDLERS } from "./request-kinds.ts";
import { mergeByTime } from "./rows.ts";

/**
 * The owner's items waiting for a decision, newest first; with `pactId`,
 * those that concern the pact: its change request, evidence and excuses, and
 * vacations covering a day of it. Never a payment, which belongs to a
 * recipient.
 */
export function waitingFor(ctx: CoreContext, ownerId: AccountId, scope: { pactId: string }): PactWaitingItem[];
export function waitingFor(ctx: CoreContext, ownerId: AccountId, scope: { pactId?: undefined }): TodayWaitingItem[];
export function waitingFor(ctx: CoreContext, ownerId: AccountId, { pactId }: { pactId?: string }): TodayWaitingItem[] {
  const items = mergeByTime(
    waitingSince,
    "newest-first",
    ...REQUEST_HANDLERS.map((handler) => handler.waiting(ctx, ownerId, pactId)),
  );
  return pactId === undefined ? items : items.filter((item): item is PactWaitingItem => item.kind !== "payment");
}

/** When a waiting item was sent for a decision: for ordering them. */
function waitingSince(item: TodayWaitingItem): Date {
  switch (item.kind) {
    case "evidence":
      return item.submittedAt;
    case "excuse":
      return item.filedAt;
    case "payment":
      return item.recordedAt;
    case "change-request":
      return item.requestedAt;
    case "vacation":
      return item.filedAt;
  }
}
