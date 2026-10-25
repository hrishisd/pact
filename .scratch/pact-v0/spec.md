# Pact v0 — spec

Confirmed with the owner on 2026-10-24. Vocabulary follows `GLOSSARY.md`. Decisions: `docs/adr/`.

## Overview

Pact is a phone-first web app, installed to the home screen as a PWA. It helps people keep commitments by putting money on the line. An **owner** makes **pacts**. A friend acting as **reviewer** checks the owner's **evidence** and **excuses**. Missed **occurrences** add a **penalty** to a **ledger**, which the owner pays off manually. v0 has no automatic payments and no AI review.

Two pacts v0 must be able to express:

- **Bedtime**: "In bed before 12:00am every night", verified automatically with Oura Ring sleep data.
- **Gym**: "Go to the gym Mon/Wed/Fri" or "3× per week", verified with a photo checked by a reviewer.

This spec covers the product and its user flows only. The tech stack will be decided separately.

## Accounts and friends

- Sign-in is **Google only**.
- Every account can own pacts and review pacts. Owner and Reviewer are roles on a particular pact, not account types.
- An owner can never review their own pact.
- **Friends**: tap "Invite friend" to create a link and share it through the phone's share sheet. The friend opens it, signs in with Google, and accepts. A link works once and expires after 7 days. Reviewers and person recipients must be friends.
- v0 has no way to unfriend.
- Each account has a **timezone**. It's taken from the browser at sign-up and can be changed in Profile.

## Pacts

### Definition

A pact consists of:

| Field | Notes |
|---|---|
| Name and description | The description says what counts as evidence, e.g. "photo of me inside the gym". |
| Evidence type | Exactly one: **Oura bedtime** or **Photo**. Either works with any schedule. |
| Schedule | **Fixed days**, **Weekly count**, or **One-time** (see below). |
| Start date | Optional. |
| End date | Optional. Recurring schedules only. |
| Time window | Optional window within each day for photo evidence, e.g. 6–9am. Fixed days and Weekly count only. With no window, the whole day counts. |
| Bedtime deadline | Oura bedtime pacts only, e.g. 12:00am. |
| Penalty | A fixed amount in USD for each miss. Set per pact, with no default. |
| Recipient | Where penalties go: a friend or an organization (name and link), chosen from the owner's saved recipients. |
| Reviewers | One or more friends. |
| Reminders | Zero or more. Each has a time and a channel (push, email, or both). |

### Schedules and occurrences

- **Fixed days** (e.g. Mon/Wed/Fri, or every night): each scheduled day is one occurrence.
- **Weekly count** (e.g. 3× per week): each Mon–Sun week is one occurrence. Each day with approved evidence counts toward the target, but only once per day. A week that falls short is Missed, with **one penalty per missing day** (1 of 3 = 2 penalties).
- **One-time** (e.g. "by Nov 30"): a single occurrence. Evidence can be submitted any time between the start and the deadline.

Every occurrence ends as **Kept**, **Missed**, or **Excused**. Until then it is pending.

### Lifecycle

1. **Draft**: the owner can edit it freely and nothing is at stake. The owner chooses "Send for review", which puts a *new pact* item in the reviewers' queues.
2. If a reviewer **rejects** it, it goes back to Draft with the reviewer's comment.
3. If a reviewer **approves** it, it becomes **Active**. The first occurrence is whichever comes later: the start date, or the first full day (or week, for Weekly count) after approval.
4. **Ended**: the end date has passed, or a change request ending the pact was approved.

### Changing an Active pact

- A change that makes the pact **less strict** is a **change request**: deleting, pausing or ending it, lowering the penalty, easing the schedule, or removing a reviewer. Until a reviewer approves the request, the pact keeps its current terms. Nothing is applied provisionally or charged back retroactively.
- The owner opens "Request change" on the pact page. It shows the creation form filled in with the current values, and the reviewer sees a before/after comparison.
- **Adding a reviewer** needs no approval. It takes effect when the new reviewer accepts, so an owner can replace a reviewer who has stopped responding.
- A pact always has at least one reviewer.

## Evidence and judging

### Oura bedtime

