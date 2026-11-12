# Architecture review of the domain core

Date: 2026-11-10. Scope: `src/core/`, with `src/server/app.ts`, `src/shared/types.ts` and the core tests read for how they use it. Paths are relative to `src/core/` unless they start with `src/` or `.scratch/`. Audit findings are cited as F1 to F13 from `.scratch/design-review/interaction-audit.md`. Specs are cited as v0:line (`.scratch/pact-v0/spec.md`) and vac:line (`.scratch/vacation/spec.md`).

Baseline: `npx vitest run src/core` passes 41 files and 819 tests in about 22 seconds on Node 22. Core tests total about 14,500 lines. Nearly all of them drive the core through `scenario()` and assert on screen-shaped read models (`today()`, the pact page heat map, `reviewQueue()`, ledgers), not on tables or internal functions (`testing/queries.ts`). This matters for every cost below: a refactor that keeps the read models the same keeps the tests passing, and only intended behaviour changes move tests.

## Summary of verdicts

- H1, one request model: partly right. Unify the lifecycle (filed, decided, withdrawn, thread, deciders, queue, waiting lists) for all five kinds, including evidence and payments. Do not unify payloads or force one effect model. Start with a handler registry over the existing tables; move the lifecycle columns into one table second.
- H2, one cover mechanism: right about the mechanism, wrong if it means one set of product rules. Storage is already identical in shape, and the code already pretends a vacation is an excuse in SQL. The differences in deciders, Weekly count selection and visibility are written down in the vacation spec as deliberate. They belong in per-kind filing and display policy, not in the coverage model. The smallest worthwhile version is one coverage function and one SQL view, with no table merge.
- H3, one place that judges: right, and the most valuable of the four. Keep stored outcomes and penalties, but write them from one `settle` function that compares a pure verdict with what is stored and produces penalties, ends and notifications from the transition. It would have prevented F4, and it turns F1, F8 and F9 into one-place fixes, but it would not by itself have prevented F1 or F9.
- H4, the core interface: wrong as a problem. `AccountView` is a thin, consistent facade that mirrors the HTTP routes one to one, with commands and queries already separated by type. Leave it. `types.ts` is the wire contract and its size is mostly the per-kind duplication H1 removes. `rows.ts` is a grab bag that should shed its feature-specific pieces as H1 lands, nothing more.
- Most important addition: there is no single read of "where an occurrence stands for its owner". Cover state is consulted through five different predicates in about 25 places, each choosing its own subset. That is the direct cause of F7 and F11 and will keep producing that kind of bug. It is cheaper than H3 and should come first.

## H1. One request model

### Verdict

Partly right. The lifecycle is genuinely shared and is already half-unified by accident; the effects are not shared and should stay per kind. Evidence and payments belong in the lifecycle model. They do not belong in a shared payload or a shared "approve does X" model, and nothing is gained by pretending they do.

### Evidence

The five kinds have the same lifecycle columns, copied five times with the same CHECK constraints: `evidence` (migrations.ts), `payment` (migrations.ts), `excuse` (migrations.ts), `change_request` (migrations.ts) and `vacation` (migrations.ts) each carry `decision`, `decided_by_account_id`, `decided_at` and `reject_reason`. Withdrawal exists on two (`change_request.withdrawn_at`, `vacation.withdrawn_at`) and "take the L" on three (`excuse.rejection_accepted_at`, `vacation.rejection_accepted_at`, `evidence.rejection_accepted_at`).

The code already treats them as one item in two places. The `comment` table keys threads by a bare `item_id` with no foreign key, relying on UUIDs not colliding across five tables (migrations.ts). `recordDecision` takes a table name and writes the same four columns on any of the five (rows.ts).

Everything else is written five times. `review.ts` has six switches or sequential probes over the kinds: `decide` (review.ts), `itemToDecide` probing five tables in turn (review.ts), `ownItem` (review.ts), `itemWhat` (review.ts), `itemPath` (review.ts) and `reviewItemSince` (review.ts). `viewPhoto` checks three photo stores separately (review.ts). Each kind has its own queue query (`evidenceToReview` evidence.ts, `excusesToReview` excuses.ts, `paymentsToReview` money.ts, `changeRequestsToReview` change-requests.ts, `vacationsToReview` vacations.ts) and its own owner "waiting" query (`waitingEvidence` evidence.ts, `waitingExcuses` excuses.ts, `waitingPayments` money.ts, `waitingChangeRequests` rows.ts, and none for vacations).

The duplication has already caused drift, which is the audit's evidence:

