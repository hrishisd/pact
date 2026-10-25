# Pact v0

Status: ready-for-agent

## Problem Statement

I want money on the line to help me keep commitments: going to bed at a reasonable hour, going to the gym. Apps like Forfeit and Beeminder handle the commitment side well, but two things are missing for me:

1. **No human in the loop.** My evidence is checked by an algorithm or AI. Nobody I know reviews it, and I can't ask a friend whether my excuse is legitimate ("I was sick", "I was at a party", "the ring didn't sync").
2. **Penalties go to the wrong place.** The money goes to the app or to a charity I like. I'd be far more motivated if a missed commitment cost me money that goes to an organization I dislike, or to my friend.

I also want missed bedtimes to be detected automatically from my Oura Ring rather than self-reported. And I don't want to hand over real payment automation to an app that's still being built.

## Solution

Pact is a phone-first web app, installed to the home screen as a PWA, where an **owner** makes **pacts**. Each pact is a commitment with a schedule, a type of evidence, a penalty, and a **recipient** for that penalty. One or more **friends** act as **reviewers**. They approve the pact itself, check photo **evidence**, decide on **excuses**, and approve any **change request** that would make the pact less strict.

Each scheduled **occurrence** is judged as **Kept**, **Missed** or **Excused**. Bedtime pacts are judged automatically from Oura sleep data. Pacts with submitted evidence are judged by a reviewer. Each Missed occurrence adds its penalty to the owner's **ledger** for that recipient. The owner pays the recipient outside the app and records a **payment** with a screenshot, which a reviewer approves. Penalties become **Overdue** after 7 days, which triggers banners and reminders, and the reviewer is notified too.

## User Stories

### Getting started

1. As a new user, I want to sign in with my Google account, so that I don't have to create and remember another password.
2. As a new user, I want my timezone detected from my browser and shown for me to confirm, so that days and deadlines line up with my real day.
3. As a new user, I want step-by-step instructions for adding Pact to my iPhone home screen and turning on push, so that I can get reminders on my phone.
4. As a new user, I want my first screen to suggest inviting a friend and creating a pact, so that I know what to do next.
5. As a user, I want to change my timezone in my profile, so that I can fix it if it's wrong.

### Friends

6. As a user, I want to generate an invite link and share it with my phone's share sheet, so that I can bring a friend into the app.
7. As an invited person, I want to open the link, sign in with Google and accept, so that I become friends with the person who invited me.
8. As a user, I want invite links to work only once and expire after 7 days, so that a forwarded or old link can't be used by a stranger.
9. As an owner, I want to pick reviewers only from my friends, so that only people I trust review my pacts.

### Creating a pact

10. As an owner, I want to start a new pact by picking its evidence kind (Camera or Oura Ring), so that the rest of the form only asks what makes sense for that kind.
11. As an owner of a Camera pact, I want to give it a name and describe what my photo will show, so that my reviewer knows exactly what to accept.
12. As an owner, I want picking Oura Ring to take me straight to connecting my ring when I haven't yet, and back to the source picker if I cancel, so that sleep data can be checked automatically.
13. As an owner of an Oura Ring pact, I want to set an in-bed-by time (e.g. 12:00am), with the pact's name filled in from it until I change it, so that the app knows what counts as on time.
14. As an owner, I want a Fixed days schedule (e.g. Mon/Wed/Fri, or every night), so that each of those days is held to the pact. It's the only schedule for Oura Ring pacts.
15. As an owner of a Camera pact, I want a Weekly count schedule (e.g. 3× per week), so that I can choose which days I go.
16. As an owner of a Camera pact, I want a One-time schedule with a deadline, so that I can commit to a single task such as filing my taxes.
17. As an owner of a Camera pact, I want to optionally make evidence due by a set time of day (e.g. by 9:00am) instead of midnight, on any schedule, so that I'm held to doing it early.
18. As an owner, I want to set an optional start date, so that I can create a pact now that begins later.
19. As an owner, I want to set an optional end date on a recurring pact, so that it finishes automatically.
20. As an owner, I want to set a penalty amount in USD on each pact, so that more important pacts can cost more to miss.
21. As an owner, I want to pick a recipient from my saved list, or add a new one (a friend, or an organization with a name and link), so that I decide where my penalties go.
22. As an owner, I want to choose one or more reviewers for each pact, so that the right friend checks each commitment.
23. As an owner, I want to add reminders to a pact, each with a time and a channel (push, email or both), so that I'm nudged at the right moment.
24. As an owner, I want to edit a Draft pact freely, so that I can get it right before anything is at stake.
25. As an owner, I want to send a Draft pact for review, so that my reviewer can agree to its terms before it starts.
26. As an owner, I want my pact to become Active only after a reviewer approves it, and to start on whichever comes later, the first full day or week afterwards or my start date, so that I'm never charged for terms nobody agreed to.
27. As an owner, I want a rejected pact to come back to me as a Draft with the reviewer's comment, so that I can adjust it and send it again.

