# 21 Stale-item reminders

Status: needs-info
Blocked by: 17

Closes: F2 and rule R2 (`../interaction-audit.md` finding 2); the remainder of F6; H1 step 6.

## Decision needed

Decision 1 in `../spec.md` (rule R2). Two details to confirm with it, with the recommended answers:

- When: once a day at 18:00 in the recipient's timezone (the bill time), or in the oldest item owner's timezone if the recipient has none.
- Settings: the reviewer's reminder follows the existing "Review item" notification setting and the owner's follows "Comment", so no new setting appears on the settings screen.

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

- [ ] Scenario: evidence filed Monday 10:00 and not decided; the reviewer gets one reminder at the first 18:00 after Tuesday 10:00, one a day after, and none once it is decided.
- [ ] Scenario: three items, the oldest 2 days old; the push says 3 and 2 days.
- [ ] Scenario: an item waiting on the owner's reply is not counted for the reviewer; the owner gets the daily reply reminder until they reply.
- [ ] Scenario: with the "Review item" setting off, the reviewer gets none; with "Comment" off, the owner gets none.
- [ ] Scenario: no second reminder the same day across a restart.
- [ ] F6 regression in `bills.test.ts`: a $1 payment waiting against a $15 overdue bill leaves the owner's daily overdue reminder running for $14.
- [ ] Update `docs/behaviour.md`, including the future idea.
- [ ] `npm run check` passes.

## Out of scope

- Default decisions or expiry.
- Email or SMS (v0 Future Ideas).