- Who decides is answered three different ways: current pact reviewers for evidence, excuses and change requests (review.ts), picked reviewers frozen at filing for vacations (vacations.ts), and reviewers of any pact with the recipient for payments (money.ts). F5 is the visible cost.
- The owner's waiting lists disagree. Today lists change requests, evidence, excuses and payments but not vacations (today.ts). The pact page lists change requests, evidence and excuses but not vacations (pacts.ts). F11.
- Waiting-ness itself is computed per kind. `waitingExcuses` uses raw rows and so shows an excuse with no days left (excuses.ts, F8 P5b), while `excusesToReview` also does not filter (excuses.ts).
- Only change requests are withdrawn by the system, silently, in `endPact` (judging.ts, F10). There is no shared notion of "moot", so evidence for an excused or ended day stays in queues (F8 P5a, P5c).
- Cross-kind features the audit recommends (F2 stale-item reminders, F6 payment pause limit, F8 auto-withdrawal, F10 withdrawal reasons) would each have to be written five times today.

### Do evidence and payments belong?

In the lifecycle, yes. F2 is mostly about evidence (a reviewer who never decides defers every penalty) and F6 is about payments (a waiting payment pauses Overdue forever). Those are exactly the items that most need stale reminders and a queue written once. They are also the two highest-volume kinds in the Review Queue.

In the payload and effects, no. Evidence is per occurrence, has a uniqueness rule per occurrence and day (`evidence_one_waiting`, `evidence_one_approved`, migrations.ts), and its decision is an input to judging. A payment is per recipient ledger and its decision only changes a derived total. An excuse and a vacation are covers (see H2). A change request rewrites terms. The handler interface should let each kind say what its decision does; it should not try to describe that in data.

The right cut is therefore "one lifecycle, five payloads, five handlers", not "one request record with a JSON payload". A narrower cut (only excuse, vacation and change request) would leave F2 and F6, the two findings with the most money at stake, outside the shared mechanism.

### Target design

A handler registry in TypeScript, one module per kind, over a shared lifecycle table.

```ts
// request.ts
export type RequestKind = "evidence" | "excuse" | "payment" | "change-request" | "vacation";

export interface RequestRow {
  id: string;
  kind: RequestKind;
  owner_account_id: AccountId;
  filed_at: string;
  decision: "approved" | "rejected" | null;
  decided_by_account_id: AccountId | null;
  decided_at: string | null;
  reject_reason: string | null;
  withdrawn_at: string | null;
  withdrawn_reason: "owner" | "pact-ended" | "moot" | null;
  rejection_accepted_at: string | null;
}

export interface RequestKindHandler<P> {
  kind: RequestKind;
  load(ctx: CoreContext, id: string): P | undefined;          // the payload row
  deciders(ctx: CoreContext, req: RequestRow, p: P): AccountId[];
  /** SQL over `request` giving the requests `?` may decide, for the queue. */
  decidableBySql: string;
  canWithdraw: boolean;
  /** Refusals a decision can meet besides the shared ones (change request: deadline-too-soon). */
  checkDecision?(ctx: CoreContext, req: RequestRow, p: P, d: Decided): DecideRefusal | null;
  /** What the decision does beyond recording it. Usually: settle the occurrences it touches (H3). */
  apply(ctx: CoreContext, req: RequestRow, p: P, d: Decided): void;
  /** Whether no decision could change anything any more (H3 makes this computable for evidence and covers). */
  isMoot(ctx: CoreContext, req: RequestRow, p: P, now: Date): boolean;
  describe(ctx: CoreContext, req: RequestRow, p: P): { what: string; ownerPath: string };
  queueItem(ctx: CoreContext, req: RequestRow, p: P): ReviewItem;
  waitingItem(ctx: CoreContext, req: RequestRow, p: P): TodayWaitingItem;
  decidedNotification(ctx: CoreContext, req: RequestRow, p: P, d: Decided, reviewerId: AccountId): NotificationOf<...>;
  photoIds?(ctx: CoreContext, id: string): string[];
}

export const REQUEST_KINDS: { [K in RequestKind]: RequestKindHandler<any> };

// Written once, over the registry:
export function decide(ctx, reviewerId, id, decision): DecideResult;
export function withdraw(ctx, ownerId, id, reason): WithdrawResult;
export function askOwner(...); export function reply(...);
export function reviewQueue(ctx, reviewerId): ReviewItem[];
export function waitingFor(ctx, ownerId, scope: { pactId?: string }): TodayWaitingItem[];
export function withdrawMoot(ctx, now): void;      // F8, run after each command and each tick
export function remindStale(ctx, t): void;          // F2, a tick step
```

