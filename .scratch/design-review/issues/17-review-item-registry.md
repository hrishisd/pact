# 17 Review item registry

Status: ready-for-agent
Blocked by: 01

Closes: H1 step 1 (`../architecture-review.md`, H1, "Target design" and "Migration order"). No behaviour change.

## Problem

The five review item kinds (evidence, excuse, payment, change request, vacation) share a lifecycle (filed, decided, withdrawn, thread, deciders, queue, waiting list) but each is written separately. The lifecycle columns are copied five times (`src/core/migrations.ts:142`, `220`, `282`, `408`, `718`). `src/core/review.ts` has six switches or sequential probes over the kinds: `decide` (`review.ts:124-166`), `itemToDecide` probing five tables in turn (`review.ts:177-217`), `ownItem` (`review.ts:224-264`), `itemWhat` (`review.ts:267-290`), `itemPath` (`review.ts:349-362`) and `reviewItemSince` (`review.ts:365-378`); `viewPhoto` checks three photo stores separately (`review.ts:58-71`). Each kind has its own queue query (`evidenceToReview` `evidence.ts:196`, `excusesToReview` `excuses.ts:402`, `paymentsToReview` `money.ts:623`, `changeRequestsToReview` `change-requests.ts:670`, `vacationsToReview` `vacations.ts:468`) and its own owner waiting query (`waitingEvidence` `evidence.ts:333`, `waitingExcuses` `excuses.ts:429`, `waitingPayments` `money.ts:728`, `waitingChangeRequests` `rows.ts:472`, none for vacations).

The duplication has already drifted: deciders are answered three ways (F5), the owner's waiting lists disagree (F11), only change requests are withdrawn by the system (F10), and nothing knows when an item stops mattering (F8). Tickets 18 to 21 each need one place to make their change.

## What to build

- `src/core/requests.ts` with `RequestKind`, `RequestRow` (a read of the existing lifecycle columns, not a new table) and the `RequestKindHandler` interface as sketched in H1 "Target design", minus the methods later tickets add (`isMoot` in ticket 20). Each kind's handler in its own module or beside its feature code: `load`, `deciders`, the queue query, `canWithdraw`, `checkDecision` (change request: `deadline-too-soon`, and the active-pact check), `apply` (calls the existing `decideEvidence`, `decideExcuse`, `decidePayment`, `decideChangeRequest`, `decideVacation`), `describe` (`itemWhat`, `itemPath`), `queueItem`, `waitingItem` (vacation's may return nothing for now; ticket 18 decides), `photoIds`.
- `REQUEST_KINDS` registry. Rewrite `review.ts` as loops over it: `decide`, `itemToDecide`, `ownItem`, `reviewQueue`, `waitingOnReply`, `askOwner`, `ownerReply`, `viewPhoto`, `reviewItemSince`.
- Move the request lifecycle helpers out of `src/core/rows.ts` (`reviewStateColumns` `rows.ts:137`, `reviewStateOf` `rows.ts:148`, `thread` `rows.ts:429`, `recordDecision` `rows.ts:501`, and `Decided`) into `requests.ts`, and `waitingChangeRequests` and `todayKeeps` into `change-requests.ts`.
- Payment deciders: settle the audit's suspected stranding (a waiting payment that no reviewer can decide because no pact links owner and recipient any more). `paymentReviewersSql` (`src/core/money.ts:71-80`) also counts a pact's earlier terms and its penalties, and a pact outside its edit window is never deleted, so it looks impossible. Try to construct it in a scenario (for example a recipient changed by an approved change, with a payment to the old recipient waiting). Record the conclusion in Comments; if it can be stranded, file a ticket rather than fixing it here.

## Where to start

- `src/core/review.ts` (378 lines), `src/core/rows.ts:130-160` and `:425-515`.
- `../architecture-review.md`, H1 "Target design" (the interface sketch) and "What it makes worse" (keep `apply` as plain code).

## Acceptance criteria

- [ ] `review.ts` has no switch or probe sequence over item kinds.
- [ ] Adding a sixth kind would mean one handler and one registry entry; show it in Comments by listing what a new kind would touch.
- [ ] Every existing test passes unchanged.
- [ ] The payment stranding question is answered in Comments, with a scenario for the recipient-change case.
- [ ] `npm run check` passes.

## Out of scope

- The `request` table and any migration (H1 step 5, not doing now).
- Any behaviour change: who decides, what is listed, withdrawal (tickets 18 to 21).
- Collapsing per-kind `AccountView` methods (H4, not ticketed).
