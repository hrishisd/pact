# 17 Review item registry

Status: done
Blocked by: 01

Closes: H1 step 1 (`../architecture-review.md`, H1, "Target design" and "Migration order"). No behaviour change.

## Problem

The five review item kinds (evidence, excuse, payment, change request, vacation) share a lifecycle (filed, decided, withdrawn, thread, deciders, queue, waiting list) but each is written separately. The lifecycle columns are copied five times (`src/core/migrations.ts`, `220`, `282`, `408`, `718`). `src/core/review.ts` has six switches or sequential probes over the kinds: `decide` (`review.ts`), `itemToDecide` probing five tables in turn (`review.ts`), `ownItem` (`review.ts`), `itemWhat` (`review.ts`), `itemPath` (`review.ts`) and `reviewItemSince` (`review.ts`); `viewPhoto` checks three photo stores separately (`review.ts`). Each kind has its own queue query (`evidenceToReview` `evidence.ts`, `excusesToReview` `excuses.ts`, `paymentsToReview` `money.ts`, `changeRequestsToReview` `change-requests.ts`, `vacationsToReview` `vacations.ts`) and its own owner waiting query (`waitingEvidence` `evidence.ts`, `waitingExcuses` `excuses.ts`, `waitingPayments` `money.ts`, `waitingChangeRequests` `rows.ts`, none for vacations).

The duplication has already drifted: deciders are answered three ways (F5), the owner's waiting lists disagree (F11), only change requests are withdrawn by the system (F10), and nothing knows when an item stops mattering (F8). Tickets 18 to 21 each need one place to make their change.

## What to build

- `src/core/requests.ts` with `RequestKind`, `RequestRow` (a read of the existing lifecycle columns, not a new table) and the `RequestKindHandler` interface as sketched in H1 "Target design", minus the methods later tickets add (`isMoot` in ticket 20). Each kind's handler in its own module or beside its feature code: `load`, `deciders`, the queue query, `canWithdraw`, `checkDecision` (change request: `deadline-too-soon`, and the active-pact check), `apply` (calls the existing `decideEvidence`, `decideExcuse`, `decidePayment`, `decideChangeRequest`, `decideVacation`), `describe` (`itemWhat`, `itemPath`), `queueItem`, `waitingItem` (vacation's may return nothing for now; ticket 18 decides), `photoIds`.
- `REQUEST_KINDS` registry. Rewrite `review.ts` as loops over it: `decide`, `itemToDecide`, `ownItem`, `reviewQueue`, `waitingOnReply`, `askOwner`, `ownerReply`, `viewPhoto`, `reviewItemSince`.
- Move the request lifecycle helpers out of `src/core/rows.ts` (`reviewStateColumns` `rows.ts`, `reviewStateOf` `rows.ts`, `thread` `rows.ts`, `recordDecision` `rows.ts`, and `Decided`) into `requests.ts`, and `waitingChangeRequests` and `todayKeeps` into `change-requests.ts`.
- Payment deciders: settle the audit's suspected stranding (a waiting payment that no reviewer can decide because no pact links owner and recipient any more). `paymentReviewersSql` (`src/core/money.ts`) also counts a pact's earlier terms and its penalties, and a pact outside its edit window is never deleted, so it looks impossible. Try to construct it in a scenario (for example a recipient changed by an approved change, with a payment to the old recipient waiting). Record the conclusion in Comments; if it can be stranded, file a ticket rather than fixing it here.

## Where to start

- `src/core/review.ts` (378 lines), `src/core/rows.ts` and `:425-515`.
- `../architecture-review.md`, H1 "Target design" (the interface sketch) and "What it makes worse" (keep `apply` as plain code).

## Acceptance criteria

- [x] `review.ts` has no switch or probe sequence over item kinds.
- [x] Adding a sixth kind would mean one handler and one registry entry; show it in Comments by listing what a new kind would touch.
- [x] Every existing test passes unchanged.
- [x] The payment stranding question is answered in Comments, with a scenario for the recipient-change case.
- [x] `npm run check` passes.

## Out of scope