Tables after the second step:

```sql
CREATE TABLE request (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('evidence','excuse','payment','change-request','vacation')),
  owner_account_id TEXT NOT NULL REFERENCES account (id),
  filed_at TEXT NOT NULL,
  decision TEXT CHECK (decision IN ('approved','rejected')),
  decided_by_account_id TEXT REFERENCES account (id),
  decided_at TEXT,
  reject_reason TEXT,
  withdrawn_at TEXT,
  withdrawn_reason TEXT CHECK (withdrawn_reason IN ('owner','pact-ended','moot')),
  rejection_accepted_at TEXT,
  -- the five CHECKs that are now copied five times, once
);
CREATE INDEX request_waiting ON request (kind, filed_at) WHERE decision IS NULL AND withdrawn_at IS NULL;
-- payload tables keep their own columns and use the same id as primary key and foreign key:
-- evidence (id REFERENCES request, pact_id, occurrence_date, day)
-- payment (id REFERENCES request, recipient_id, amount_cents, note)
-- change_request (id REFERENCES request, pact_id, ends_pact, before_terms, after_terms, note)
-- excuse and vacation: see H2 (cover)
CREATE TABLE request_photo (request_id TEXT REFERENCES request (id), position INTEGER, photo_id TEXT UNIQUE, received_at TEXT,
  PRIMARY KEY (request_id, position));
-- comment.item_id becomes request_id REFERENCES request (id)
```

Partial unique indexes such as `evidence_one_waiting` and `change_request_one_waiting` need the decision column next to the payload key. Keep them as checks in the handler's filing code plus a trigger, or keep a denormalised `waiting INTEGER` on the payload table maintained by the shared `decide` and `withdraw`. The second is simpler and keeps the database enforcing the rule.

### Migration order

1. Registry over the existing tables, no migration. Move each kind's `*ToDecide`, `*ToReview`, `waiting*`, `decide*` and the bodies of `itemWhat` and `itemPath` behind a handler. Rewrite `review.ts` as loops over `REQUEST_KINDS`. Tests unchanged.
2. `waitingFor(owner, scope)` written once over the registry and used by Today and the pact page. Decide then, as a product call, whether vacations appear on the pact page (F11). One or two test changes if they do.
3. `withdrawn_reason`, set by `endPact` to `pact-ended` (F10), shown on the change request page. Small migration, a few test assertions.
4. `withdrawMoot` (F8), once H3 gives a reliable `isMoot` for evidence and covers.
5. The `request` table and `request_photo`, with a database wipe. The decision columns move; `recordDecision`, `reviewStateColumns` and the SQL fragments that read `excuse.decision`, `vacation.decision` and `payment.decision` switch to a join. `migrations.test.ts` changes; scenario tests do not.
6. `remindStale` (F2) and the payment pause limit (F6), written once.

### Cost

Step 1: `review.ts` rewritten (378 lines), about 400 lines moved out of `evidence.ts`, `excuses.ts`, `money.ts`, `change-requests.ts` and `vacations.ts` into handler modules, no migration, no test churn. About a day of agent work.

Step 5: one migration, about 60 SQL sites that read or write decision columns across 12 files, `migrations.test.ts`. Medium. Scenario tests should not move.

### What it removes or eases

Makes F2, F5, F6, F8, F10 and F11 each a single change. Removes the five-way switches, so a sixth kind (or a sixth cross-kind rule) costs one handler instead of edits in nine places.

### What it makes worse

One more indirection: reading what an excuse decision does means finding its handler. A `kind` column plus a payload table is a join on every queue read. Both are minor at this scale. The real risk is over-reach: a handler interface that tries to describe effects declaratively, or a single payload table with JSON, would make the model worse. Keep `apply` as plain code.

## H2. One cover mechanism

### Verdict

Right that excuse and vacation are one mechanism, and the code already says so. Wrong if it means unifying the product rules: the differences are written down as deliberate. Model them as filing and display policy on one cover concept. The table merge is the least valuable part.

### Evidence that they are one mechanism

