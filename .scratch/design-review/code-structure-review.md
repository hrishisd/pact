# Code structure and workflow review

Date: 2026-11-10. Scope: the client (`src/client/`), the server (`src/server/`, `src/shared/api.ts`), the tests outside the core, and the documents and checks that steer AI sessions. The domain core is covered by `architecture-review.md` and pending-item behaviour by `interaction-audit.md` (findings cited as F1 to F13); this review does not repeat them and agrees with the architecture review's "do not do" list. Paths are relative to the repo root.

Baseline: `npx vitest run src/server src/client` passes 24 files and 363 tests in about 10 seconds on Node 22. `tsc --noEmit` passes. `npm run lint` passes Prettier, knip and `scripts/check-conventions.ts`; shellcheck is not installed in this container, so that step was not run. A throwaway probe (in the session scratchpad, not committed) called 20 owner commands and queries as a reviewer and as a friend who is not a reviewer, against the owner's pact, evidence, excuse, payment and recipient ids. Every one was refused or not found.

## 1. Client

The client mostly renders what the core returns. Money is never summed in the client (`RecordPayment.tsx:24-48` and `Ledgers.tsx` only show core amounts), the excuse and vacation sheets ask the core for previews rather than computing coverage, and Request change asks the core for its verdict. Loading and sending are done one way, through `useLoad` and `useSend` in `src/client/ui.tsx:55-210`. The findings below are the exceptions.

### C1. Where an occurrence stands is re-derived by six client functions with different precedence

Severity: medium.

Evidence. The core sends an `OccurrenceStatus` (`src/shared/types.ts:1262-1281`) with raw fields: `kind`, `held`, `heldByVacation`, `excuse`, `evidenceWaiting`, `opensAt`, `dueAt`. Each screen then decides what to call the occurrence, by comparing `opensAt` and `dueAt` with the browser clock and choosing its own order of checks:

- `squareOf` (`src/client/history.tsx:31-39`): vacation, then outcome, then approved excuse, then ahead/open/not judged. It ignores a waiting excuse and waiting evidence.
- `DayChip` (`src/client/excuse-days.tsx:20-58`): approved excuse, waiting excuse, waiting evidence, then ahead/open/not judged.
- `dayNote` (`src/client/excuse-days.tsx:70-83`): ahead/open/not judged only, with its own "Due by Sunday" for weeks.
- `OccurrenceChip` (`src/client/history.tsx:51-65`): vacation first, then `DayChip`.
- `missedLine` (`src/client/Today.tsx:615-630`) and `recentNote` (`src/client/ExcuseSheet.tsx:578-583`).
- `DayCard` decides which Weekly count week a day belongs to by Monday plus six days (`src/client/ExcuseSheet.tsx:510`), a rule the core also owns.

The `excuse: "waiting" | "approved"` field cannot say whether the cover is an excuse or a vacation, so `DayChip` can only say "Excuse waiting for approval" (`src/client/excuse-days.tsx:50`) while `heldBy` distinguishes the two for a Missed day (`src/client/excuse-days.tsx:60-62`).

Consequence. This is the client's copy of the architecture review's "one read of an occurrence's state" problem. The heat map square and the chip beside it can disagree today (a day with a waiting excuse is a plain open square with an "Excuse waiting for approval" chip), and when the core gains its single `OccurrenceView`, six client functions will still encode the old subsets. Every new screen that shows a day will write a seventh.

Recommendation. When the architecture review's ranked item 1 lands, have the core's view carry the display facts the client now computes: a `phase` (`ahead`, `open`, `past-due`) and `cover: { kind: "excuse" | "vacation", state: "waiting" | "approved" } | null`. Replace the six functions with one `presentOccurrence(view, now)` in `src/client/excuse-days.tsx` that returns the chip, square and note together. The countdown stays client-side; the ordering does not. Cost: small to medium, about half a session after the core change, with the existing `history.test.tsx` and `excuse-days.test.tsx` as the safety net.

### C2. The per-kind waiting lists and their routing differ on every screen

