# The owner picks which reviewers decide a vacation, and the others are never told

Status: done
Blocked by: none

## Decision

The owner keeps picking who decides a vacation, and every other reviewer of a covered pact is told when it is approved (the recommended answer). The push's words and the "Pacts you review" setting were accepted as written below, with no prototype.

## Problem

Found in a review of the rules as an owner who wants to avoid penalties. A vacation covers several pacts for up to 62 days. The owner picks its deciders from the pacts' reviewers, and only those are told or can see it (`fileVacation`, `vacationDeciders`, `src/core/vacations.ts`; rule R5 in `.scratch/design-review/spec.md`). One approval excuses every covered day of every covered pact.

An owner with one lenient reviewer on one pact can pick only that reviewer. The reviewers of the other covered pacts never learn that two months of their pact were excused. An excuse does not have this gap: every reviewer of its pact is told and may decide it.

## What to build

Rule: when a vacation is approved, every reviewer of a pact it covers is told, except the reviewer who approved it. Who decides a vacation does not change (rule R5).

- In `decideVacation` (`src/core/vacations.ts`), on an approval, after the days are settled: for each pact that has at least one day of the vacation (`vacation_day`) at that moment, take its current reviewers. Tell each of them once, except the approver. This includes a picked decider who did not decide: today they only see the item leave their queue.
- The push names only the covered pacts that recipient reviews, so no reviewer learns of a pact they do not review. New notification kind `vacation-approved` (`NotificationKind` and `NotificationDetails`, `src/core/ports.ts`), details `{ vacationId, pactIds }` with the pacts named to that recipient.
  - Title: "Jordan's vacation was approved".
  - Body: "Jan 5 to Jan 19 covers Gym. Sam approved it." Pacts by name, oldest first: one, "A and B", or "A, B and 2 more". The dates are the vacation's first and last day, worded as the vacation-decided push words them (`dateSpan`).
  - It opens Review (`APP_PATHS.review`).
- Nobody else is told of a filing, a rejection or a withdrawal: only an approval excuses days. The others cannot undo an approval; they know, and they know who gave it.
- A reviewer added to a covered pact after the approval is not told. A pact the vacation ticked but covers no day of is not named.
- No stored data changes and there is no migration. Vacations approved before this are not told.

The push follows a new notification setting, `reviewed-pact`, shared by tickets 42, 43 and 44; the first of the three to be built adds it. Add it to `NOTIFICATION_SETTINGS` (`src/shared/types.ts`), to `SETTING_OF_KIND` (`src/core/outbox.ts`) and to `SETTING_COPY` (`src/client/Notifications.tsx`) with the label "Pacts you review". Its hint lists what is built so far, for all three: "A friend added a reviewer, changed timezone, or had a vacation approved on a pact you review". It starts on, as every push setting does, and needs no migration (`notification_setting_off` holds only what is off). The randomised test keeps its own copy of the kind-to-setting map for `messages-follow-settings` (`src/core/testing/fuzz-invariants.ts`); add the new kind there.

`docs/behaviour.md`, Vacations: the line that starts "Only its deciders are told" gains "When it is approved, every other reviewer of a pact with a covered day is told, with the dates, the pacts they review and who approved it (`decideVacation`, `vacations.ts`)." The Notifications section's list of settings gains the new one. `GLOSSARY.md` (Vacation) stays true as written.

## The alternative

A vacation covers a pact only once one of that pact's own reviewers approved it, so it is approved pact by pact. It is the fairest rule. It is not recommended: one vacation would be Excused for some pacts and waiting for others, which every screen that shows a vacation (the Profile card, the review item, Today's waiting list, the held penalties) and the rule for when it is moot would have to learn. A smaller version, refusing a filing unless each covered pact has one of its own reviewers among those picked, does not close the loophole: any one decider still approves the whole vacation.

## Tests to write first

Scenarios in `src/core/vacations.test.ts`:

- A vacation over two pacts, decided by the one picked reviewer of the first: on approval the reviewer of the second gets the push naming only the second pact and the approver.
- A reviewer of both pacts who was not picked gets one push naming both.
- A picked decider who did not decide gets the push; the approver does not.
- A rejection and a withdrawal tell no other reviewer.
- A ticked pact with no covered day is not named, and a reviewer of only that pact is not told.
- With the setting off, the reviewer gets nothing (`src/core/notifications.test.ts`).

## Prototype

User-visible, but small: one push and one row in notification settings, with no new screen. The words are all above. Recommended: approve or correct the words here and build directly. `docs/agents/prototype-first.md` makes this the human's choice.

## Acceptance criteria

- [x] Every reviewer of a pact a vacation covers, but the approver, is pushed when it is approved, with the dates, their pacts and who approved.
- [x] The push follows the "Pacts you review" setting.
- [x] `docs/behaviour.md` (Vacations; Notifications and reminders) says so.
- [x] The scenarios above pass.
- [x] `npm run check` passes.

## Outcome

Built as planned. On an approval `decideVacation` (`vacations.ts`) calls `tellOtherReviewers`, after the days are settled: for each pact with a `vacation_day` of the vacation, oldest first, its current reviewers but the approver each get one `vacation-approved` push naming only the pacts they review (`pactNamesText`, `src/shared/format.ts`). It reuses the `reviewed-pact` setting from ticket 42; the setting's hint now has the full words, "A friend added a reviewer, changed timezone, or had a vacation approved on a pact you review".

Differs from the plan, or beyond it:

- The dates are worded by `dateSpan`, as the spec says and as the vacation-decided push words them: "Jan 5 – 19 covers Gym. Sam approved it.", not the spec example's "Jan 5 to Jan 19".
- The `docs/behaviour.md` sentence is added to the end of the Vacations line that starts "Only its deciders are told".
- Tests: `vacations.test.ts`, "the other reviewers of covered pacts hear of an approval"; `notifications.test.ts`, "Pacts you review turned off: a reviewer isn't told of an approved vacation".
- `npm run check` was run in its parts (shellcheck isn't installed where this was built, so its lint step wasn't run).
