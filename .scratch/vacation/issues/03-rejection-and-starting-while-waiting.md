# 03 Rejected vacations, and vacations still waiting when they start

Status: done
Blocked by: 02

Spec: `../spec.md` stories 15 to 17 and 25, Rules ("Withdrawing"), Reviewing ("Rejecting"), Judging and money ("Waiting when it starts", "Held penalties"), and Screens (the rejected-vacation alert, the review item's held lines and copy, the withdraw confirm with held penalties). These follow the excuse rules in `.scratch/pact-v0/spec.md` (Excuses) and ticket `.scratch/pact-v0/issues/07-excuses.md`, which this reuses.

## What to build

A vacation still waiting for approval when its first day comes works like a waiting excuse: occurrences are judged as usual, the penalties of covered Missed occurrences are held, and reminders keep going. Approval then makes them Excused and removes the penalties; rejection or withdrawal makes them owed. A rejection raises an alert on Today with the reason and Take the L.

### Core
- **Waiting coverage.** Widen `excuseOn` and `excuseCoversSql` for a waiting vacation (not decided, not withdrawn) as for a waiting excuse, so `PENALTY_HELD` holds its covered penalties and judging sends no Missed push for a covered occurrence. Callers that must tell a waiting vacation from a waiting excuse get it from the helpers:
  - Today keeps the To do card of a day on a waiting vacation (an excuse waiting takes it out), and reminders keep firing for it.
  - A covered Missed occurrence leaves Today's Missed section while the vacation waits, and its label reads "Missed · vacation waiting for approval".
  - `skipReason` reports "on-waiting-vacation" for it (from ticket 01).
- **Approve after it started:** covered occurrences already Missed become Excused and their penalties are removed, whenever they were judged; the rest are judged Excused at their due times. All or nothing, for every pact.
- **Reject:** held penalties become owed and go on the next Wednesday bill once their 48 hours are up; covered occurrences not judged yet are judged as usual; no 48-hour window restarts.
- **Withdraw after it started:** the same release as a rejection, with no alert.
- **Rejected-vacation alert** (`TodayAlert` kind "vacation-rejected"): the reviewer's name, the reason, the first and last day, and the penalties it held that are owed again. It stays until the owner takes the L on it, or files a new vacation or an excuse covering any of its days. **Take the L** on it records `rejection_accepted_at` and also takes the L on the Missed occurrences it covered, as `acceptExcuseRejection` does. Newest rejection first among the alerts.
- **Ledger history:** a held penalty a vacation holds reads "Held while a vacation waits for approval", grey with no "+".
- **Review item:** the covered days already Missed, each with "$5 held", and the held total.

### Client
- **Today:** the rejected-vacation alert: "Sam rejected your vacation", the reason in quotes, "Dec 20 – Jan 2 · your pacts keep all their days" or "Dec 20 – Jan 2 · $15 is owed again", and **Take the L**, with no confirmation.
- **Review item:** held days in Covers, "Approving removes $15 in held penalties." before the approve copy, and the reject form's "Rejecting makes $15 owed again and leaves the days not judged yet to be judged as usual."
- **Profile:** the withdraw confirm says "$15 held becomes owed." when the vacation holds penalties.

## Acceptance criteria (core scenarios)

- [x] Waiting at its first day: a Mon/Wed/Fri $5 pact's Mon+1 with no evidence is Missed at midnight with its $5 held, owed stays $0, no Missed push is sent, the reminder on Wed+1 still fires, and Wed+1's To do card is on Today.
- [x] Then approved on Tue+1: Mon+1 becomes Excused, its penalty is gone from the ledger history, and Wed+1 and Fri+1 are judged Excused at their due times.
- [x] Then rejected instead: owed is $5 at once, Mon+1's penalty goes on the next Wednesday bill once its 48 hours are up, Wed+1 is judged as usual, and the owner has a rejected-vacation alert saying $5 is owed again.
- [x] Rejected before its first day: the alert says the pacts keep all their days and nothing is owed.
- [x] After the rejection, an excuse for Mon+1 inside its original 48 hours is accepted and clears the alert; one after the 48 hours is refused.
- [x] After the rejection, a new vacation for days not open yet is accepted and clears the alert.
- [x] Take the L on the alert clears it and Mon+1's Missed card, and owed doesn't change.
- [x] Withdrawn after Mon+1 was Missed: $5 is owed at once, and there's no alert.
- [x] A held penalty never goes on a Wednesday bill while the vacation waits.
- [x] A Weekly count week on a waiting vacation that's short at the end of its Sunday is Missed with each short day's penalty held; approval removes them all.
- [x] A waiting vacation and its holds survive a restart.
- [x] Routes for Take the L on a rejected vacation (`src/server/app.test.ts`).

## Acceptance criteria (screens)

- [x] Checked in the browser at 390×844, with screenshots: the rejected-vacation alert in both wordings, the review item with held days, the reject form's held copy, the withdraw confirm with held penalties, and the ledger history's held line.

## Manual checks

In `../manual-checks.md` (After ticket 03): the rejection push on a real phone, opening Today with the alert.

## Comments

### 2026-11-08: built (agent)

Built on `claude/gifted-lovelace-j4797v`. Every acceptance criterion has a scenario in `src/core/vacations.test.ts`, under "a vacation still waiting when its first day comes", "deciding a vacation after its first day", "after a rejection", "while a vacation waits after its first day" and "held penalties on the review item and the Profile card". The route test is in `src/server/app.test.ts`. No existing test's expectations changed.

How each coverage-helper caller treats a vacation still waiting after its first day:
- `excuseOn` returns a new "vacation-waiting", so callers that compare with `"approved"` don't change: reminders, the AnkiWeb check and `decideEvidence`'s excused-ahead check keep going. Judging's `excuse === null` check still sends no Missed push.
- Today's To do and bedtime cards and the No Oura data push use the new `stillToDo(ctx, pactId, date)`. A waiting vacation keeps them, but a waiting excuse doesn't.
- `occurrenceStatus` marks a covered Missed occurrence held, with `heldByVacation`. `skipReason` gives "on-waiting-vacation", and the day chip reads "Missed · vacation waiting for approval".
- `excuseCoversSql` already covered approved vacations and now covers waiting ones too. So `PENALTY_HELD` holds the penalty, `recentlyMissed` hides the day, and the rejected-evidence and rejected-day alerts stand down while it waits, the same as for a waiting excuse.
- After a rejection, `recentlyMissed` hides the days Missed before it only while the vacation's alert stands, through `noLaterFilingSql`. If a new vacation clears the alert, those days come back to Missed for the rest of their 48 hours.

One deviation from "as `acceptExcuseRejection` does": Take the L accepts only the covered days already Missed when the vacation was rejected. A vacation covers days ahead, so a day judged after the rejection, such as Wed+1, keeps its own Missed card and 48 hours. Accepting it with the vacation would clear a day the owner never saw.

`heldCents`, `held` and `heldByVacation` are optional and left out when nothing is held, so the existing exact-match tests stay unchanged. A held Weekly count penalty shows on the review item as its week.

The ledger's held line is the spec text alone. Unlike the excuse line, it has no "Goes on the X bill if rejected", because a withdrawal also makes the penalty owed.

The screenshots of the alert in both wordings, the review item, the reject form, the withdraw confirm and the ledger's held line were sent in the chat. The prototype has no held-penalty variants, so those screens follow the spec copy.