- Storage is the same shape. `excuse_day (excuse_id, pact_id, date)` (migrations.ts) and `vacation_day (vacation_id, pact_id, date)` (migrations.ts) both key a covered occurrence by its date, a Weekly count week by its Monday, and the vacation migration says "as excuse_day".
- The SQL already aliases one as the other: `vacationCoversSql` joins `vacation AS excuse` so the same condition text works for both (occurrence-state.ts), and `excuseCoversSql` covers both (occurrence-state.ts). `PENALTY_HELD` is built on it (money.ts).
- Approval runs the same code: `decideVacation` calls `excuseApprovedDays` per pact (vacations.ts).
- The occurrence-level reads already merge them, but inconsistently: `excuseOn` returns `waiting`, `approved` or `vacation-waiting` (occurrence-state.ts), `vacationOn` returns its own view (occurrence-state.ts), `stillToDo` treats a waiting excuse and a waiting vacation differently (occurrence-state.ts), and the reminder check reads only `approved` (reminders.ts).
- The naming is misleading: the shared helpers are named after excuses, so a reader of `judging.ts` cannot see that vacations are included.

### Are the differences deliberate?

| Difference | Where | Deliberate? |
|---|---|---|
| Deciders fixed at filing, picked by the owner | vacations.ts | Yes, vac:69 ("The picked reviewers are fixed when the vacation is filed") and vac:70. F5 shows the cost; I would change the rule (any picked reviewer or any current reviewer of a covered pact), but that is a product call, not an accident. |
| Weekly count: a vacation covers a week only if its Thursday is inside; an excuse covers it from any day | vacations.ts, judging.ts | Yes, vac:58 gives the reason. It is a filing rule: both store the Monday, so coverage is evaluated identically once filed. |
| Visibility: vacations on Profile, not on Today or the pact page | today.ts, pacts.ts | Today: yes, vac:104. Pact page: not specified (F11). |
| A waiting vacation keeps To do cards; a waiting excuse hides them | occurrence-state.ts | Yes for vacations, vac:104. For excuses, the card is hidden while the reminder still fires (F7): that half is an accident. |
| Vacation covers only occurrences not yet open; excuse covers not judged or Missed within 48 hours | vacations.ts, occurrence-state.ts | Yes, vac:56 and v0 excuses section. |
| Vacation can be withdrawn; excuse cannot | vacations.ts, v0:257 | Yes for v0. |
| Vacation spans pacts; excuse is one pact | migrations.ts | Yes, and already modelled by `pact_id` on the day row. |

So every difference except F7 and F11 is a deliberate rule, and every one of them is about filing (which days, which deciders) or display (where the owner sees it). None is about what a cover does to an occurrence once filed. That is the boundary to draw.

### Target design

One coverage read, written once, with the kind and state of the cover:

```ts
// covers.ts
export type CoverKind = "excuse" | "vacation";
export interface Cover { id: string; kind: CoverKind; state: "waiting" | "approved"; filedAt: Date; decidedAt: Date | null }
/** The one cover that counts for the occurrence, by the precedence rules in one place; null for none. */
export function coverOn(ctx: CoreContext, pactId: string, date: LocalDate): Cover | null;
/** SQL: the occurrence (pact, date expressions) has a cover in `state`. Reads the `cover_day_v` view. */
export function coveredSql(pact: string, date: string, state: "waiting" | "approved" | "any"): string;

export interface CoverPolicy {
  kind: CoverKind;
  /** Whether Today keeps the To do card, and reminders keep firing, while it waits. One flag, read by both. */
  keepsToDoWhileWaiting: boolean;
  /** Which occurrences a filing with these dates takes (Thursday rule lives here). */
  select(ctx, pactId, from, to, now): { covered: OccurrenceSpan[]; skipped: Skipped[] };
}
```

A SQL view gives one place for all cover reads without a table merge:

```sql
CREATE VIEW cover_day_v AS
  SELECT 'excuse' AS kind, e.id AS cover_id, d.pact_id, d.date, e.filed_at, e.decision, e.decided_at, NULL AS withdrawn_at
    FROM excuse_day d JOIN excuse e ON e.id = d.excuse_id
  UNION ALL
  SELECT 'vacation', v.id, d.pact_id, d.date, v.filed_at, v.decision, v.decided_at, v.withdrawn_at
    FROM vacation_day d JOIN vacation v ON v.id = d.vacation_id;
```

If H1 step 5 happens, the full merge is cheap to add at the same time: `cover (id REFERENCES request, kind, reason_or_note, pacts_summary)`, `cover_day (cover_id, pact_id, date)`, `cover_reviewer (cover_id, reviewer_account_id)` used only by vacations. Do it then, not before.

F9 needs a rule in `coverOn`, not a new table: a cover counts for an occurrence only if that occurrence was on the schedule when the cover was filed. The cheapest correct version is the audit's option A (delete `excuse_day` and `vacation_day` rows for days an approved change removes, in `applyTerms`, change-requests.ts). Doing it inside `coverOn` would require comparing `filed_at` with the terms epoch in `pact_earlier_terms`, which is more code for the same result.