### Keeping a pact: submitted evidence

28. As an owner, I want Today to show a card for each pact, with the ones that need my action first and a status label on the right (To do, Waiting for approval, Automatic, Done, Missed), so that I can see at a glance what I have to do.
29. As an owner, I want to submit evidence right on the Today card by taking a live photo with my camera, so that I can prove I kept the pact without leaving the screen.
30. As an owner, I want to attach several photos to one piece of evidence, so that I can show more context when needed.
31. As an owner, I want evidence accepted only on days it can count (scheduled days for Fixed days, any day for Weekly count, start to deadline for One-time) and only until its due-by time, so that the rules are clear and nobody can backfill evidence later.
32. As an owner on a Weekly count pact, I want to see progress like "1 of 3 this week", so that I know how many sessions I still need.
33. As an owner, I want to be able to resubmit evidence after a rejection while the occurrence is still open, so that I can fix bad evidence.
34. As an owner, I want to be told when my evidence is approved or rejected, so that I know where I stand.

### Keeping a pact: Oura bedtime

35. As an owner, I want my bedtime pact checked automatically against Oura's "got into bed" time, so that I don't have to submit anything.
36. As an owner, I want each night judged at noon the next day, so that I have the morning to sync my ring.
37. As an owner, I want the bedtime card on Today to show only tonight's deadline and the cost, plus last night only when it was Missed and I can still excuse it, so that Today shows only what I can act on.
38. As an owner, I want a night with no Oura data by noon counted as Missed, so that taking the ring off or not syncing isn't a loophole.
39. As an owner, I want naps ignored and only my main sleep judged, so that an evening nap doesn't count as going to bed.
40. As an owner, I want a sleep that starts after midnight to count toward the previous date's night, so that falling asleep at 1am Wednesday counts as a late Tuesday night.
41. As an owner, I want an alert in the app and on the pact, plus a notification, when my Oura connection breaks, so that I can reconnect before more nights are missed.

### Excuses

42. As an owner, I want to file an excuse ahead of time for a date range (e.g. a trip next weekend), so that I'm not penalized for days I know I'll miss.
43. As an owner, I want to file an excuse on the day (e.g. I woke up sick), so that I'm covered from that point on.
44. As an owner, I want to file an excuse up to 48 hours after an occurrence is judged Missed or my evidence is rejected, so that I can explain things after the fact.
45. As an owner, I want one excuse to cover several pacts at once, so that being sick for a week doesn't take five separate submissions.
46. As an owner, I want to see exactly which occurrences an excuse will cover before I submit it, so that there are no surprises.
47. As an owner, I want to attach photos to an excuse (e.g. a screenshot from the Oura app showing I was in bed on time), so that my reviewer has proof.
48. As an owner, I want an excuse to cover "the data was wrong" as well as "I had a good reason", so that there's one simple way to contest any outcome.
49. As an owner, I want penalties covered by a pending excuse kept off my ledger until it's decided, so that I'm not asked to pay something that may be excused.
50. As an owner on a Weekly count pact, I want an approved excuse for any day of the week to excuse the whole week, so that a sick week doesn't leave me with an impossible target.
51. As an owner, I want Today to show how long I have left to excuse a Missed occurrence, so that I don't miss the window.

### Reviewing

