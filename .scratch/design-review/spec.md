# Design review: plan

Status: done

Every ticket under `issues/` is `ready-for-agent` and can start once the tickets in its `Blocked by:` line are done. The owner's answers are under "Decisions made" below.

Sources: `interaction-audit.md` (findings F1 to F13, probes P1 to P5c), `architecture-review.md` (H1 to H4 and its ranked list) and `code-structure-review.md` (C*, S*, T*, W*), all in this folder. Specs are cited as v0:line (`.scratch/pact-v0/spec.md`) and vac:line (`.scratch/vacation/spec.md`). The audit's probes are kept in `probes/audit-probes.test.ts.txt` with their output in `probes/probe-output.txt`; copy the test into `src/core/` to run it.

## Summary

The review covered the domain core, the client, the server, the tests and the documents that steer AI sessions, and checked each kind of waiting item (evidence, excuses, change requests, vacations, payments, questions) against every event that can happen to it.

The core rules are coherent, and the security and layering are sound: no route exposes another account's data, the server only translates HTTP, and the client does no money arithmetic. The bugs have two causes. Judging is decided in seven places, each with its own copy of the precedence rules, and where an occurrence stands is read through five different predicates. And each of the five review item kinds was built separately, so who decides, what the owner sees as waiting, and what happens when an item stops mattering differ by kind.

The plan has three parts. First, one current statement of the rules (`docs/behaviour.md`) and small independent fixes. Second, the structure changes: one read of an occurrence's state, one pure verdict function, one writer of outcomes and penalties, and one registry of review item kinds. Each fixes specific bugs. Third, the rule changes the owner signed off on 2026-11-11, each built on the structure ticket that makes it small.

## Decisions made

The owner answered all seven on 2026-11-11: yes to each, with every recommendation below. Two changes the review proposed turned out to be current behaviour already and are not listed (R6 and R11 below).

1. Stale items get daily reminders and never expire (R2, ticket 21). Decided 2026-11-11: a reviewer gets one push a day while any item in their Review Queue has waited more than 24 hours, with the count and the oldest item's age; an owner gets one push a day while a reviewer's question to them has gone unanswered for more than 24 hours. No item decides itself. The push time and notification settings in ticket 21 are a default chosen by the design reviewer, which the owner can change.
2. A rejected or withdrawn vacation reopens the excuse window (R3, ticket 15). Decided 2026-11-11: the 48 hours run from the later of the judging and the vacation's rejection or withdrawal, and the rejection notification says the window is open and until when. A rejected or withdrawn excuse keeps the v0 rule and does not reopen it (v0:256).
3. Vacation deciders follow the pacts (R5, ticket 19, low priority). Decided 2026-11-11: the picked reviewers who still review at least one covered pact decide; if none remain, any current reviewer of a covered pact may.
4. The system withdraws items that can no longer matter, with a visible reason (R8, ticket 20). Decided 2026-11-11: when deciding an item either way can no longer change any outcome, penalty or terms, the system withdraws it and records why; owner and reviewers see the reason; nobody is pushed. The vacation spec is followed for evidence on a covered day (vac:78): a late evidence approval turns an Excused occurrence into Satisfied, so such evidence is not moot.
5. One waiting list, vacations included, on Today (R10, ticket 18). Decided 2026-11-11: one list with the same rows everywhere, covering all five kinds; Today shows all of them and a pact page those for that pact; every row opens the item's own page. A question about a vacation also shows on Today. This overrides vac:104.
6. Show the ledger's credit (R12, ticket 16, low priority). Decided 2026-11-11: surplus payments keep paying the next penalties, and the ledger shows the credit until it is used up.
7. The proposed text for `CLAUDE.md`, `CODING_STANDARDS.md` and the `docs/agents/` files is approved as written (ticket 02). Decided 2026-11-11.

## Behaviour rules

"Bug" restores what the specs already say. "Sign-off" is a decision under "Decisions made" above.