- The owner connects Oura through OAuth the first time they create a bedtime pact.
- **Bedtime** is Oura's `bedtime_start`, the time Oura thinks you got into bed, not when you fell asleep. Only main sleep (`long_sleep`) counts, so naps are ignored.
- **The night of date D** is the longest main sleep period that starts between 6pm on D and 6pm on D+1, in the timezone of Oura's timestamps.
- Each night is judged at **noon on D+1**:
  - in bed before the deadline: **Kept**
  - in bed after the deadline: **Missed**
  - no data, whether the ring wasn't worn or the app hasn't synced: **Missed**
- If data arrives after the night is judged, the result doesn't change. The owner can file a "synced late" excuse with a screenshot from the Oura app.
- Bedtime results never go to the review queue unless the owner files an excuse.

### Photo

- For each occurrence, the owner either submits evidence or files an excuse.
- Submitting evidence: take a photo with the camera or pick one from the library. Several photos and an optional note are allowed. The reviewer sees when the server received it and, if the photo includes one, its capture time.
- Evidence is accepted only inside the occurrence's day (or time window), or between the start and the deadline for a one-time pact.
- A fixed-day occurrence is judged when its day or window ends. A weekly-count occurrence is judged at the end of Sunday. A one-time occurrence is judged at its deadline. If evidence is still waiting for review at that point, the result waits for the decision.
- If no evidence arrives by the end, the occurrence is **Missed**.
- If evidence is **rejected**, the occurrence is Missed as of the rejection. While the window is still open, the owner can submit evidence again.

### Problems with an external data source

If Oura is disconnected, the token is lost, or the membership lapses, the owner gets a notification and a persistent alert in the app and on the affected pact until it's fixed. Occurrences are still judged as usual, so missing data means Missed, and the owner can excuse it.

## Excuses

- An excuse covers both "I had a good reason" (sick, a party, travel) and "the evidence is wrong" (the data synced late, the upload failed).
- It applies to **one or more pacts** over a **date range**. It has a reason and can include photos.
- **When it can be filed**: ahead of time (no limit on how far ahead), on the day, or up to **48 hours** after an occurrence is judged Missed or its evidence is rejected.
- While an excuse is pending, the penalties it covers are on hold and don't count toward the ledger.
- If approved, the occurrences it covers become **Excused**. On a weekly-count pact, an excuse covering any day of the week excuses the whole week.
- An excuse is also how the owner challenges a reviewer's decision.

## Review

- The **Review queue** holds five kinds of item: **New pact**, **Change request**, **Evidence**, **Excuse**, **Payment**.
- **Order**: new pacts and change requests come first, then everything else, oldest first. Each item shows how long it has been waiting.
- Each item shows what's needed to decide: the pact's terms, the occurrence and its window, photos with their timestamps, and the comment thread.
- **Actions**: **Approve**, **Reject** (a reason is required), and **Comment**, which starts a back-and-forth with the owner. The reviewer can still approve or reject afterwards.
- With several reviewers, the **first decision wins** and the item disappears from everyone's queue.
- Items never time out or get approved automatically. They stay pending until someone decides.
- Reviewers can't see the owner's pact pages in v0. The review items carry everything needed to decide.

## Money

- There is **one ledger per recipient**. It combines penalties from every pact that has that recipient.
- **Payments**: on the Ledgers screen, choose "Record payment" and enter an amount, a screenshot and an optional note. A reviewer of any pact with that recipient approves or rejects it. A payment can't be more than the amount owed.
- **Balance display**: the amount owed doesn't include pending payments. If the owner owes $70 and records a $20 payment, it shows "$50 owed · $20 pending". If the payment is rejected, it goes back to $70.
- **Due and Overdue**: each penalty is due **7 days** after it's added. Payments pay off the oldest penalties first. A penalty still unpaid after that is **Overdue**. The 7-day period is a single constant, so it's easy to change.
  - The owner sees a red banner on Today ("$35 overdue to …") and gets a daily reminder while anything is overdue.
  - Reviewers are notified when the owner first goes overdue, and then weekly.