52. As a reviewer, I want a Review tab with a count badge, so that I know when someone is waiting on me.
53. As a reviewer, I want new pacts and change requests shown first, then everything else oldest first, so that I handle time-sensitive items before they become blockers.
54. As a reviewer, I want an evidence item to show just the evidence and the pact's description of what counts, so that I can judge it quickly. The app has already enforced when evidence can be submitted.
55. As a reviewer, I want to approve an item, so that the owner gets credit, the excuse is granted, or the payment is counted.
56. As a reviewer, I want to reject an item with a required reason, so that the owner knows why and can respond.
57. As a reviewer, I want to ask the owner a question about an item and have it leave my queue until they reply, so that my queue only holds things I can decide now.
58. As an owner, I want a reviewer's question to show up on my Today as something to act on, and my reply to send the item back to the reviewer, so that nothing stalls.
59. As a reviewer, I want the first decision made by any of the pact's reviewers to be final and to remove the item from everyone's queue, so that reviewers don't duplicate work.
60. As a reviewer, I want items to stay pending until someone decides them, so that nothing is approved just because I was busy.
61. As a reviewer, I want to be notified when a new item lands in my queue, so that I can review it promptly.

### Changing a pact

62. As an owner, I want to request a change to an Active pact through the same form I used to create it, pre-filled, so that changing it is easy.
63. As an owner, I want any change that makes a pact less strict (deleting, pausing, ending, lowering the penalty, easing the schedule, removing a reviewer) to need a reviewer's approval, so that I can't escape a commitment on a weak evening.
64. As an owner, I want my pact to keep its current terms until the change is approved, so that it's always clear which rules apply.
65. As a reviewer, I want a before/after comparison of a requested change, so that I can see exactly what is being relaxed.
66. As an owner, I want to add a reviewer without anyone's approval, so that I can replace a reviewer who has stopped responding.
67. As an owner, I want a pact to always keep at least one reviewer, so that nobody is left to hold me accountable.

### Money

68. As an owner, I want each Missed occurrence to add the pact's penalty to my ledger for its recipient, so that I know what I owe and to whom.
69. As an owner, I want a Weekly count week that falls short to add one penalty per missing session, so that doing 1 of 3 costs more than doing 2 of 3.
70. As an owner, I want one ledger per recipient that combines all pacts sharing that recipient, so that I make one payment per place.
71. As an owner, I want to record a payment with an amount, a screenshot and an optional note, so that my reviewer can verify I paid.
72. As an owner, I want my balance shown as "$50 owed · $20 pending" while a payment awaits approval, so that I can see what's settled and what isn't.
73. As an owner, I want a rejected payment to go back onto my balance, so that the ledger stays honest.
74. As an owner, I want the app to stop me recording a payment larger than what I owe, so that ledgers never go negative.
75. As a reviewer, I want to approve or reject payments for any recipient on pacts I review, so that payments are confirmed by someone other than the owner.
76. As an owner, I want each penalty to fall due 7 days after it's added, so that I settle up regularly instead of letting debt pile up.
77. As an owner, I want a red banner and a daily reminder while anything is overdue, so that I can't ignore it.
78. As a reviewer, I want to be notified when a friend first goes overdue, and weekly after that, so that I can nudge them.
79. As an owner, I want each ledger to show lifetime totals (all penalties added and all payments made), so that the real cost of missing pacts motivates me.
80. As an owner, I want the Ledgers list to show each recipient with what I owe, what's on hold, lifetime penalties and lifetime paid, and to open a recipient for its full history with each penalty linked to its occurrence, so that the main view stays simple.

### History and overview

81. As an owner, I want Today to show a Yesterday summary, so that I can see how I did after alerts have cleared.
82. As an owner, I want each pact page to show a GitHub-style heat map of Kept, Missed, Excused and pending occurrences, so that I can see patterns over time.
83. As an owner, I want my Pacts tab to list Drafts first, then Active, with Ended pacts collapsed, so that what needs attention is at the top.
84. As an owner, I want Today to show my total owed across all ledgers, so that I always know where I stand.

### Notifications

