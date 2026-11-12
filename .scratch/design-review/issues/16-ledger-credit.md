# 16 Show the ledger's credit

Status: done
Blocked by: 12

Closes: F13 and rule R12 (`../interaction-audit.md` finding 13). Low priority.

## Decision

Decision 6 in `../spec.md` (rule R12), decided 2026-11-11: when approved payments exceed the penalties owed, the surplus keeps paying the next penalties, as the owner confirmed on 2026-11-08 (`.scratch/pact-v0/manual-checks.md`, "Confirmed", Money), and the ledger shows the credit until it is used up.

## Problem

Current behaviour, exactly:

- A payment can be at most owed minus what awaits approval (`paymentAcceptance`, `src/core/money.ts`), so an owner cannot overpay directly.
- The surplus arises when a penalty is paid and the owner then files an excuse for it within its 48 hours. From the filing the penalty is held, and `allocate` skips held penalties, so the payment stops counting against it; on approval the penalty is deleted. Approved payments never change. A vacation cannot cause it, because its covered days are held from the moment they are judged and so are never paid.
- `ledgerSummaries` computes owed as `max(0, penalties not held - approved payments)` (`money.ts`), so owed reads $0 and the surplus is not shown anywhere.
- `allocate` (`money.ts`) applies approved payments to penalties oldest first, billed ones first. The surplus therefore pays the next penalties as they arrive: a later penalty shows as paid in the ledger history, and its bill is made but sends no "New bill" push when nothing on it is unpaid (`money.ts`).
- An excuse cannot reach a billed penalty today, because bills take only penalties whose 48 hours have passed. If it ever did, the clamp hides it. Ticket 12 adds a throw for that case.

## What to build

- `LedgerSummary` gains `creditCents`: approved payments minus penalties not held, when positive. The ledger card shows it, for example "$5 credit · pays your next penalties", beside owed $0. While the excuse waits the credit is provisional; say so ("$5 credit if the excuse is approved") if the view can tell, otherwise show the plain credit and note the choice in Comments.
- Today shows nothing new for a credit.
- No change to allocation or billing.

## Where to start

- `src/core/money.ts` (`ledgerSummaries`), `:303-342` (`allocate`), `:180-240` (ledger history rows).
- `src/client/Ledgers.tsx`.
- `excuses.test.ts` (the current owed-at-zero test), `ledgers.test.ts`.

## Acceptance criteria

- [x] New scenario in `ledgers.test.ts`: $5 paid, an excuse then filed and approved for that penalty; the ledger shows owed $0 and credit $5; the next $5 penalty shows as paid and the credit is gone.
- [x] New scenario: the same excuse rejected instead; the credit is gone and the payment pays the penalty again.
- [x] `excuses.test.ts` passes, with an added assertion on `creditCents`.
- [x] A client test for the credit line in `Ledgers`.
- [x] Update `docs/behaviour.md`.
- [x] `npm run check` passes.

## Out of scope

- Refunds, or letting an owner pay ahead beyond owed.
- The billed-penalty guard (ticket 12).

## Comments

- Built 2026-11-11. `LedgerSummary` gained `creditCents` and `creditWaitsOn` (the kinds of waiting cover holding a penalty the credit would pay if rejected). The view can tell when the credit is provisional, so the card says "$5 credit if the excuse is approved" (or "vacation", or "excuse and vacation") while one waits, and "$5 credit · pays your next penalties" otherwise. The copy says "the excuse" even when several wait.
- The ticket's line references have drifted: the owed-at-zero test is now `excuses.test.ts`, and there was no `Ledgers` client test before; `src/client/Ledgers.test.tsx` is new.