### Migration order

1. Add `cover_day_v`. Rewrite `excuseCoversSql` and `vacationCoversSql` as `coveredSql` over it. Behaviour identical, no test changes.
2. Add `coverOn` and replace `excuseOn`, `vacationOn` and `stillToDo` at their call sites (anki-days.ts, bedtime.ts, bedtime.ts, evidence.ts, excuses.ts, history.ts, judging.ts, judging.ts, reminders.ts, today.ts, today.ts, today.ts, today.ts, today.ts, vacations.ts). Behaviour identical.
3. Add `keepsToDoWhileWaiting` and read it from both Today and `worthReminding`. This fixes F7; one or two tests change, one is added.
4. Delete cover day rows in `applyTerms` for removed days (F9). One test added.
5. Only with H1 step 5: merge the tables.

### Cost

Steps 1 to 4: `occurrence-state.ts` (about 120 lines replaced), about 25 call sites in 10 files, one migration that adds a view. Small to medium. Steps 1 and 2 have no test churn.

### What it removes or eases

F7 fixed in step 3. F9 fixed in step 4. F11 becomes a one-line display choice. F3 (a waiting vacation eats the excuse window) becomes a single rule change in one place if the product wants option A or B. F12 stays a filing policy, which is where it belongs.

### What it makes worse

Nothing significant. The one risk is that a merged table invites someone to "simplify" the deliberate filing differences away. Keeping `CoverPolicy` per kind with the spec reference in its comment guards against that.

## H3. One place that judges

### Verdict

Right. This is the change with the highest value per line, because it is where money is decided and where the audit's confirmed bugs live. Keep stored outcomes and penalties, but make them the output of one reconciling function. Derive "held" as now, through `coverOn`.

### Evidence

There are seven call sites that decide whether and how to judge an occurrence, each with its own copy of the precedence rules (approved evidence beats an approved cover, which beats a miss; waiting evidence defers):

1. `judgeAtDueTime` for Fixed days and One-time (judging.ts).
2. `judgeWeek` for Weekly count, with a `tell` flag (judging.ts).
3. `decideEvidence`, with its own `excusedAhead` rule, its own `judgingReached` and `dueAfterEnd` checks, and a call to `judgeWeek` with `tell=false` (evidence.ts).
4. `excuseApprovedDays`, used by both excuse and vacation approval, which rewrites Missed to Excused and deletes the penalty directly (excuses.ts).
5. `judgeNights` for bedtime, with its own excuse precedence (bedtime.ts).
6. `recordAnkiChecks`, which judges Satisfied without consulting covers (anki-days.ts).
7. The change-request branch of `decide`, which runs a catch-up `judgePactDueBy` before approving (review.ts), something no other decision does.

Notifications about outcomes are emitted by four of these, each deciding for itself whether the owner should hear (judging.ts, judging.ts, bedtime.ts and 207, and nowhere in `decideEvidence` or `excuseApprovedDays`). Ending a pact is a side effect hidden inside `judge` for One-time (judging.ts), and ending silently withdraws change requests (judging.ts).

"Belongs to the pact" is asked through `dueAfterEnd` in five places (evidence.ts, excuses.ts, excuses.ts, excuses.ts, vacations.ts), and its rule (due after `ended_at`, occurrence-state.ts) combines with `endPact(now)` in `decideChangeRequest` (change-requests.ts) to produce F1.

### Would it have prevented the four findings?

- F4 (Weekly count week judged Missed by a late decision gets no push): yes. The bug is a `tell=false` passed by the second call site on the comment's assumption that the decision push says enough (judging.ts, evidence.ts). If the missed push is produced by comparing the old outcome (none) with the new one (Missed, not covered), there is no flag to get wrong.
- F1 (approving an end drops the open occurrence): partly. The bug is a rule choice: `endPact(now)` combined with "occurrences due after the end are not the pact's". With one verdict function the rule is stated once ("an occurrence that opened before the end is judged"), and the three end paths would all go through one `endPact(pactId, cause)` that sets `ended_at` itself. That makes the fix one line and the inconsistency visible. It would not have stopped an author from writing the wrong rule once.
- F8 (dead items stay in queues): partly, and in combination with H1. A pure verdict lets `isMoot` be computed instead of hand-written: evidence is moot when the verdict is final and the same whether the evidence is approved or rejected; a cover is moot when none of its days' verdicts would change. Without H3 each moot rule is another hand copy of the precedence rules.
- F9 (a row re-covers a day a change adds back): no. That is a data identity problem (cover rows keyed by date, not by the occurrence as it existed). H3 gives one facts loader where the filter would go, but the fix is H2 step 4.

