# 20 Withdrawal reasons and moot items

Status: done
Blocked by: 10, 13, 14, 17

Closes: F8, F10 and rule R8 (`../interaction-audit.md` findings 8 and 10, probes P5a to P5c); H1 steps 3 and 4 (`../architecture-review.md`); the empty-cover half of R9.

## Decision

Decision 4 in `../spec.md` (rule R8), decided 2026-11-11: when deciding an item either way can no longer change any outcome, penalty or terms, the system withdraws it and records a reason that owner and reviewers can see, and nobody is pushed. The vacation spec is followed for evidence on a covered day (vac:78, "Like an excuse, approved evidence still makes an occurrence Satisfied"): approving evidence for a day already judged Excused turns it Satisfied, so such evidence is not moot. The code does not do this today (case 5 below). If ticket 10 filed a ticket for this mismatch, that ticket makes the change; otherwise this ticket makes it. Either way this ticket keeps case 5 out of withdrawal.

## Problem

- F8: items that can no longer change anything stay in Review Queues and on the owner's waiting list. P5a: evidence for a day an approved excuse already made Excused stays in the queue, and rejecting it still pushes "rejected your evidence". P5b: an excuse whose only day a change removed shows with `days: []` in the queue (`src/core/excuses.ts:402-426` does not filter) and on the owner's waiting list (`excuses.ts:429-457`). P5c: evidence for the day open when an end was approved stays in the queue and its decision does nothing (`src/core/evidence.ts:243`). Vacations over Ended pacts stay decidable (`src/core/review.ts:212` requires an active pact only for change requests).
- F10: `endPact` withdraws a waiting change request (`src/core/judging.ts:234-243`) with no reason recorded; the page reads "withdrawn" as if the owner did it. `change-requests.test.ts:771` and `:803` assert there is no push, which the owner confirmed on 2026-11-08 and which stays.

## Rule

R8: when deciding an item either way can no longer change any outcome, penalty or terms, the system withdraws it and records a reason. Reasons: `owner` (the owner withdrew it), `pact-ended`, `no-longer-needed`. Owner and reviewers see the reason; nobody is pushed.

Computed, not hand-written: an item is moot when `verdictOf` (ticket 10) gives the same verdict and penalty for every occurrence it touches with the item approved as with it rejected, and that verdict is final (not `open` or `waiting` on something else).

Cases, checked against that definition with the code as it will be after tickets 11 to 14:

| # | Case | Moot? | Why |
|---|---|---|---|
| 1 | An excuse or vacation with no covered day left: every day removed by a change (P5b; ticket 14 deletes the rows) or due after the pact Ended (approval skips them, `excuses.ts:379`) | Yes, `no-longer-needed` (or `pact-ended` when the end did it) | Neither decision touches any occurrence. For a vacation, only when no day is left on any pact. |
| 2 | An excuse or vacation whose every remaining covered day is Satisfied by approved evidence | Yes, `no-longer-needed` | Approved evidence beats a cover, so approving or rejecting leaves Satisfied. |
| 3 | A waiting change request when the pact Ends (end date, One-time judged, or an approved end taking effect) | Yes, `pact-ended` | Nothing is left for it to change. Today's behaviour, with the reason added. |
| 4 | Evidence for a Weekly count week already Satisfied by other approved evidence (`judgeWeek` judges Satisfied once the target is met, `judging.ts:153`) | Yes, `no-longer-needed`, if the core accepts evidence after the target is met; check | The week stays Satisfied either way. |
| 5 | Evidence for a day already judged Excused (P5a) | No | Approval turns the day Satisfied (decision 4, vac:78). Today a late approval changes nothing (`evidence.ts:254-258` skips judged days); that is the bug to fix. |
| 6 | Evidence for an occurrence not the pact's because it fell due after the end (P5c) | Yes, `pact-ended`, but after ticket 13 it should not arise | An approved end now waits for the open occurrence. Keep the case for safety. |
| 7 | Evidence or a cover on an occurrence still open, deferred on that evidence, or Missed and inside its window | No | The decision changes the outcome or the penalty. |
| 8 | An excuse or vacation with at least one covered day not judged yet or Missed | No | Approval would excuse it. |
| 9 | A payment | No, never | Approving always changes the ledger, even when owed is $0 (it becomes credit, ticket 16). |
| 10 | A change request on an Active pact | No | Approving always changes the terms. |
| 11 | Any item waiting on the owner's reply | Same as its kind | The question does not affect moot-ness. Withdrawing it ends the question alert, as `reviewer-questions.test.ts:345` already shows for an owner's withdrawal. |

## What to build