Severity: medium.

Evidence.

- Today's Waiting for approval (`src/client/Today.tsx:1077-1139`) handles four kinds. Evidence opens the pact, a payment opens the ledger.
- The pact page's Waiting on (`src/client/PactPage.tsx:341-385`) is a near copy that handles three kinds. Evidence is a row that opens nothing, with the comment "evidence has no page" (`src/client/PactPage.tsx:339`), which has been false since `EvidencePage` was added (`src/client/App.tsx:356`).
- A reviewer's question on Today routes evidence to `EvidencePage` and a payment to `PaymentPage` (`src/client/Today.tsx:128-139`), so the same waiting evidence opens three different things, or nothing, depending on where it is tapped.
- `questionSubject` (`src/client/Today.tsx:812-823`) and `openItem` have no vacation case because `TodayWaitingItem` has none, which is how F11 reaches the screen.
- The three rejection alerts (`src/client/Today.tsx:896-1070`) each carry their own refusal table with the same "nothing-to-accept" sentence.

Consequence. A new item kind, or a fix such as F11, has to be made in four or five client places, and nothing makes a missed place fail to compile, because each list has its own narrower union type.

Recommendation. One `WaitingItemRow` and one `openItem(item)` in `src/client/item-page.tsx`, keyed by `Record<ReviewItem["kind"], ...>` like the existing `ITEM_KINDS` table (`src/client/item-page.tsx:16-22`), used by Today, the pact page and the question alert. Do it together with the architecture review's H1 step 2 (one `waitingFor`), so the core returns one waiting-item union and the client's exhaustive record makes any missing kind a type error. Cost: small, a few hours on top of H1.

### C3. A failed friends load tells the owner they have no friends

Severity: medium.

Evidence. `AddReviewerSheet` loads friends with `api.friends().then(setFriends, () => setFriends([]))` (`src/client/PactPage.tsx:530`). An empty list then renders "Only friends can review your pacts. Invite another, and they show up here once they accept." (`src/client/PactPage.tsx:551-567`). The other hand-written loaders handle failure correctly (`src/client/pact-form-steps.tsx:93-109`, `src/client/ExcuseSheet.tsx:61-85`, `src/client/InvitePage.tsx:37-43`); this is the one that does not.

Consequence. On a bad connection the owner is told something false and prompted to invite a friend they already have. It breaks the standard's rule that error copy says what failed (`CODING_STANDARDS.md`, "Results and errors").

Recommendation. Use `useLoad(api.friends)` and `loadFailure` as `pact-form-steps.tsx` does. Cost: under an hour, with a `PactPage.test.tsx` case for the failed load.

### C4. Copy restates core constants

Severity: low.

Evidence. The edit window is `EDIT_WINDOW_MS` and the excuse window `EXCUSE_WINDOW_MS` in `src/core/pact-rules.ts:36,42`, and a bedtime night closes at 18:00 in `src/core/bedtime.ts`. The client hard-codes "10 minutes" six times (`ChangePact.tsx:61`, `CreatePact.tsx:243,489`, `ExcuseSheet.tsx:105,596`, `PactPage.tsx:143`, `pact-form-steps.tsx:69`), "6pm" four times (`Today.tsx:524,626`, `history.tsx:78`, `pact-form-steps.tsx:444`) and "48 hours" in `excuse-days.tsx:91`. `MAX_EXCUSE_SPAN_DAYS` and `MAX_EVIDENCE_PHOTOS` already show the right pattern: a shared constant used in both the rule and the copy.

Consequence. Changing a window in the core leaves the copy wrong, and no test notices.

Recommendation. Export `EDIT_WINDOW_MINUTES`, `EXCUSE_WINDOW_HOURS` and `NIGHT_CLOSES_AT` from `src/shared/types.ts`, use them in the core and in the copy. Cost: an hour.