### Stored or derived?

Keep the stored `occurrence.outcome`, `occurrence.judged_at` and `penalty` rows. Reasons:

- Bills point at penalty rows (`penalty.bill_id`, migrations.ts) and a bill never changes once made (GLOSSARY "Bill"). Derived penalties would need their own immutability story.
- `judged_at` drives the 48-hour excuse window, the Missed alerts and history, and money queries aggregate penalties in SQL (money.ts). Deriving at read time would move the whole verdict into SQL or recompute it in TypeScript on every ledger read.
- A verdict depends on time and on facts that arrive late (Oura, Anki, decisions), so "when was it judged" is history, which a stored row records naturally.

What changes is that the rows become a cache with exactly one writer. Keep "held" derived, through `coverOn`; it changes with cover decisions and withdrawals, and storing it would add a second write path for no gain.

### Target design

```ts
// verdict.ts: pure, no ctx
export interface OccurrenceFacts {
  occurrence: Occurrence;                    // opensAt, dueAt, closesAt, date
  terms: { penaltyCents: number; recipientId: string; schedule: Schedule };   // termsOn
  pactEndedAt: Date | null;
  evidence: { day: LocalDate; submittedAt: Date; decision: "approved" | "rejected" | null; decidedAt: Date | null }[];
  automatic:
    | { kind: "oura"; firstBedtimeStart: string | null; arrivedAt: Date | null; inBedBy: ClockTime }
    | { kind: "anki"; finishedAt: Date | null; checkRunning: boolean }
    | null;
  cover: Cover | null;                        // from coverOn, after the F9 filter
}

export type Verdict =
  | { kind: "not-the-pacts" }                 // opened at or after the pact ended
  | { kind: "open" }                          // not due and nothing final yet
  | { kind: "waiting"; on: "evidence" | "oura" | "anki-check" }
  | { kind: "satisfied"; at: Date }
  | { kind: "excused"; at: Date; coverId: string }
  | { kind: "missed"; at: Date; penaltyCents: number; recipientId: string };

export function verdictOf(facts: OccurrenceFacts, now: Date): Verdict;

// settle.ts: the only writer of occurrence.outcome, occurrence.judged_at and penalty
export function settle(ctx: CoreContext, pactId: string, date: LocalDate, now: Date): Transition | null;
export function settleAll(ctx: CoreContext, t: Date, anki: AnkiChecksRunning): void;  // the tick: replaces judgeDueBy and judgeNights' judging
type Transition = { from: Verdict["kind"] | null; to: Verdict };
```

`settle` loads the facts, computes the verdict, compares it with the stored row and applies the difference: insert or update the occurrence row, insert or delete the penalty, end a One-time pact, and enqueue the missed push when the transition is into Missed and no cover holds it. Commands that change a fact call `settle` for the occurrences they touch: evidence submitted or decided, cover filed, decided or withdrawn, change approved, pact ended, Oura or Anki data recorded. `judged_through` stays as the tick's cursor; `judgingReached` disappears, since "due by now" is part of the verdict.

Two prerequisites. Bedtime must store the first qualifying sleep period as a fact when it arrives (today it is written to `occurrence.bedtime_start` only after judging, bedtime.ts). Anki already stores checks in `anki_check`; the in-memory running checks are passed in as now.

Add a guard to `scripts/check-conventions.ts`: `INSERT INTO penalty`, `DELETE FROM penalty` and `SET outcome` may appear only in `settle.ts` (and migrations). For a codebase maintained by an AI this mechanical rule is worth more than the comment that explains it.

`verdictOf` should be tested at its own interface, as `occurrences.ts` already is, because the combinations (late decision after due, cover approved before and after due, ended mid-week, Oura late period with an approved cover) are many and cheap to enumerate in a table. That is a second exception to "test through `scenario()`" and needs a sentence in `CODING_STANDARDS.md`.

### Migration order

1. Write `verdictOf` and its table-driven test beside the current code, unused. Add a debug assertion in tests (a scenario hook) that after each command the stored outcome equals `verdictOf` for every touched occurrence. Run the suite: every mismatch is either a current bug or a rule the function has wrong. This step is where the value is found, and it is safe.
2. Replace `judgeAtDueTime` and `judgeWeek` in the tick with `settle`. Tests pass.
3. Replace the judging in `decideEvidence` with `settle`. Fix F4 here; add the test the audit's P2 probe describes.
4. Replace `excuseApprovedDays` with `settle` over the cover's days, for excuses and vacations.
5. Move bedtime and Anki onto `settle` (store the sleep fact first).
6. Remove the change-request catch-up in `review.ts` (the tick and `settle` make it unnecessary) and route all three end paths through one `endPact(pactId, cause)`. Fix F1 here; change the test at change-requests.test.ts and the confirmation copy.
7. Add the conventions guard.