85. As an owner, I want each pact's reminders to fire only while the occurrence still needs evidence (on scheduled days for Fixed days, every day until submitted for One-time), so that I'm not nagged about things I've already done.
86. As an owner on a Weekly count pact, I want reminders to fire only on days without evidence and only until I've met the week's target, so that they stop once I'm done.
87. As an owner, I want bedtime reminders (e.g. "11:30pm: wind down") to go off every scheduled night, even if I'm already in bed, so that I get a cue to start getting ready for bed. The app can't tell I'm in bed until my ring syncs, usually the next morning.
88. As a user, I want to turn each kind of event notification (new review item, decision, comment, Missed occurrence, data-source problem, overdue) on or off and choose push and/or email for each, so that I control how much I'm contacted.

### Today and navigation

89. As an owner, I want things waiting on someone else (evidence, excuses, payments, change requests, draft pacts) listed under "Waiting for approval" at the bottom of Today, each with an icon showing its kind, so that they stay visible without crowding what I need to do.
90. As an owner, I want the overdue banner to go away once a pending payment covers the overdue amount, so that I'm only warned when there's something for me to do.
91. As an owner, I want to tap a pact on Today to open its page, and Back to return me to Today, so that I can check details without losing my place.
92. As an owner looking at my own Draft, I want it to say who it's waiting on instead of offering to approve it, so that it's clear only a reviewer can make it Active.

### Connections

93. As an owner, I want my profile to list only the connections I've made (Oura in v0), each with its status and a Reconnect button when it needs one, so that I can fix a broken connection without hunting for it.
94. As an owner, I want a warning that says how many active pacts use a connection before I disconnect it, so that I know their nights will count as Missed until I reconnect.
95. As a reviewer, I want a pact's evidence kind fixed for its whole life, so that the proof I agreed to can't be swapped for something weaker.

## Implementation Decisions

### Architecture

- **One deep module, the Pact core.** It holds every domain rule. Its interface is a set of **commands** and **queries**, each called as a particular account.
  - **Commands:** create/edit/send-for-review pact; approve/reject/comment on a review item; submit evidence; file excuse; record payment; request change; add reviewer; create/accept invite; connect/disconnect Oura; manage recipients, reminders and notification settings; and **advance to time T**, which runs every judgment, due-date transition and reminder that's due by T.
  - **Queries:** Today (cards with status, alerts, waiting for approval, Yesterday, total owed); the review queue and item detail; a pact page with its heat map; the pacts list; ledgers (balance, on hold, pending, overdue, lifetime totals) and a ledger's history.
- **Four ports** sit outside the core, each with a production adapter and a fake for tests:
  - **Clock**: the current time. The core never reads system time directly.
  - **Oura source**: given an account and a date range, returns sleep periods in the Oura API's shape, or a "disconnected" error (token revoked or expired, membership lapsed).
  - **Notifier**: delivers a notification (recipient, kind, channel, payload).
  - **Photo store**: stores and fetches images, the v0 form of submitted evidence, returning the time the server received each one.
- **Thin adapters outside the core:** the PWA user interface, Google sign-in, Oura OAuth, web push, email, and a scheduler that periodically calls "advance to now". The tech stack hasn't been chosen and will be decided separately.
- **No Oura webhooks in v0.** Nights are judged once at noon, and data that arrives later never changes a result. So the Oura adapter simply fetches the relevant sleep periods when a night is judged. Webhooks plus a daily catch-up poll can come later if late data starts to matter.
- **Payments never move money in v0** (ADR 0001). Penalties go on a ledger, and a reviewer approves the owner's proof of payment.

### Domain model (schema level)

