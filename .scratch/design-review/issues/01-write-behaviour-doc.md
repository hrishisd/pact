# 01 Write `docs/behaviour.md`

Status: ready-for-agent
Blocked by: none

Closes: W2 (`../code-structure-review.md`, section 4). Spec: `../spec.md`, "Behaviour rules" and "Ticket map".

## Problem

There is no single current statement of how the app behaves. The rules are spread across `.scratch/pact-v0/spec.md` (459 lines, written before Anki and vacations), `.scratch/anki-evidence/spec.md`, `.scratch/vacation/spec.md`, 27 tickets, and decisions recorded only in ticket comments and in `.scratch/pact-v0/manual-checks.md` ("Confirmed"). Every session that touches behaviour reconstructs the rules from these and the code, and different sessions reconstruct them differently. That is how the per-kind drift in the interaction audit came about. Examples of rules that live only in tickets: an excuse is refused in the edit window, and a waiting excuse suppresses the Missed push (`.scratch/pact-v0/issues/07-excuses.md:74-80`); One-time's re-dating, refused start and end dates and `deadline-too-soon` (`.scratch/pact-v0/issues/15-one-time-schedule.md:47`).

## What to build

`docs/behaviour.md` states how the app behaves today, organised by concept, not by the order features were built. Suggested sections: pacts and schedules (creation, edit window, terms, changes, ending); occurrences and judging (opening, due times, outcomes, precedence of evidence, covers and misses, bedtime and Anki); covers (excuses and vacations, holds, the 48-hour window); review items (the five kinds, who decides, questions, withdrawal, queues and waiting lists); money (penalties, ledger, payments, bills, Overdue); notifications and reminders; time and timezones.

- Each rule is one or two plain sentences and cites the code that implements it as `path:line` or a function name, and where useful the scenario test that pins it.
- It describes the code as it is, not as the specs intended. Where the code differs from a spec, state the code's behaviour and say so.
- Known bugs are marked inline with a link to their ticket, for example "Known bug: approving an end request drops the open occurrence (ticket 13)". Use the bug list in `../spec.md` "Behaviour rules" (R1, R4, R7, R9) and the probes in `../interaction-audit.md`.
- Use `GLOSSARY.md` terms. Link to `GLOSSARY.md` for definitions instead of repeating them.
- Add a line at the top of each of the three feature specs: "Current rules: `docs/behaviour.md`. This spec records the design as it was decided." Do not otherwise edit the specs.
- In `docs/agents/issue-tracker.md`, "Closing a ticket" gains a step: "A ticket that adds or changes a rule updates `docs/behaviour.md` in the same change, including removing any known-bug note it fixes."

Sources to read: the three feature specs, every ticket's Notes and Comments under `.scratch/*/issues/`, `.scratch/*/manual-checks.md` ("Decisions to confirm" and "Confirmed"), `GLOSSARY.md`, the doc comments on `AccountView` in `src/core/core.ts:182-451`, and the three reports in `.scratch/design-review/`. Check each rule against the code before writing it down.

## Where to start

- `src/core/core.ts:182-451`: one method per command and query, with doc comments that state several rules in full.
- `../interaction-audit.md`, "Governing rules as implemented" and the tables: a ready summary of the pending-item rules with citations.
- `src/core/occurrence-state.ts`, `src/core/judging.ts`, `src/core/money.ts`, `src/core/bill-math.ts`, `src/core/excuses.ts`, `src/core/vacations.ts`, `src/core/review.ts`, `src/core/change-requests.ts`.

## Acceptance criteria

- [ ] `docs/behaviour.md` exists, organised by concept, with a citation on every rule.
- [ ] Every confirmed decision in `.scratch/pact-v0/manual-checks.md` and every "decided while building" note in the tickets is either in it or deliberately left out with a reason in this ticket's Comments.
- [ ] The four known bugs (R1, R4, R7, R9 in `../spec.md`) are marked with links to tickets 13, 11, 08 and 14.
- [ ] The three feature specs carry the pointer line at the top.
- [ ] `docs/agents/issue-tracker.md` "Closing a ticket" has the new step.
- [ ] `npm run lint` passes (Prettier formats Markdown).
- [ ] The human is asked to skim it; note in Comments that they were.

## Out of scope

- Changing any behaviour or any file under `src/`.
- Rewriting the feature specs.
- Rules proposed in `../spec.md` that are not built yet. Only R6 and R11, which are current behaviour, go in now.