### Cost

New `verdict.ts` (about 200 lines) and `settle.ts` (about 200), deletions in `judging.ts`, `evidence.ts`, `excuses.ts`, `vacations.ts`, `bedtime.ts`, `anki-days.ts`, `review.ts` and `occurrence-state.ts` (`judgingReached`, `dueAfterEnd`). Roughly 800 to 1,200 lines touched. One small migration if the sleep fact needs its own column. Scenario tests should pass unchanged except where a bug is fixed on purpose (F1, F4) and where a `judged_at` moves by a tick. Expect two or three days of agent work, most of it in step 1.

### What it makes worse

`settle` must be called after every fact change; forgetting it leaves a stale outcome until the next tick. Mitigate by calling it from the shared `decide` in H1 and from each filing command, and by the test assertion from step 1, kept permanently. The verdict function will be the densest code in the core; that is the point, but it needs the table test to stay readable.

## H4. The core interface

### Verdict

Not a problem. Leave `AccountView` as it is. `types.ts` and `rows.ts` have small, specific issues, none of which justify a restructure.

### Evidence

`AccountView` has 56 methods (core.ts). Every one is a one-line delegation to a feature function, wrapped in `#command` for writes (core.ts). In `src/server/app.ts` each route makes exactly one call through `account(c)` (app.ts, then app.ts), so the interface is the application layer the HTTP routes map onto, and the mirroring is the design (`CODING_STANDARDS.md`, "The core owns every domain rule"). Reads and commands are already separated: 31 commands return `Promise` and run in one transaction; 24 queries are synchronous; `photo` is the one documented async query. The tests use the same surface through `AccountHandle` (testing/scenario.ts), with `decide` (207 uses), `today` (180) and `reviewQueue` (95) dominating.

The doc comments on the interface are the only place several rules are stated in full (for example `decide`, core.ts, and `fileExcuse`, core.ts). That is valuable for an AI reader and argues for keeping one interface.

What to change, and only as a consequence of H1: the per-kind owner commands collapse. `withdrawChangeRequest` and `withdrawVacation` become `withdraw(itemId)`; `acceptExcuseRejection` and `acceptVacationRejection` become `acceptRejection(itemId)`; `evidence`, `payment`, `excuse` and `changeRequest` pages could become `request(itemId)`. That removes four to six methods and their routes. It is optional.

Do not split `AccountView` into sub-objects or separate read and write interfaces. It would change 60 routes and about 600 test call sites to buy nothing a reader cannot already get from the method signature.

`src/shared/types.ts` (1,702 lines, 161 exports) is the JSON contract both sides import. Its size comes from screen-shaped read models and from per-kind duplication: five `ReviewItem` variants (types.ts), the `TodayWaitingItem` variants (types.ts), five accept and withdraw result types, and the parallel `OccurrenceStatus` fields `held` and `heldByVacation` (types.ts). H1 and H2 shrink it where it matters. Splitting the file by feature with a barrel is harmless but buys little, since an agent finds types by name, not by scrolling; do it only if a feature touches it heavily anyway.

`rows.ts` (515 lines) describes itself as "reads the other parts of the core share". Most of it is genuinely shared (terms, names, occurrences, accounts). Three things are misplaced and would move with H1: `recordDecision`, `reviewStateColumns`, `reviewStateOf`, `thread` and `Decided` (the request lifecycle), and `waitingChangeRequests` and `todayKeeps` (change-request features). Moving them is part of H1 step 1, not a task on its own.

## More important than the four: one read of an occurrence's state

The write side has seven judging paths (H3). The read side has more. Where an occurrence stands for its owner, especially its cover state, is answered by five predicates that each pick a different subset:

- `excuseOn` (occurrence-state.ts): waiting excuse, then approved excuse or vacation, then waiting vacation.
- `vacationOn` (occurrence-state.ts): vacation only.
- `stillToDo` (occurrence-state.ts): hides the card for a waiting excuse, keeps it for a waiting vacation.
- `excuseCoversSql` and `vacationCoversSql` (occurrence-state.ts): SQL versions with caller-supplied conditions, used with three different condition strings in `evidence.ts`, `evidence.ts` and `today.ts`.
- Reminders read only `excuseOn(...) === "approved"` (reminders.ts).