- **Account**: Google identity, display name, timezone.
- **Connection**: account, service (Oura in v0), tokens, status (Connected | Needs reconnecting). Exists only once the owner has connected the service.
- **Friendship**: two accounts. **Invite**: creator, single-use token, expires 7 days after creation, accepted by.
- **Recipient**: owned by an account. Either a person (a friend's account) or an organization (name, link).
- **Pact**: owner, name, description, evidence kind (Camera | Oura Ring, fixed at creation), schedule, optional start date, optional end date, optional due-by time (Camera only), in-bed-by time (Oura Ring only), penalty amount (USD), recipient, reviewers (one or more, each with accepted status), reminders, stage (Draft | Active | Ended), activation time.
- **Schedule**: one of three kinds:
  - **Fixed days**: a set of weekdays.
  - **Weekly count**: a target per Mon–Sun week.
  - **One-time**: a deadline.
- **Occurrence**: pact, period (a date, a Mon–Sun week, or start-to-deadline), outcome (pending | Kept | Missed | Excused), judged-at time, and for bedtime pacts the observed bedtime.
- **Evidence**: occurrence (for Weekly count: the week plus the day it counts for), files (photos in v0), server-received time, decision.
- **Excuse**: owner, pacts covered, date range, reason, photos, decision. The occurrences it covers are worked out from the pacts and the date range.
- **Review item**: kind (New pact | Change request | Evidence | Excuse | Payment), subject, comment thread, decision (approve/reject, a reason when rejected, decided by, decided at). It's waiting on the owner whenever the latest comment is a reviewer's.
- **Change request**: pact and the proposed new terms.
- **Penalty**: occurrence, recipient, amount, added-at time, due-at time (added + 7 days), state (held, while a pending excuse covers it; or owed).
- **Payment**: owner, recipient, amount, screenshot, note, decision.
- **Alert**: account, optional pact, kind (data-source problem, rejected evidence, reviewer question awaiting reply, overdue not covered by pending payments), resolved state.

### Rules the core enforces

**Activation and change**
- A pact's first occurrence is whichever comes later: its start date, or the first full day (week, for Weekly count) after approval.
- Rejecting a New pact returns it to Draft. Only Drafts can be edited directly.
- A pact's evidence kind is set when it's created and never changes, not even in a Draft. Proving it a different way means making a new pact.
- Oura Ring pacts use Fixed days only. Camera pacts can use any schedule.
- A change that relaxes the pact (delete, pause, end, lower penalty, ease schedule, remove reviewer) creates a change request. The old terms stay in force until it's approved.
- Adding a reviewer is immediate and takes effect once they accept. A pact can never have zero reviewers.
- A pact is Ended when its end date passes or an approved change request ends it.

**Judging pacts with submitted evidence**
- Fixed days: judged when the day ends, or at the due-by time if one is set.
- Weekly count: judged at the end of Sunday.
- One-time: judged at the deadline.
- No evidence at that point: Missed. Evidence still pending a decision at that point: the outcome waits for the decision.
- Rejected evidence makes the occurrence Missed as of the rejection, unless the occurrence is still open and new evidence is submitted.
- Evidence is accepted only on days it can count (scheduled days for Fixed days, any day of the week for Weekly count, start to deadline for One-time) and only until the due-by time. For Weekly count, at most one day of evidence counts per calendar day.
- Evidence photos are live photos taken with the camera. They can't be uploaded from the photo library. Photos attached to an excuse can come from the library, since they're often screenshots.

**Judging bedtime pacts**
- The night of date D is the longest `long_sleep` period whose `bedtime_start` is between 18:00 on D and 18:00 on D+1. Times come from Oura's timestamps, in the timezone those timestamps carry.
- Kept if `bedtime_start` is before the deadline. Otherwise Missed.
- The night is judged at 12:00 on D+1. No qualifying period at that point means Missed.
- A "disconnected" result from the Oura source also means Missed, and it raises a data-source alert and notification.

**Excuses**
- Can be filed for any future date range. For past dates, only within 48 hours of the covered occurrence being judged Missed or its evidence rejected.
- While an excuse is pending, the penalties it covers are held.
- An approved excuse turns the covered occurrences into Excused and removes their penalties. A rejected excuse releases the held penalties to owed.
- On Weekly count, covering any day of the week excuses the whole week.

**Review**
- Any reviewer of the relevant pact may decide, and the first decision is final.
- A payment can be decided by any reviewer of any pact that has that recipient.
- Rejecting requires a reason. Items never expire.
- Asking a question (commenting) takes the item out of every reviewer's queue until the owner replies. Meanwhile the owner sees it on Today as something to act on.

**Ledger**
- Each Missed occurrence adds a penalty equal to the pact's amount. A short Weekly count week adds one penalty per missing day.
- Owed = penalties not held − approved payments. Pending = payments awaiting a decision.
- A new payment can't exceed owed minus pending.
- Payments are applied to penalties oldest first.
- Overdue = the part of owed made up of penalties whose due-at time has passed.
- Lifetime totals = all penalties ever added and all payments ever approved, per recipient.

**Reminders**
- Fixed days: fire on scheduled days, only if that day has no evidence.
- One-time: fire every day from the start until evidence is submitted.
- Weekly count: fire only on days without evidence and while the week's target is unmet.
- Bedtime: fire every scheduled night, even if the owner is already in bed. The app can't know that until the ring syncs, usually the next morning.

**Overdue**
- While anything is overdue, the owner gets a daily reminder and an alert.
- Reviewers of pacts with that recipient are notified when the owner first goes overdue, then weekly.

**Time**
- Bedtime pacts use the timezone in Oura's timestamps.
- Every other date and time uses the owner's account timezone.

### Screens (settled with the prototype)

- **Navigation:** bottom tabs Today · Pacts · Review · Ledgers, plus a profile menu. Opening a pact from Today pushes its page, and Back returns to Today.
- **Today:** cards for each Active pact, sorted so the ones needing action come first. Each card has a status label on the right: **To do** (green), **Waiting for approval** (tan), **Automatic** (grey), **Done**, **Missed** (red). Evidence is submitted **inline on the card**. Alerts sit at the top, and only for things that need the owner. Pending items sit under "Waiting for approval" near the bottom, followed by Yesterday and the total owed. Each card shows its penalty as a bare amount in red ("$5"). An open Camera card shows the due time in orange as "Due at 9:00pm · 4h 12m", or "Due at midnight · 16h 19m" with no due-by time.
- **Create pact:** a **step-by-step** form: Source → Goal → Schedule → Penalty (amount and recipient) → Reviewers → Reminders → Check → Send for review. Source is two tiles, Camera and Oura Ring, each with an icon and one line of explanation; tapping one moves straight to Goal. The Goal step depends on the kind: Camera asks for a name, then "What will your photo show?"; Oura Ring asks for the in-bed-by time and fills in the name from it. Oura Ring pacts only see Fixed days on the Schedule step. The Reviewers and Reminders text depends on the kind: an Oura Ring pact has no photos to review, and its reminders go off every scheduled night. Editing a Draft skips the Source step. Chosen over a one-sentence fill-in-the-blanks builder because it extends more easily to richer penalty rules and several reviewers. Both edit the same draft, so switching later is a layout change.
- **Lists:** rows you can tap are separate cards with a › chevron; rows you can't tap (Friends, Notifications, Connections, History) stay grouped in one block. The pacts list shows the penalty as a red amount too. The full wording, "$5 per miss", appears only in a pact's terms.
- **Item kinds:** each review item kind has its own colour and icon: New pact blue +, Change amber pencil, Evidence green camera, Excuse slate calendar with an X, Payment red $. Waiting items show the icon in a coloured square on the left, with the kind name in the small line under the title. Review and item pages show it as a coloured badge with the icon. Chosen over plain colour badges.
- **Review:** **one item at a time**, with Reject (a reason is required), Ask and Approve, plus Prev/Skip. Items waiting on the owner's reply are listed below the current item.
- **Profile:** a Connections section lists only the connections the owner has made, and is hidden when there are none. Disconnecting warns how many active pacts use it.
- **Ledgers:** one card per recipient showing what's owed, what's on hold, lifetime penalties, lifetime paid and Record payment. Tapping a card opens its history.
- **Theme:** light only. v0 ignores the system's dark-mode setting; a dark theme can come later.

## Testing Decisions

- **One test seam: the Pact core's command and query interface.** Tests act as named accounts (owner, reviewer), issue commands, move the fake clock forward with "advance to T", and assert only on query results and on what the fake notifier recorded. They never inspect internal state or storage.
- **Fakes for the four ports:**
  - a controllable clock
  - an Oura source that returns sleep periods shaped like real API responses (seeded from a recorded real response once one is available) and can simulate "disconnected"
  - a recording notifier
  - an in-memory photo store
- **Good tests are scenarios written in domain language**, e.g. "owner creates a Mon/Wed/Fri gym pact for $5 → reviewer approves → Monday ends with no evidence → occurrence is Missed and the recipient's ledger shows $5 owed → owner files an excuse within 48h → reviewer approves → occurrence is Excused and owed returns to $0". A test should survive any refactor that keeps behavior the same.
- **Areas the scenarios must cover:**
  - activation timing and start dates
  - each schedule kind
  - due-by times and which days accept evidence
  - the bedtime night window and the noon cutoff
  - naps ignored
  - no data, and disconnection
  - excuse timing limits (ahead of time, and the 48-hour window)
  - multi-pact excuses
  - the Weekly count whole-week excuse
  - penalty holds
  - the first decision winning
  - a reviewer's question handing the item to the owner, and the reply handing it back
  - change requests keeping the old terms
  - payment limits
  - oldest-first allocation
  - overdue transitions and notifications
  - lifetime totals
  - reminder conditions
  - timezone handling
- **Not tested at this seam:** the UI, Google sign-in, real Oura OAuth and HTTP calls, real push and email delivery, and real photo storage. These are thin adapters, verified by manual or smoke checks once the stack exists. One or two end-to-end browser smoke tests may be added later.
- **Prior art:** none. The repository has no code yet, so these tests set the pattern.

## Out of Scope

- Automatic payments or donations of any kind (ADR 0001).
- Escalating penalties for consecutive misses (X, 2X, 4X…), and earning back penalties by recovering.
- Late fees on overdue balances, or blocking new pacts while overdue.
- AI review, and auto-approving review items after a timeout.
- Reviewers viewing an owner's pact pages.
- Evidence kinds other than Camera and Oura Ring, Oura goals other than in-bed-by, and Oura schedules other than Fixed days (see Future Ideas).
- Showing reviewers evidence metadata such as capture time or notes.
- Oura webhooks, and automatically re-judging nights when Oura data arrives late.
- Weekly count excuses that cover only part of a week.
- Travel and timezone-change handling beyond the rules above.
- Sign in with Apple. It needs the $99/yr Apple Developer membership plus relay-email setup.
- Unfriending.
- Streaks, a cross-pact activity feed, or an overall heat map.
- Currencies other than USD.
- Choosing the tech stack. That's a separate decision.

## Future Ideas

- **More evidence kinds:** GPS check-in, Apple Health, Strava. Each brings its own goals and schedules on the Goal step, and its own connection where it needs one.
- **More Oura goals:** sleep at least X hours (Oura's total sleep, not time in bed, which is easy to game), and up by a time.
- **More Oura schedules:** Weekly count, e.g. "in bed by midnight 5 nights a week".
- **Richer Camera evidence:** video or a time-lapse.

## Further Notes

- Vocabulary follows the project glossary: Pact, Owner, Reviewer, Friend, Schedule, Occurrence, Kept/Missed/Excused, Evidence, Evidence kind, Connection, Excuse, Review Queue, Change Request, Penalty, Recipient, Ledger, Payment, Overdue, Draft/Active/Ended.
- **Oura API facts (researched 2026-10-24):**
  - OAuth2 only. Personal access tokens were removed in December 2025.
  - Refresh tokens are single-use, so each new one has to be stored.
  - Apps Oura hasn't approved are limited to 10 users. The `daily` scope covers sleep.
  - An active Oura membership is required; a lapsed membership returns 403.
  - Sleep periods come from the `sleep` collection endpoint, with `bedtime_start`, `bedtime_end`, `type`, `day` and `latency`. The `daily_sleep` endpoint only has scores.
  - Data appears only after the Oura app syncs.
  - A night without the ring looks the same as an unsynced one: neither has a `long_sleep` period.
- **Still to verify:** whether Oura's sleep timestamps include a UTC offset. The bedtime rules depend on it. Check against a live response before building the Oura adapter, and use that response as the seed for the fake.
- **Prototype:** a clickable throwaway prototype of these flows lives on the branch `prototype/pact-v0-flows`, not on main. It went through five rounds: 3c0e6a0 has all variants, f159123 settles Create pact and Review, f2c1330 settles inline evidence, 66d9ead makes Create start with the evidence kind, and 7aca1d8 applies UI comments (separate cards, red penalties, orange due times, kind icons, live photos only). It's the primary source for the Screens decisions above.
- **Open questions from the prototype:**
  - Should a stricter change (a higher penalty, more days) take effect at once, or also need review? The prototype applies it at once.
  - Daily reminders for One-time pacts were proposed and not objected to, but never explicitly confirmed.
- The first real users are the owner and one friend as reviewer, so anything involving several reviewers should be correct but kept minimal.