On file size: `Today.tsx` is large because Today has many card and alert variants, not because unrelated things share it; splitting the alerts into their own file would help navigation but is optional. `App.tsx` does mix unrelated things (sign-in, timezone confirmation, the shell, the profile sheet and connections, `src/client/App.tsx:101,127,211,506,605`) and has its own `firstName` (`src/client/App.tsx:747`) beside the exported one in `src/client/vacation-text.ts:27`; split it when next touched. `styles.css` has one unused class (`.c-change`, `src/client/styles.css:1266`) out of several hundred, so it is not carrying dead weight.

## 2. Server

`src/server/app.ts` is HTTP translation. Every API route parses shape with the combinators in `src/server/parse.ts`, makes one core call through `account(c)`, and returns its result; content rules stay in the core (for example a fractional payment passes the server's regex at `app.ts:538` and is refused by `money.ts:613`). Authentication is one middleware (`app.ts:366-377`), and ownership is checked by the core, as the probe confirmed. `connections.ts` only orders adapter and core calls. Two gaps remain.

### S1. The "every route needs a session" test is a hand-kept list and has fallen behind

Severity: medium.

Evidence. `src/server/app.test.ts:1926-1962` lists 11 read paths and 11 write paths. It does not include excuses, excuse previews and options, vacations, change requests, ledgers, notifications, push subscriptions, or the Oura and Anki routes. Whether a route needs a session depends only on whether it is registered before or after the middleware at `app.ts:366`; the invite lookup (`app.ts:356`) and the auth handler are deliberately above it.

Consequence. A future route added above line 366, or a middleware reordering, would make it public, and the test that exists to catch this would still pass. This is the only check standing between a second user and the route surface.

Recommendation. Build the test's list from `API_PATHS` (calling each function form with a placeholder id) minus a short explicit list of public paths, and assert 401 for every method the app registers. Cost: an hour.

### S2. No limit on JSON body size or on text fields

Severity: low.

Evidence. `bodyLimit` is applied only to the three photo routes (`app.ts:522,533,552`). JSON routes read the whole body (`app.ts:745-747`), and the core caps photo counts and reminders but no text length (no length check on names, notes, reasons, questions or replies in `src/core/`). Push text is truncated (`src/core/web-push.ts:68`); screens are not.

Consequence. Any signed-in friend can write a reject reason or question of many megabytes that then loads on the owner's Today and item pages on every visit, and a pact name is shown to every reviewer. Sign-up is invite-only, so the realistic risk is a bug or a paste, not an attacker.

Recommendation. `app.use("/api/*", bodyLimit({ maxSize: 64 * 1024 }))` before the photo routes override it, and a shared `MAX_TEXT_CHARS` refused by the core as a domain refusal. Cost: an hour.

A smaller point found by the probe: `vacationPreview` for an account with no confirmed timezone throws "account ... owns a pact but has no timezone" (`src/core/vacations.ts:105` via `src/core/rows.ts:116`), a 500 with a misleading message. The client always confirms the timezone first, so it is reachable only by a direct call.

## 3. Tests

The fakes in `src/core/testing/fakes.ts` implement the port interfaces directly and the real adapters have their own tests (`photo-stores.test.ts`, `web-push.test.ts`, `oura.test.ts`, `anki.test.ts`); I found no drift. The client's `stubApi` (`src/client/testing/render.tsx:41-56`) is typed against the real `api` object and throws on any unstubbed call, so client fixtures cannot drift in shape, only in plausibility.

### T1. No check that a whole flow works in a browser, and the money-holding sheets have no component tests

Severity: medium.

Evidence. There is no Playwright or similar dependency in `package.json`. Client component tests exist for seven screens (`Today`, `PactPage`, `Review`, `CreatePact`, `ChangePact`, `PlanVacation`, `VacationSection`; 1,827 lines of client tests in all). `ExcuseSheet.tsx` (606 lines, it shows held money and decides which preview day is the opened one), `RecordPayment.tsx`, `Ledgers.tsx`, the four item pages and the navigation wiring in `App.tsx` (`App.tsx:229-480`, every `onOpen...` callback) have none. The `manual-checks.md` files cover devices (a real ring, a phone, push), not app flows. The client and server share `API_PATHS` and the multipart field names, which removes most wiring risk but not callbacks that go to the wrong page, as in C2.

Consequence. A session that changes a screen can only check it by hand in the browser pane, and a regression in a flow that crosses screens (file an excuse from a Missed card, see it under Waiting, open it) is found by the owner.

Recommendation. One Playwright smoke test that drives the dev server through `/api/dev/sign-in` with two accounts: create a pact, submit evidence, review it, miss a day, file an excuse, record a payment. Run it in CI after `build`. Add an `ExcuseSheet` component test for the opened-on-a-day path and a Weekly count week. Cost: about one session for the smoke test, an hour for the sheet test.

### T2. Server tests re-walk domain flows the core tests already own

Severity: low.

Evidence. Several server tests walk whole features and assert read-model contents: the vacation flow (`src/server/app.test.ts:1373-1450`), excuses (`app.test.ts:1281-1334`), change requests (`app.test.ts:1519-1555`), questions (`app.test.ts:1591-1630`), and a full Today waiting object (`app.test.ts:1007-1016`). The core's scenarios already assert the same behaviour.

Consequence. A deliberate change to a read model fails in two suites, and a session tends to fix the second mechanically. The cost is tokens and attention, not bugs.

Recommendation. For new routes, keep one wiring test per route (shape refused with 400, a refusal returned as 200, one success through to the core) and use `objectContaining` on core output. Do not rewrite the existing ones. Cost: none now; a line in `CODING_STANDARDS.md`.

## 4. Workflow documents and checks

### W1. Built tickets and finished specs still say they are ready for an agent

Severity: high.

Evidence.

- `.scratch/pact-v0/issues/09-oura-no-data-and-disconnection.md:3` and `.scratch/pact-v0/issues/15-one-time-schedule.md:3` say `Status: ready-for-agent`. Both are built and on main (`Today.tsx:493-537`, `useCheckNow` at `Today.tsx:256`; `src/core/one-time.test.ts`). Their comments explain why: "Pending human review, so Status stays ready-for-agent" (`09...md:59`, `15...md:47,51`).
- `.scratch/pact-v0/spec.md:3` says `Status: ready-for-agent`; `.scratch/vacation/spec.md:3` says `Status: needs-triage` although all four vacation tickets are done.
- `.scratch/pact-v0/spec.md:429` says vacation is "being designed".

Consequence. The status vocabulary (`docs/agents/triage-labels.md`) has no state for "built, waiting for the human", so agents used `ready-for-agent` for it. A session told "pick up the next ready ticket", or using the wayfinding frontier rule in `docs/agents/issue-tracker.md:31`, will rebuild a shipped feature, or treat the v0 spec as unbuilt.

Recommendation. Add a `needs-human-check` (or `built`) status to `triage-labels.md` and to the closing rules in `issue-tracker.md`; set 09 and 15 to it and both specs to `done`; fix the "being designed" line. Add a check to `scripts/check-conventions.ts` that every `Status:` line in `.scratch/` uses a known value. Cost: half an hour.

### W2. There is no single current statement of how the app behaves

Severity: high.

Evidence. Behaviour is spread across the v0 spec (459 lines, written before Anki and vacations), the Anki spec (142), the vacation spec (159), 27 tickets, and decisions recorded only in ticket bodies and comments. Examples: filing an excuse is refused in the edit window and a Missed push is suppressed for a day under a waiting excuse (`.scratch/pact-v0/issues/07-excuses.md:74-80`); One-time's re-dating, refused start and end dates and the `deadline-too-soon` rule (`.scratch/pact-v0/issues/15-one-time-schedule.md:47`, which still says "Kept"); a reviewer's ask list layout differing from the vacation spec (`.scratch/vacation/issues/02-review-and-approve-a-vacation.md:60`). The interaction audit had to cite v0 and vacation specs side by side, and found places where they and the code disagree (F1, F9). `GLOSSARY.md` is current and states some rules (for example Vacation at `GLOSSARY.md:92-93`), which makes it the nearest thing to a current statement, but it is a vocabulary, not a rule book.

Consequence. Every session that touches behaviour must reconstruct the rules from four sources and the code, and different sessions reconstruct them differently. That is the mechanism behind the per-kind drift both earlier reviews found. It also costs tokens: the three specs alone are about 760 lines.

Recommendation. Write `docs/behaviour.md`: the rules as they are now, by area (pacts and schedules, occurrences and judging, covers, review items, money, notifications), each rule one or two sentences with a pointer to the core function or test that enforces it. Generate it in one session from the specs, the ticket decisions and the scenarios, and have the human skim it. Mark the three specs as history ("superseded by docs/behaviour.md for current rules"). Add one step to "Closing a ticket" in `issue-tracker.md`: update `docs/behaviour.md` with any rule the ticket added or changed. Feature specs then describe a change, and the behaviour document describes the result. Cost: one session to write, minutes per ticket after.

### W3. CLAUDE.md does not lead an implementing session to the architecture or the coding standards

Severity: high.

Evidence. `CLAUDE.md` (29 lines) points to the issue tracker, triage labels, production, local development, prototyping and domain docs. It does not mention `CODING_STANDARDS.md`, the core/server/client/shared split, or `npm run check`. Nothing else in the repo references `CODING_STANDARDS.md` except one ticket and the design reviews. The standards file says it is "Read at review time" (`CODING_STANDARDS.md:3`).

Consequence. The most important rule, "A rule decided in a route or a component is a finding" (`CODING_STANDARDS.md:7`), reaches a session only after it has written the code, if a review step runs at all. C1 and C2 are the kind of thing that rule exists to stop.

Recommendation. Add three lines to `CLAUDE.md`: the layer map (`src/core` decides every domain rule behind `AccountView`; `src/server` translates HTTP; `src/client` renders; `src/shared` holds the wire types and paths), "read `CODING_STANDARDS.md` before writing code", and "run `npm run check` before calling work done". Change the standards file's first line to "Read before writing code and at review time". Cost: ten minutes.

### W4. Most structural rules rely on the session remembering, and cheap checks would have caught several earlier findings

Severity: medium.

Evidence. Enforced by a check: formatting, unused exports and files (knip), avoided glossary words, the Kept rename, real time, machine timezone and locale, real timers and `Math.random` in the core and tests, `localeCompare` without a locale (`scripts/check-conventions.ts:1-10`), shell scripts, and types. Not enforced: the core owning every rule; commands being one transaction and sending only through the outbox; queries never writing; outside effects only through ports; paths only from `src/shared/`; error copy through `failureText`; core tests going through `scenario()`; never depending on id order.

Cheap checks that would have caught or contained findings from the two earlier reviews and this one, each a few lines in `check-conventions.ts` or a test:

- Layer imports: `src/client/` may import only `src/client/` and `src/shared/`; `src/core/` never imports `src/server/` or `src/client/`. Both hold today; nothing keeps them so.
- Judging writes: `INSERT INTO penalty`, `DELETE FROM penalty` and `UPDATE occurrence` appear in five core files today (`judging.ts` 3, `excuses.ts` 3, `evidence.ts`, `bedtime.ts`, `vacations.ts` 1 each). An allowed-files list frozen now, shrunk to `settle` by H3, is the conventions guard H3 asks for and would have flagged the paths behind F4.
- Cover predicates: once the architecture review's ranked item 1 lands, forbid `excuseOn`, `vacationOn`, `stillToDo` and the `*CoversSql` helpers outside `occurrence-state.ts`. This is the class of bug behind F7 and F11.
- Occurrence keys: any migration that creates a table with `pact_id` and `date` columns must be named in `moveOneTimeOccurrence` (the architecture review's suggestion; F9's class).
- Exhaustive kinds: in the client, per-kind tables typed as `Record<ReviewItem["kind"], ...>` (C2) make a missing kind a type error, which would have caught F11 on screen.
- Session coverage from `API_PATHS` (S1) and `Status:` values (W1).

Consequence. The rules that matter most are the ones only a reviewing session can apply, and the code was written by sessions that did not read them (W3).

Recommendation. Add the import-boundary, judging-writes and status checks now (about an hour together); add the cover-predicate and occurrence-key checks as part of the architecture review's items 1 and 4. Cost: small.

### W5. Generic skill boilerplate points at skills and files this repo does not have

Severity: low.

Evidence. `docs/agents/domain.md` describes `GLOSSARY-MAP.md`, multi-context layouts and `/grill-with-docs` and `/improve-codebase-architecture`, none of which exist here; `docs/agents/issue-tracker.md:26-39` specifies `/wayfinder` map files that no feature uses; `docs/agents/triage-labels.md` is an identity table ending "Edit the column to match whatever vocabulary you actually use"; `docs/agents/prototype-first.md:13` names `/grill-with-docs`, while the installed skill is `grilling`. The installed `domain-modeling` skill describes writing a `CONTEXT.md`, while this repo's glossary is `GLOSSARY.md` and the conventions check reads only that file (`scripts/check-conventions.ts:35`). `docs/agents/local-dev.md` assumes `fnm` and an iCloud folder, which a cloud session does not have.

Consequence. These files are read on demand, so the token cost is modest. The risk is steering: a session running `domain-modeling` may start a second glossary the lint ignores, and one following `prototype-first.md` looks for a skill that is not there.

Recommendation. Cut `domain.md` to five lines (read `GLOSSARY.md` and `docs/adr/`; add new terms to `GLOSSARY.md`, never a `CONTEXT.md`), delete the wayfinding section and the identity table (keep the list of status values from W1), fix the skill names, and mark the `fnm` and iCloud notes as applying to the owner's Mac. Cost: half an hour.

## Ranked list

1. W1. Fix stale ticket and spec statuses and add a "built, needs the human" status with a check. High, half an hour.
2. W3. Point CLAUDE.md at the layer map, `CODING_STANDARDS.md` and `npm run check`. High, ten minutes.
3. W2. Write `docs/behaviour.md` as the one current statement of the rules and update it when tickets close. High, one session.
4. C2. One waiting-item row and one `openItem`, keyed by every review item kind, with H1's `waitingFor`. Medium, small.
5. W4. Add import-boundary, judging-writes and status checks now; cover-predicate and occurrence-key checks with the core work. Medium, small.
6. C1. One client presentation of an occurrence, fed by the core's single occurrence view. Medium, after architecture item 1.
7. C3. Stop turning a failed friends load into "invite a friend". Medium, under an hour.
8. S1. Build the session-coverage test from `API_PATHS`. Medium, an hour.
9. T1. One browser smoke test of the main flow, and an `ExcuseSheet` component test. Medium, about one session.
10. S2. A JSON body limit and a text length cap. Low, an hour.
11. C4. Share the edit window, excuse window and night close constants with the copy. Low, an hour.
12. W5. Trim the generic skill boilerplate and fix skill names. Low, half an hour.
13. T2. Keep new server tests to route wiring. Low, a line in the standards.

## Checked and found sound

- No route lets a second account read or change the first account's pacts, evidence, excuses, payments, ledgers, photos or review items; the probe of 20 commands and queries as a reviewer and as a non-reviewing friend was refused every time.
- `app.ts` is HTTP translation only, with one validation style (`parse.ts`) and one authentication middleware.
- The client does no money arithmetic and asks the core for excuse, vacation and change previews.
- Client data fetching and sending go through `useLoad` and `useSend`, with one exception (C3).
- Client imports never reach into `src/core/`.
- Test fakes match their ports, and client API stubs are typed against the real `api` object.
- CI runs the same `npm run check` as local development and blocks deploys on failure; the pre-commit hook only formats, which is appropriate.
- `GLOSSARY.md` is current, including Anki and vacations.
- `styles.css` carries almost no dead classes, and knip keeps unused exports out.
