# 21 Stale-item reminders

Status: done
Blocked by: 17, 22

Closes: F2 and rule R2 (`../interaction-audit.md` finding 2); the remainder of F6; H1 step 6.

## Decision

Decision 1 in `../spec.md` (rule R2), decided 2026-11-11: no item decides itself. A reviewer gets one push a day while any item in their Review Queue has waited more than 24 hours, and an owner gets one push a day while a reviewer's question to them has gone unanswered for more than 24 hours.

Default chosen by the reviewer (of this design review, not a pact reviewer), the owner can change it:

- When: once a day at 09:00 in the recipient's own timezone. Every account has one since ticket 22.
- Settings: the reviewer's reminder follows the "review-item" setting ("New review item" on the settings screen), the same as the existing "review-item" push that tells a reviewer about a new item. The owner's reminder follows the "comment" setting ("Comment"), the same as the existing "reviewer-question" push (`SETTING_OF_KIND`, `src/core/outbox.ts:18-34`). No new setting appears on the settings screen.

Future idea, not planned: an item decided by default after N days. Rejected for now because between two friends either default is wrong: automatic approval is exploitable and automatic rejection is unfair.

## Problem

Items never expire (v0:263) and nobody is reminded. Waiting evidence defers judging (`src/core/judging.ts:135`, `:154`); waiting excuses and vacations hold penalties (`src/core/money.ts:85`); an item waiting on the owner's reply leaves the queue (`src/core/review.ts:73-81`). There is no notification kind for a stale queue or an unanswered question (`NOTIFICATION_SETTINGS`, `src/shared/types.ts:712-721`).

Scenario: the owner submits any photo each day. The reviewer is busy for a month. Nothing is judged and nothing is billed. Or a reviewer asks about an excuse and the owner never answers: the penalties stay held forever, and the item leaves every list but the owner's alert.

F6, as the audit wrote it ("a $1 payment against a $200 bill pauses Overdue forever"), does not happen: a payment waiting for approval stops Overdue only for the part it covers (`overdueOf`, `src/core/bill-math.ts:35-50`; `bills.test.ts:301`), as v0:291 says. What remains is a payment that covers the whole overdue amount and is never decided; this ticket's reviewer reminder covers it, since a payment is in the reviewer's queue.

## What to build

- A scheduler step `remindStale(ctx, t)` over the registry (ticket 17), beside `remindOverdue` in the tick.
- Reviewer: while any item in their Review Queue (`reviewQueue`, so not those waiting on a reply) has waited more than 24 hours, measured by `reviewItemSince` (`review.ts:365-378`: filed, or the owner's latest reply), one push a day: "3 items wait for your review", "The oldest, Jordan's evidence for Gym, has waited 2 days.", opening Review.
- Owner: while a reviewer's question on one of their items has gone unanswered for more than 24 hours, one push a day: "Sam asked about your excuse for Gym 2 days ago", "Reply so they can decide.", opening the item's page (ticket 18's `openItem` target, or the existing item path).
- Store when each account was last reminded, so a restart does not repeat a push (as `overdue_notice` does, `money.ts:490-520`).
- New notification kinds in `src/core/ports.ts:95` and `:135` and the outbox mapping (`src/core/outbox.ts:24`), mapped to the "review-item" and "comment" settings.

## Where to start

- `src/core/money.ts:444-520` (`remindOverdue`, the pattern to follow), `src/core/review.ts:73-81` and `:365-378`, the scheduler tick that calls `remindOverdue`.
- `src/core/notifications.test.ts`, `bills.test.ts:262-307`.

## Acceptance criteria

- [x] Scenario: evidence filed Monday 10:00 and not decided; the reviewer gets one reminder at the first 09:00 after Tuesday 10:00 (Wednesday 09:00), one a day after, and none once it is decided.
- [x] Scenario: three items, the oldest 2 days old; the push says 3 and 2 days.
- [x] Scenario: an item waiting on the owner's reply is not counted for the reviewer; the owner gets the daily reply reminder until they reply.
- [x] Scenario: with the "review-item" setting off, the reviewer gets none; with "comment" off, the owner gets none.
- [x] Scenario: no second reminder the same day across a restart.
- [x] F6 regression in `bills.test.ts`: a $1 payment waiting against a $15 overdue bill leaves the owner's daily overdue reminder running for $14.
- [x] Update `docs/behaviour.md`, including the future idea.
- [x] `npm run check` passes.

## Out of scope

- Default decisions or expiry.
- Email or SMS (v0 Future Ideas).

## Notes from the implementing agent

- Built as `remindStale` in `src/core/stale-items.ts`, run in the tick after `remindOverdue`; kinds `stale-review-items` (setting "review-item") and `unanswered-question` (setting "comment"); `stale_notice` table (migration 34). Tests: `stale-items.test.ts`, and the F6 scenario in `bills.test.ts`.
- `reviewItemSince` never measured "filed, or the owner's latest reply": it was the filing time only, and ticket 17 replaced it with each handler's `since`. The ticket's intent is built: `reviewQueueWaits` (`review.ts`) takes the later of `since` and the owner's latest reply, so an item a reply sent back counts from the reply.
- A reminder goes only if an item had waited more than 24 hours by the day's 09:00, so evidence filed Monday 10:00 is first reminded Wednesday 09:00. The count is the whole Review Queue; ages are calendar days in the recipient's timezone. With several unanswered questions, the owner's push names the oldest.
- The owner's push opens the item's own page (each handler's `describe().ownerPath`, the same as the "reviewer-question" push); a vacation's is the Profile sheet.