- Migration: `withdrawn_at` and `withdrawn_reason` on `evidence` and `excuse`; `withdrawn_reason` on `change_request` and `vacation` (existing withdrawals backfilled: `owner` where the owner withdrew, `pact-ended` where `withdrawn_at` equals the pact's `ended_at`). Payments get neither.
- `isMoot` on each handler (ticket 17), computed through `verdictOf` as above; payment and change request answer from their kind alone.
- `withdrawMoot(ctx, now)` run after every command that changes a fact (in the shared `decide` and `withdraw`, filing, change approval, ending) and in each tick. It withdraws moot items with their reason. An excuse or vacation withdrawn this way releases nothing, since a moot cover holds no penalty; assert that.
- Case 5, unless the ticket filed from ticket 10 has already done it: approving evidence for a day judged Excused makes it Satisfied through `settle`, and the verdict hook's known-mismatch entry for it is removed.
- `endPact` (ticket 13) records `pact-ended`.
- Queues, waiting lists and question alerts exclude withdrawn items of every kind.
- Shown: the owner's item pages say "Withdrawn when Gym Ended" or "Withdrawn: no longer needed" with the date (and "You withdrew it" for `owner`). A reviewer who tries to decide a withdrawn item gets a refusal with the reason, and `REFUSAL_TEXT` in `src/client/Review.tsx` shows it ("Withdrawn: Gym Ended."), instead of "That item isn't in your queue any more."

## Where to start

- `src/core/judging.ts:230-245`, `src/core/review.ts:120-220` (or the registry after ticket 17), `src/core/excuses.ts:369-460`, `src/core/vacations.ts:583-600`.
- Probes P5a to P5c in `../probes/audit-probes.test.ts.txt`, "probe 5".
- `change-requests.test.ts:771`, `:803`.

## Acceptance criteria

- [x] Scenarios for each "Yes" case above (1 to 4, and 6 if constructible): the item leaves the queue and the waiting list, carries its reason, and no push is sent.
- [x] Scenarios for cases 7, 8 and 9: the item stays.
- [x] Case 5: moved to ticket 26 by the owner (2026-11-11), because it needs 26's fix to pass.
- [x] `change-requests.test.ts:771` and `:803` extended to assert the `pact-ended` reason on the change request's page.
- [x] A reviewer deciding a withdrawn item gets the reason in the refusal (core scenario and `Review.test.tsx`).
- [x] Update `docs/behaviour.md`.
- [x] `npm run check` passes.

## Out of scope

- Owner withdrawal for evidence, excuses or payments (not requested).
- Pushes for system withdrawals.

## Comments

- Built. Migration 33 adds the columns and backfills (`migrations.test.ts`, "migration 33"); it also rebuilds `cover_day_v` with the excuse's `withdrawn_at` and makes `evidence_one_waiting` skip withdrawn evidence. `withdrawMoot` (`review.ts`) runs inside the core's `#command` after every command, and in the tick at the tick's time, rather than only after the commands that change a fact. Each handler has an optional `moot` (`waitingIds`, `reason`, `withdraw`) and a `pactNames`; payments have no `moot`. Evidence, excuses and vacations ask `mootReason` (`moot.ts`), which judges each touched occurrence both ways through `decisionEffect` (`verdict.ts`; `occurrenceFacts` takes a supposed decision, `coverOn` a supposed cover decision). Withdrawn evidence is left out of the verdict's facts.
- Scenarios: `withdrawal.test.ts`. Case 1 both ways (a change removing the only day; an approved end leaving the days after it), case 2 for an excuse (with its question alert going, case 11) and a vacation, case 4, and cases 5, 7, 8, 9 and 10 staying. Case 6 is not constructible after ticket 13: the open occurrence stays the pact's (`change-requests.test.ts`, "evidence waiting for the day open when the end was approved, rejected afterwards, adds the penalty").
- Case 5: ticket 26 exists for the late approval, so this ticket only keeps the evidence out of withdrawal; the scenario checks it stays in the queue and the waiting list. Its approval making the day Satisfied is ticket 26's criterion; the third box stays unticked for it.
- Differs from the ticket: a vacation has no page of its own, so its withdrawal reason shows only in a reviewer's refusal; the owner's Profile card goes, as for an owner's withdrawal. A cover whose days an approved end left past the end is withdrawn `pact-ended` at the approval, before the pact actually Ends.
- Filed ticket 31: at the exact due instant `verdictOf` lets a cover approval beat approved evidence, so a vacation made moot by approved evidence is withdrawn at the first tick after the due time, not at it.
- Review of ac56282 (2026-11-11): migration 33 marks no excuse or evidence withdrawn (only change requests and vacations get a reason), so every cover and waiting evidence counts as before; the migration test now checks that too. The moot rule compares final verdicts and penalties both ways, so a cover with a day Missed, not judged yet or still open, and evidence on a week not judged yet, stay; it runs once per command, so it can't loop, and a moot item holds no penalty, so settle's billed-penalty guard isn't reached. Added scenarios: a vacation moot on one pact but covering a Missed day on another stays; a withdrawn excuse leaves the pact page's waiting list. Fixed: an excuse with no day left (all past the end, or removed) showed an empty Days heading and dates line on its page; both are hidden now (`ExcusePage.test.tsx`). Added **Withdrawn** (and moot) to `GLOSSARY.md`.