- The `request` table and any migration (H1 step 5, not doing now).
- Any behaviour change: who decides, what is listed, withdrawal (tickets 18 to 21).
- Collapsing per-kind `AccountView` methods (H4, not ticketed).

## Comments

Built 2026-11-11.

What exists now:

- `src/core/requests.ts`: `RequestKind`, `RequestRow`, `RequestKindHandler<P>`, `QueuedItem`, `isWaiting`, and the lifecycle helpers moved out of `rows.ts` (`ReviewOutcome`, `Decided`, `decisionDetails`, `recordDecision`, `reviewStateColumns`, `ReviewStateRow`, `reviewStateOf`, `thread`). `waitingChangeRequests` and `todayKeeps` moved into `change-requests.ts`.
- Handlers beside their feature code: `evidenceKind` (`evidence.ts`), `excuseKind` (`excuses.ts`), `paymentKind` (`money.ts`), `changeRequestKind` (`change-requests.ts`), `vacationKind` (`vacations.ts`). The registry is `REQUEST_KINDS` (and `REQUEST_HANDLERS`, its values in order) in `src/core/request-kinds.ts`, its own module so that the feature modules never import it.
- `review.ts` loops over the registry: `findItem`, `itemToDecide` (a decider, not withdrawn, and the kind's `reviewable`), `ownItem`, `decide` (shared checks, then the kind's `checkDecision` and `apply`), `askOwner`/`ownerReply` (`describe`, `deciders`), `reviewItems` (`queue`, `queueFirst`, then by `since`), `viewPhoto` (`itemsWithPhoto`; the owner or a decider may see it). `paymentToDecide`, `mayViewPaymentPhoto`, `ownVacation` and `vacationToDecide` are gone.

Where the interface differs from the sketch in H1, and why:

- `queue(ctx, reviewerId)` returns `{ item, since }[]`: the kind's queue query and `queueItem` in one, since each kind's query already builds the items; `since` replaces `reviewItemSince`.
- `itemsWithPhoto(ctx, photoId)` instead of `photoIds(ctx, id)`: `viewPhoto` starts from a photo, not an item.
- `reviewable` (new): evidence waits for the edit window to close, a change request needs an Active pact. A withdrawn item is never decidable, for every kind.
- `canWithdraw` left out: withdrawal is still per kind (`withdrawChangeRequest`, `withdrawVacation`; H4 is out of scope), and `withdrawn_at` is null for kinds that can't be withdrawn, so nothing reads it. Ticket 20 can add it with withdrawal reasons.
- `waiting(ctx, ownerId, pactId?)` is on every handler (payment answers nothing with a `pactId`; vacation nothing yet) but Today and the pact page still call the per-kind functions: writing `waitingFor` over the registry is ticket 18's first bullet.
- Change request's `checkDecision` catches judging up on approval before checking (as `decide` did), so it can write before refusing; unchanged behaviour.

Adding a sixth kind would touch: its table (a migration), its variant in `ReviewItem` (and `TodayWaitingItem` if the owner lists it) in `src/shared/types.ts`, `recordDecision`'s table name union, one handler beside its code, one entry in `REQUEST_KINDS`, and the client's rendering of the new `ReviewItem` variant. Nothing in `review.ts` changes. `REQUEST_KINDS` is keyed by `RequestKind`, so a new kind without a handler fails `tsc`.

Payment stranding: it can't happen. A payment needs something owed to its recipient, so a penalty row to that recipient exists, from a pact past its edit window. Penalty rows are only deleted when an occurrence is settled again, a pact is only deleted inside its edit window (with no penalties), `pact_earlier_terms` rows are never deleted, and a change keeps at least one reviewer. So some pact of the owner's always links to the recipient through its current terms, earlier terms or a penalty, and its current reviewers decide. New scenario in `payments.test.ts`: "a payment waiting when its pact's recipient and reviewers change goes to the pact's new reviewers, so it's never stranded". It passed before and after the refactor. No ticket filed.

The ticket's line numbers predate tickets 08 to 16 (for example `review.ts` for `decide` was `:128-174`, `rows.ts`/`:148` were `:125`/`:136`); the code it describes was otherwise as written.

`npm run check` and `npm run test:e2e` pass. No existing test changed; one scenario added.