These are consulted in about 25 places across Today, reminders, history, money, bedtime, Anki, evidence and excuses. F7 is a direct result (Today uses `stillToDo`, reminders use their own test), F11 is a variant (the pact page and `occurrenceStatus` hide vacation-waiting, occurrence-state.ts), and every new screen or notification will pick its own subset again.

The fix is a single derived view of an occurrence, built on `coverOn` and, once H3 lands, on `verdictOf`:

```ts
export interface OccurrenceView {
  verdict: Verdict;                    // H3
  cover: Cover | null;                 // H2
  held: boolean;                       // missed and cover waiting
  toDo: boolean;                       // what Today shows and reminders use, one rule
  remind: boolean;
  excusableUntil: Date | null;
  evidence: "none" | "waiting" | "approved" | "rejected";
}
export function occurrenceView(ctx: CoreContext, pactId: string, occurrence: Occurrence, now: Date): OccurrenceView;
```

`occurrenceStatus` (occurrence-state.ts) is already a partial version of this; it should become the only one, with the per-kind display flags from `CoverPolicy`. This is H2 steps 1 to 3 in practice, so it costs nothing extra if H2 is done in that order.

Two smaller structural points that will cause real bugs:

- Occurrence identity is `(pact_id, date)`, and facts reference it without a foreign key on cover rows. Re-dating a One-time deadline rewrites keys in four tables by hand (`moveOneTimeOccurrence`, pacts.ts), and a day removed and re-added by changes is the same key (F9). Any new fact table about occurrences must remember to join `moveOneTimeOccurrence` and the F9 cleanup. Write that down at the top of `occurrence-state.ts` and in the conventions check if possible (a new table with `pact_id` and `date` columns must appear in `moveOneTimeOccurrence`).
- The rule "a held penalty is never billed, so an excuse never reaches a billed penalty" rests on 48-hour arithmetic (audit row "Waiting excuse" 7) and owed is clamped at zero (money.ts), which hides any violation (F13). After H3, `settle` should throw if it would delete a penalty with a `bill_id`. A loud failure is better than an invisible credit.

## Ranked list of what to do

1. H2 steps 1 to 3 as "one read of cover state": the `cover_day_v` view, `coverOn`, `coveredSql`, `CoverPolicy.keepsToDoWhileWaiting`, and `occurrenceStatus` as the single occurrence view. Fixes F7, sets up F11 and F3. Small to medium, almost no test churn.
2. H3 step 1: `verdictOf` with its table test and the permanent test assertion that stored outcomes match it. Safe, finds bugs, decides the rest.
3. H3 steps 2 to 7: `settle` as the only writer, transition-based notifications, one `endPact`, the conventions guard. Fixes F1 and F4. Medium.
4. H2 step 4: delete cover days a change removes. Fixes F9. Small.
5. H1 steps 1 and 2: the handler registry over existing tables and one `waitingFor`. No migration. Medium.
6. H1 steps 3, 4 and 6: withdrawal reasons (F10), moot withdrawal (F8, using `verdictOf`), stale reminders and the payment pause limit (F2, F6). Each small once 5 exists.
7. H1 step 5 with H2 step 5: the `request`, `request_photo` and `cover` tables, in one database wipe. Medium, only worth doing when the next cross-kind feature or a sixth kind is on the table.
8. Optional, with H1: collapse the per-kind withdraw, accept-rejection and item-page methods on `AccountView`.

## Do not do

- Do not derive occurrence outcomes and penalties at read time. Bills reference penalty rows, the excuse window reads `judged_at`, and the money queries aggregate in SQL. One writer is the goal, not zero rows.
- Do not put all five kinds in one table with a JSON payload, and do not describe decision effects as data. Lifecycle shared, payload and `apply` per kind.
- Do not merge the excuse and vacation filing rules (Thursday rule, picked reviewers, only unopened days, withdrawal) in the name of H2. They are deliberate in the spec. Change any of them only as a product decision, starting with F5.
- Do not split `AccountView` into sub-interfaces or separate read and write facades. It is a correct thin facade and the route mapping depends on it.
- Do not split `types.ts` or `rows.ts` as standalone tasks. Let H1 and H2 shrink them.
- Do not start with the table merges (H1 step 5, H2 step 5). They carry the migration and SQL churn and fix no audit finding by themselves.
- Do not introduce event sourcing or a domain event bus to get "notifications from transitions". The transition in `settle` and the shared `decide` in H1 are enough.
