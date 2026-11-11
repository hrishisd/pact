# 18 One waiting list and one row

Status: ready-for-agent
Blocked by: 17

Closes: F11, C2 and rule R10 (`../interaction-audit.md` finding 11, `../code-structure-review.md` C2); H1 step 2; the exhaustive-kinds part of W4.

## Decision

Decision 5 in `../spec.md` (rule R10), decided 2026-11-11: the owner has one waiting list with the same rows everywhere, covering all five kinds, vacations included. Today shows all of them and a pact page those that concern the pact, and every row opens the item's own page. This overrides the vacation spec's choice to keep waiting vacations, and questions about them, off Today (vac:104, vac:145, and vac:71 "The question shows on the vacation's Profile card, not on Today"). Because Today's question alerts are built from the waiting list (`src/core/today.ts:81-99`), a question about a vacation also appears on Today; the Profile card keeps its Reply too.

## Problem

- Core: Today's waiting list is change requests, evidence, excuses and payments (`src/core/today.ts:102-111`); the pact page's is change requests, evidence and excuses (`src/core/pacts.ts:255-261`). Neither has vacations. `TodayWaitingItem` (`src/shared/types.ts:1064`) has no vacation variant, and not-judged days hide vacation-waiting (`src/core/occurrence-state.ts:180`).
- Client: Today's Waiting for approval (`src/client/Today.tsx:1077-1139`) handles four kinds: evidence opens the pact, a payment opens the ledger. The pact page's Waiting on (`src/client/PactPage.tsx:335-385`) is a near copy for three kinds, where evidence opens nothing, with the comment "evidence has no page" (`PactPage.tsx:339`), false since `EvidencePage` was added (`src/client/App.tsx:356`). A reviewer's question on Today routes evidence to `EvidencePage` and a payment to `PaymentPage` (`Today.tsx:128-139`). So the same waiting evidence opens three different things, or nothing, depending on where it is tapped. `questionSubject` (`Today.tsx:812-823`) and `openItem` have no vacation case. The three rejection alerts (`Today.tsx:896-1070`) each carry their own refusal table with the same sentence.

## What to build

- Core: `waitingFor(ctx, ownerId, scope: { pactId?: string })` written once over the registry (ticket 17), returning one `TodayWaitingItem` union with a vacation variant. Today uses it with no scope; the pact page with `pactId`, where a vacation is included if it covers the pact. Each row carries the item's kind, id, title, detail line and since-time.
- Client: one `WaitingItemRow` and one `openItem(item)` in `src/client/item-page.tsx`, keyed by `Record<ReviewItem["kind"], ...>` like `ITEM_KINDS` (`item-page.tsx:16-22`), so a missing kind is a type error. Every row opens the item's own page: evidence `EvidencePage`, excuse its page, payment `PaymentPage`, change request its page, vacation the Profile sheet's card (or its own page, if one is cheap; note the choice). Today, the pact page and the question alert all use them. Delete the stale comment at `PactPage.tsx:339` with the code it describes.
- One shared refusal table for the rejection alerts' Take the L.

## Where to start

- `src/core/today.ts:81-111`, `src/core/pacts.ts:250-262`, `src/shared/types.ts:1064` and the `PactWaitingItem` type.
- `src/client/Today.tsx:128-139`, `:812-823`, `:896-1139`; `src/client/PactPage.tsx:335-385`; `src/client/item-page.tsx:16-22`; `src/client/App.tsx:356`.
- `../architecture-review.md`, H1 "Migration order" step 2.

## Acceptance criteria

- [ ] New core scenario: a waiting vacation appears in Today's waiting list and on the pact page of each pact it covers, and not on another pact's page.
- [ ] New core scenario: a question about a waiting vacation raises Today's question alert.
- [ ] Rewritten tests that pinned the old rule: the vacation tests asserting Today lists no vacation (`vacations.test.ts`, search "Waiting for approval never" and "questionAlerts"), and the waiting object in `src/server/app.test.ts:1007-1016` if it changes.
- [ ] `Today.test.tsx` and `PactPage.test.tsx`: tapping a waiting evidence row opens `EvidencePage` from both screens; a vacation row opens the vacation.
- [ ] Removing a kind from the client record fails `tsc`; shown by trying it.
- [ ] Update `docs/behaviour.md`.
- [ ] `npm run check` passes.

## Out of scope

- Withdrawal reasons (ticket 20).
- The reviewer's Review Queue (unchanged).

## Notes from ticket 17

- Each handler in `REQUEST_KINDS` (`src/core/request-kinds.ts`) already has `waiting(ctx, ownerId, pactId?)`, wrapping the existing per-kind query; payment's answers nothing for a `pactId`, vacation's nothing at all yet. Today and the pact page still call the per-kind functions.
- Import cycle to watch: `pacts.ts` and `change-requests.ts` import each other. If `pacts.ts` imports `request-kinds.ts`, the registry may be built before `change-requests.ts` has defined `changeRequestKind` (a TDZ error at startup, depending on import order). Build `waitingFor` in a module `pacts.ts` doesn't sit in a cycle with (for example `requests`-side code that `core.ts` calls and passes into `pactPage`), or look the registry up lazily.
