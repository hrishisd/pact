# 27 What a pact takes while an approved end waits

Status: done
Blocked by: 13

Found while building ticket 13.

## Problem

Since ticket 13, an approved end request waits for the occurrence or week open at approval: the pact stays Active, with its end date set to that occurrence's last day and `pact.end_approved_at` set (`endAfter`, `src/core/ending.ts`). Nothing else knows about that wait:

- The owner can send another end request, and the pact page still shows End pact (`requestEnd`, `src/core/change-requests.ts`; `PactPage.tsx`, `changeable && !waiting && <EndPact>`). Approving it changes nothing, but the owner and the reviewer are asked to decide it.
- The owner can send a change request. Any change it makes applies from the first occurrence not open yet, which is after the end, so approving it changes nothing that will be judged; a later end date it asks for applies without approval (a stricter change) and would undo the approved end. `endPact` withdraws one still waiting when the pact Ends.
- With the end date set, nothing after the last day is the pact's any more, so excuses and evidence for later days are already refused. That part needs nothing.

## Questions for the owner

- While an approved end waits, should the core refuse new end and change requests (a new refusal, say `end-approved`), with the client hiding End pact and Request change? Or is a later end date a legitimate way to take the end back?

## Acceptance criteria

- [x] Decided, built through `scenario()` tests, and `docs/behaviour.md` updated.
- [x] `npm run check` passes.

## Owner decision (2026-11-11)

Ready for an agent. While an approved end waits, hide "End pact" on the pact page and have the core refuse new end and change requests for that pact. Runs right after ticket 13, before 14.