- Each ledger shows **lifetime totals** (all penalties ever added and all payments ever made) as well as the current balance.

## Notifications

- **Channels**: web push (on iOS this needs the app on the home screen) and email.
- **Reminders** (set per pact, none by default):
  - Fixed days and One-time: they fire only if the occurrence has no evidence yet.
  - Weekly count: they fire on days with no evidence, and only until that week's target is met.
  - Bedtime: they always fire, e.g. "11:30pm: wind down".
- **Event notifications** (settings per account, each with an on/off switch and a channel): new review queue item, decision on your item, new comment, occurrence judged Missed, data-source problem, overdue balance (for both owner and reviewer).

## Screens and flows

**Navigation**: bottom tabs **Today · Pacts · Review · Ledgers**. The Review tab has a count badge. A profile menu holds friends, notification settings, timezone and the Oura connection.

**Onboarding**: Google sign-in → confirm timezone → add to Home Screen and enable push (with iPhone instructions) → Today, which suggests "Invite a friend" and "Create a pact".

**Today**
- Alerts at the top: data-source problems, rejected evidence, comments waiting for a reply, overdue balance. They disappear once resolved.
- One card per pact that's due, with its status and actions:
  - Photo: "Submit photo" or "File excuse".
  - Weekly count: progress such as "1 of 3 this week".
  - Bedtime: last night's result and the time left in the excuse window.
- A **Yesterday** summary.
- The total owed across all ledgers.

**Create pact** (step by step):
1. What
2. Evidence (connect Oura if needed and set the deadline)
3. Schedule (type, target or days or deadline, optional window, start date and end date)
4. Penalty and recipient
5. Reviewers
6. Reminders

Then "Send for review".

**File excuse**: start it from a Today card, a pact page, or a general button → choose pacts → choose a date range → write the reason and add any photos → preview the occurrences it covers → submit.

**Pacts**: the owner's own pacts only. Drafts first, then Active, with Ended collapsed. A pact page shows its terms, stage, reviewers and a **GitHub-style heat map** of occurrences (Kept / Missed / Excused / pending). It also has "Request change".

**Review**: the queue, plus an item detail view (see Review above).

**Ledgers**: one card per recipient showing the balance, pending payments, overdue amount, lifetime totals, and a history of penalties (each linked to its occurrence) and payments. Also the "Record payment" button.

## Oura API facts (researched 2026-10-24)

- OAuth2 only. Personal access tokens were removed in December 2025. Refresh tokens are single-use, so each new one has to be stored. An app not yet approved by Oura is limited to 10 users. The `daily` scope covers sleep. The user needs an active Oura membership; otherwise the API returns 403.
- Use `GET /v2/usercollection/sleep` for sleep periods (`bedtime_start`, `bedtime_end`, `type`, `day`, `latency`). `daily_sleep` has scores only.
- Data reaches the API only after the Oura app syncs. Webhooks (`sleep` data type) fire about 30s after a sync, and the payload must be fetched in a follow-up call. Webhooks combined with a daily reconciliation poll is the recommended approach.
- A night without the ring can't be told apart from an unsynced night: in both cases there's no `long_sleep` period.
- Not yet confirmed: whether the timestamps include a UTC offset (check against a live response).

## Future (not v0)

**Penalties and money**
- Escalating penalties for consecutive misses (X, 2X, 4X…), reset when the owner recovers.
- Earning back part of a penalty by keeping the next occurrence.
- Automatic payments and donations (see ADR 0001).
- Late fees on overdue balances, or blocking new pacts while anything is overdue.

**Review**
- AI review to lighten the reviewer's load.
- Automatic approval of review-queue items after a timeout.
- Read-only access for reviewers to the pact pages of pacts they review.

**Evidence and judging**
- Evidence types beyond Oura and photos.
- Automatically re-judging a night when Oura data arrives late.
- Weekly-count excuses that cover only part of a week (e.g. lowering the target to the days not excused).
- Proper handling of travel and timezone changes.

**Accounts and history**
- Sign in with Apple. It needs the $99/yr Apple Developer membership and relay-email setup.
- Unfriending.
- Streaks and a cross-pact activity feed or overall heat map.