- R1 (F1, bug). An approved request to end a pact takes effect when the occurrence or week open at approval closes, as every other change does (v0:218, "Change requests never rescue an open occurrence"). The open occurrence is judged normally. With nothing open, the pact Ends at once.
- R2 (F2, sign-off, decision 1). No item decides itself. A reviewer gets at most one reminder push a day while any item in their Review Queue has waited more than 24 hours, with the count and the oldest item's age. An owner gets at most one a day while a reviewer's question to them has gone unanswered for more than 24 hours. Both go at 09:00 in the recipient's timezone (ticket 21). A reviewer can always decide an item that waits on the owner's reply; this is already the rule (v0:265) and the code (`review.ts` has no such check; `reviewer-questions.test.ts`). Future idea, not planned: a default decision after N days.
- R3 (F3, sign-off, decision 2). A day's 48-hour excuse window runs from the later of its judging and the rejection or withdrawal of a waiting vacation that covered it. A rejected or withdrawn excuse does not reopen it (v0:256). A penalty does not go on a bill until that window has closed. The rejection notification says the window is open and when it closes.
- R4 (F4, bug). The owner is told whenever an occurrence or week becomes Missed, whatever caused it, including a late evidence decision on a Weekly count week. Two existing exceptions stay: a Fixed-day or One-time rejection tells the owner through the rejection push alone (v0:324), and nobody is told about a day on a waiting cover, since the owner asked for it to be excused.
- R5 (F5, sign-off, decision 3). A vacation is decided by the reviewers picked at filing who still review at least one covered pact. If none remain, any current reviewer of a covered pact may decide it.
- R6 (F6, already the rule). A payment waiting for approval stops Overdue reminders only for the part of the overdue amount it covers (v0:291; `bill-math.ts`; `bills.test.ts`). The audit's "$1 against $200 pauses forever" scenario does not happen. The remaining gap, a covering payment nobody decides, is closed by R2.
- R7 (F7, bug). A reminder fires for an occurrence if and only if Today shows it as something for the owner to do (a To do card, or for a bedtime night the Automatic or No Oura data card). One predicate decides both, so a bedtime night Oura has already judged gets no reminder (ticket 24). A waiting excuse removes both; a waiting vacation keeps both (vac:80).
- R8 (F8, F10, sign-off, decision 4). When deciding an item either way can no longer change any outcome, penalty or terms, the system withdraws it and records a reason (`pact-ended` or `no-longer-needed`; an owner's withdrawal records `owner`). Owner and reviewers see the reason on the item's page. Change requests withdrawn when a pact Ends get the same recorded, visible reason. Nobody is pushed (the owner confirmed silent withdrawal on 2026-11-08). Evidence for a day judged Excused is not moot: approving it turns the day Satisfied (vac:78).
- R9 (F9, bug). When an approved change removes a day from the schedule, the excuse and vacation cover for that day is deleted if the day is not judged yet, so a later change that adds the day back does not find it covered (vac:61). A cover left with no days is withdrawn under R8.
- R10 (F11, C2, sign-off, decision 5). The owner has one waiting list with the same rows everywhere, covering all five kinds. Today shows all of them and a pact page shows those that concern the pact. Tapping a row opens that item's own page.
- R11 (F12, already built). Excuses and vacations keep their different Weekly count rules. The vacation's Check step already lists each Weekly count week it does not cover ("Week of Dec 14: not covered, still 3× by Sun Dec 20", `PlanVacation.tsx`, from `notCovered` at `vacations.ts`), as vac:99 specifies. No ticket.
- R12 (F13, sign-off, decision 6). When approved payments exceed owed penalties, the ledger shows the credit and the credit pays the next penalties (the second half is current behaviour, `money.ts` and `allocate` at `money.ts`). A penalty already on a bill is never excused: the code throws rather than clamping owed at zero (that guard is an invariant, not a rule change, and is built in ticket 12).

## Structure changes

The target design is the architecture review's ranked list, accepted with the additions below. Its sketches (`OccurrenceView`, `Cover`, `verdictOf`, `settle`, `RequestKindHandler`) are in `architecture-review.md`, sections "More important than the four", H2, H3 and H1.

- A1, one read of where an occurrence stands (ranked item 1). A `cover_day_v` view, `coverOn` and `coveredSql` replace `excuseOn`, `vacationOn`, `stillToDo` and the `*CoversSql` helpers. `occurrenceStatus` becomes the single occurrence view, carrying cover kind and state, `toDo`, `remind` and `excusableUntil`. Today, reminders, history and the pact page read it, and the client's six derivations (C1) become one `presentOccurrence`. Closes R7. Tickets 08 and 09.
- A2, a pure `verdictOf(facts, now)` beside the current code, with a table-driven test and a test-time check that stored outcomes match it after every command. No behaviour change. Each mismatch becomes a new ticket, not a silent fix. Ticket 10.
- A3, `settle` as the only writer of `occurrence.outcome`, `judged_at` and `penalty`, with Missed notifications produced from transitions, one `endPact(pactId, cause)`, and a conventions check that only `settle.ts` writes those tables. Split in three for size: the tick and evidence decisions (ticket 11, closes R4), covers, bedtime and Anki (ticket 12), and ending (ticket 13, closes R1).
- A4, cover cleanup when a change removes days. Closes R9. Ticket 14.
- A5, a handler registry for the five review item kinds over the existing tables, with no migration (ticket 17), then one owner waiting list, one client row and one `openItem` (ticket 18, closes R10). R5 lives in the vacation handler (ticket 19).
- A6, on the registry: withdrawal reasons and automatic withdrawal of moot items (ticket 20, closes R8), and stale-item reminders (ticket 21, closes R2).

Automated checks (W4) go in with the ticket they protect: cover predicates and client import boundaries with A1, judging writes with A3, occurrence keys with A4, and `Status:` values with the workflow document edits.

## Not doing

- Deriving outcomes and penalties at read time: bills point at penalty rows and the excuse window reads `judged_at`.
- One table with a JSON payload for all five kinds, or decision effects described as data: the lifecycle is shared, the effects are not.
- Merging the excuse and vacation filing rules (Thursday rule, picked reviewers, unopened days only, withdrawal): they are deliberate in vac:56-70.
- Splitting `AccountView` into sub-interfaces or read and write facades: it is a correct thin facade that the routes map onto one to one.
- Splitting `types.ts` or `rows.ts` as tasks of their own: A1 and A5 shrink them.
- Starting with the table merges (H1 step 5, H2 step 5): they carry a database wipe and fix no finding by themselves.
- Event sourcing or a domain event bus: the transition in `settle` and the shared `decide` are enough.
- Expiring items or deciding them by default after a timeout (R2).

## Ticket map

| # | Title | Status | Blocked by | Closes |
|---|---|---|---|---|
| 01 | Write `docs/behaviour.md` | ready-for-agent | none | W2 |
| 02 | Workflow document edits | ready-for-agent | 01 | W3, W5, T2, W1 status check |
| 03 | Session coverage test built from `API_PATHS` | ready-for-agent | 01 | S1 |
| 04 | Body size and text length limits | ready-for-agent | 01 | S2, vacation preview 500 |
| 05 | A failed friends load says so | ready-for-agent | 01 | C3 |
| 06 | Copy reads the core's time constants | ready-for-agent | 01 | C4 |
| 07 | Browser smoke test and an ExcuseSheet test | ready-for-agent | 01 | T1 |
| 08 | One occurrence view in the core | ready-for-agent | 01 | F7, R7, H2 steps 1-3, W4 cover check |
| 09 | One client presentation of an occurrence | ready-for-agent | 08 | C1, W4 import check |
| 10 | A pure verdict function | ready-for-agent | 08 | H3 step 1 |
| 11 | `settle` for the tick and evidence decisions | ready-for-agent | 10 | F4, R4 |
| 12 | `settle` for covers, bedtime and Anki | ready-for-agent | 11 | H3 steps 4-5, billed-penalty guard |
| 13 | One `endPact`, and ending waits for the open occurrence | ready-for-agent | 12 | F1, R1, W4 judging-writes check |
| 14 | Delete cover when a change removes a day | ready-for-agent | 08 | F9, R9, W4 occurrence-key check |
| 15 | A rejected or withdrawn vacation reopens the excuse window | ready-for-agent | 08, 12 | F3, R3 |
| 16 | Show the ledger's credit | ready-for-agent | 12 | F13, R12 |
| 17 | Review item registry | ready-for-agent | 01 | H1 step 1 |
| 18 | One waiting list and one row | ready-for-agent | 17 | F11, C2, R10 |
| 19 | Vacation deciders follow the pacts | ready-for-agent | 17 | F5, R5 |
| 20 | Withdrawal reasons and moot items | ready-for-agent | 10, 13, 14, 17 | F8, F10, R8 |
| 21 | Stale-item reminders | ready-for-agent | 17 | F2, R2, F6 remainder |

Recommended order: 01 first, because every later session reads `docs/behaviour.md`, and 02 right after it. The small independent tickets 03 to 07 come next; 07's smoke test also guards the refactors that follow. Then the occurrence view (08, 09), the verdict function (10) and `settle` in three steps (11 to 13), which fix R7, R4 and R1 on the way. Cover cleanup (14) can run any time after 08. Tickets 15 and 16 follow 12. The registry (17) is independent of 08 to 14 and can run in parallel with them; 18 to 21 build on it, and 20 also needs the verdict function and the single `endPact`.

## Findings not ticketed

- F6: already the rule (R6). Ticket 21 adds a regression scenario for a small payment against a large overdue bill.
- F12: already built (R11).
- Audit "waiting change request, reviewer never responds" (blocks other changes): covered by R2's reminders; the owner can already withdraw.
- Audit: no withdrawal for evidence, payments or questions, and questions and alerts surviving a pact's end: unspecified, with no reported harm; no product need yet.
- Audit: a payment possibly stranded when no pact links owner and recipient any more (suspected, not probed): ticket 17 adds a scenario and files a ticket if it is stranded.
- H1 step 5 and H2 step 5 (the `request`, `request_photo` and `cover` tables): ranked 7th, worth doing only with a sixth kind or the next cross-kind feature.
- H4 (collapsing per-kind withdraw, accept-rejection and item-page methods on `AccountView`): optional, ranked 8th.
- `rows.ts` shedding the request lifecycle helpers: part of ticket 17, not its own task.
- W1: the stale statuses were fixed in this session (see the report). A new "built, needs the human" status was not added, because the conventions already allow `done` with manual checks recorded in `manual-checks.md`. The `Status:` value check is in ticket 02.
- W4 exhaustive per-kind records in the client: in ticket 18.
- Code structure: splitting `App.tsx` and its duplicate `firstName` (`App.tsx`, `vacation-text.ts`), splitting `Today.tsx`, and the unused `.c-change` class (`styles.css`): optional, do when next touched.
- T2 beyond the standards line (rewriting existing server tests): the review says not to.
