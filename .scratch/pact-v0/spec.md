# Pact v0

Status: ready-for-agent

## Problem Statement

I want money on the line to help me keep commitments: going to bed at a reasonable hour, going to the gym. Apps like Forfeit and Beeminder handle the commitment side well, but two things are missing for me:

1. **No human in the loop.** My evidence is checked by an algorithm or AI. Nobody I know reviews it, and I can't ask a friend whether my excuse is legitimate ("I was sick", "I was at a party", "the ring didn't sync").
2. **Penalties go to the wrong place.** The money goes to the app or to a charity I like. I'd be far more motivated if a missed commitment cost me money that goes to an organization I dislike, or to my friend.

I also want missed bedtimes to be detected automatically from my Oura Ring rather than self-reported. And I don't want to hand over real payment automation to an app that's still being built.

## Solution

Pact is a phone-first web app, installed to the home screen as a PWA, where an **owner** makes **pacts**. Each pact is a commitment with a schedule, a type of evidence, a penalty, and a **recipient** for that penalty. One or more **friends** act as **reviewers**. They check photo **evidence**, decide on **excuses**, and approve any **change request** that would make the pact less strict. A new pact needs no approval: it's Active as soon as it's created, and the owner has a 10-minute **edit window** to fix or delete it.

Each scheduled **occurrence** is judged as **Kept**, **Missed** or **Excused**. Bedtime pacts are judged automatically from Oura sleep data. Pacts with submitted evidence are judged by a reviewer. Each Missed occurrence adds its penalty to the owner's **ledger** for that recipient. The owner pays the recipient outside the app and records a **payment** with a screenshot, which a reviewer approves. Every Wednesday, the penalties for each recipient that can no longer be excused become one **bill**, due 7 days later. An unpaid bill becomes **Overdue**, which triggers an alert and reminders, and the reviewer is notified too.

## User Stories

### Getting started

1. As a new user, I want to sign in with my Google account, so that I don't have to create and remember another password.
2. As a new user, I want my timezone detected from my browser and shown for me to confirm, so that days and deadlines line up with my real day.
3. As a new user, I want step-by-step instructions for adding Pact to my iPhone home screen and turning on push, so that I can get reminders on my phone.
4. As a new user, I want my first screen to suggest inviting a friend and creating a pact, so that I know what to do next.
5. As a user, I want to change my timezone in my profile, so that I can fix it if it's wrong.

### Friends

6. As a user, I want to generate an invite link and share it with my phone's share sheet, so that I can bring a friend into the app.
7. As an invited person, I want to open the link, sign in with Google and accept, so that I become friends with the person who invited me. The invite page says plainly that accepting means we can each pick the other as a reviewer.
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
23. As an owner, I want to add reminders to a pact, each with a time and a channel (push, email or both), plus a date on One-time pacts, so that I'm nudged at the right moment.
24. As an owner, I want a pact to be Active as soon as I create it, with no approval step, so that I can make a pact that counts today.
25. As an owner, I want to edit or delete a new pact freely for 10 minutes after I create it, so that I can fix a mistake before it counts. Editing doesn't restart the 10 minutes.
26. As an owner, I want a pact's first occurrence to be the first one due at least an hour after I create it (for Weekly count, the week starting the next Monday), or my start date if that's later, so that nothing falls due while I can still edit it.
27. As a reviewer, I want to be notified when a friend picks me for a new pact, once its 10-minute edit window has closed, so that I know what I'm holding them to without being pinged about typos.

### Keeping a pact: submitted evidence

28. As an owner, I want Today to show only what's still open, most actionable first (No Oura data, then To do with the soonest due first, then Missed, then Automatic, then Coming up, with Waiting for approval last), so that I can see at a glance what I have to do. Done cards, and recurring pacts on days they aren't due, don't appear.
29. As an owner, I want to submit evidence right on the Today card by taking a live photo with my camera, so that I can prove I kept the pact without leaving the screen.
30. As an owner, I want to attach several photos to one piece of evidence, so that I can show more context when needed.
31. As an owner, I want evidence accepted only on days it can count (scheduled days for Fixed days, any day for Weekly count, start to deadline for One-time) and only until its due-by time, so that the rules are clear and nobody can backfill evidence later.
32. As an owner on a Weekly count pact, I want to see progress like "1 of 3 this week", so that I know how many sessions I still need.
33. As an owner, I want to be able to resubmit evidence after a rejection while the occurrence is still open, so that I can fix bad evidence.
34. As an owner, I want to be told when my evidence is approved or rejected, so that I know where I stand.

### Keeping a pact: Oura bedtime

35. As an owner, I want my bedtime pact checked automatically against Oura's "got into bed" time, so that I don't have to submit anything.
36. As an owner, I want each night judged as soon as Oura reports my main sleep, or at 6pm the next day if it hasn't, so that I see the result right after syncing and still have until the evening if I slept in.
37. As an owner, I want the bedtime card on Today to show tonight's deadline and the cost, plus last night as "No Oura data" while Oura hasn't reported it, or as Missed while I can still excuse it, so that Today shows only what I can act on. No Oura data sits at the very top, in orange, saying when it counts as missed, because syncing my ring is a cheap thing I can still do about it. Opening the app checks Oura straight away, so a ring I've just synced clears without waiting.
38. As an owner, I want a night with no Oura data by 6pm the next day counted as Missed, with one push at 3pm if it still has none, so that taking the ring off or not syncing isn't a loophole, but sleeping in and forgetting to sync doesn't catch me out.
39. As an owner, I want naps ignored and only my main sleep judged, so that an evening nap doesn't count as going to bed.
40. As an owner, I want a sleep that starts after midnight to count toward the previous date's night, so that falling asleep at 1am Wednesday counts as a late Tuesday night.
41. As an owner, I want an alert in the app and on the pact, plus a notification, when my Oura connection breaks, and the night left not judged until 6pm, so that I can reconnect before it's counted as Missed.

### Excuses

42. As an owner, I want to file an excuse ahead of time for a date range (e.g. a trip next weekend), so that I'm not penalized for days I know I'll miss.
43. As an owner, I want to file an excuse on the day (e.g. I woke up sick), so that I'm covered from that point on.
44. As an owner, I want to file an excuse for an occurrence that isn't judged yet (e.g. last night, when I forgot to wear the ring), or up to 48 hours after one is judged Missed or my evidence is rejected, so that I can explain things after the fact.
45. As an owner, I want one excuse to cover several pacts at once, so that being sick for a week doesn't take five separate submissions.
46. As an owner, I want to see exactly which occurrences an excuse will cover before I submit it, so that there are no surprises.
47. As an owner, I want to attach photos to an excuse (e.g. a screenshot from the Oura app showing I was in bed on time), so that my reviewer has proof.
48. As an owner, I want an excuse to cover "the data was wrong" as well as "I had a good reason", so that there's one simple way to contest any outcome.
49. As an owner, I want penalties covered by a pending excuse kept off my ledger until it's decided, so that I'm not asked to pay something that may be excused.
50. As an owner on a Weekly count pact, I want an approved excuse for any day of the week to excuse the whole week, so that a sick week doesn't leave me with an impossible target.
51. As an owner, I want a Missed occurrence I can still excuse to stay on Today with how long I have left, plus an "I'll pay it" button that clears it from Today without filing an excuse, so that I don't miss the window but am not nagged about a miss I've accepted. "I'll pay it" doesn't change the ledger, and I can still file an excuse from the pact page until the 48 hours are up.

### Reviewing

52. As a reviewer, I want a Review tab with a count badge, so that I know when someone is waiting on me.
53. As a reviewer, I want change requests shown first, then everything else oldest first, so that I handle time-sensitive items before they become blockers.
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
63. As an owner, I want any change that makes a pact less strict (deleting, pausing, ending, lowering the penalty, easing the schedule, removing a reviewer) to need a reviewer's approval, and any change that only makes it stricter (raising the penalty, adding days) to take effect at once, so that I can't escape a commitment on a weak evening but can always raise the stakes.
64. As an owner, I want my pact to keep its current terms until the change is approved, so that it's always clear which rules apply.
65. As a reviewer, I want a before/after comparison of a requested change, so that I can see exactly what is being relaxed.
66. As an owner, I want to add a reviewer without anyone's approval, so that I can replace a reviewer who has stopped responding.
67. As an owner, I want a pact to always keep at least one reviewer, so that nobody is left to hold me accountable.

### Money

68. As an owner, I want each Missed occurrence to add the pact's penalty to my ledger for its recipient, so that I know what I owe and to whom.
69. As an owner, I want a Weekly count week that falls short to add one penalty per missing session, so that doing 1 of 3 costs more than doing 2 of 3.
70. As an owner, I want one ledger per recipient that combines all pacts sharing that recipient, so that I make one payment per place.
71. As an owner, I want to record a payment with an amount, a screenshot and an optional note, so that my reviewer can verify I paid.
72. As an owner, I want my ledger to say "$20 payment awaiting approval" under what I owe while a payment is being checked, so that I can see what's settled and what isn't.
73. As an owner, I want a rejected payment to go back onto my balance, so that the ledger stays honest.
74. As an owner, I want the app to stop me recording a payment larger than what I owe, so that ledgers never go negative.
75. As a reviewer, I want to approve or reject payments for any recipient on pacts I review, so that payments are confirmed by someone other than the owner.
76. As an owner, I want my penalties for each recipient gathered into one bill every Wednesday at 6pm, once they can no longer be excused, and due 7 days later, so that I settle up once a week per recipient and never pay for something I could still excuse.
77. As an owner, I want an unpaid bill to turn into a red alert on Today and a daily reminder once it's overdue, so that I can't ignore it.
78. As a reviewer, I want to be notified when a friend first goes overdue, and weekly after that, so that I can nudge them.
79. As an owner, I want each ledger to show how much I've paid in its lifetime, so that the real cost of missing pacts motivates me.
80. As an owner, I want the Ledgers list to show each recipient with what I owe, one status line only when a bill is overdue or due, or a payment is awaiting approval, and lifetime paid, and to open a recipient for its full history with each penalty linked to its occurrence and marked with its bill (held penalties are marked too), so that the main view stays simple.

### History and overview

81. As an owner, I want Today to show a Yesterday summary, so that I can see how I did after alerts have cleared.
82. As an owner, I want each pact page to show a GitHub-style heat map of Kept, Missed, Excused and not-yet-judged occurrences, so that I can see patterns over time.
83. As an owner, I want my Pacts tab to list Active pacts, with any still in their edit window at the top and Ended pacts collapsed, so that what I can still change is easy to find and the list stays short.
84. As an owner, I want Today to show no money until a bill exists, and then a To do card for it (e.g. "Pay Rival Org $12 · due Wed Nov 4 at 6pm") with Record payment, so that money shows up only when there's something to do. The card goes away once a payment covering the bill is paid or waiting for approval.

### Notifications

85. As an owner, I want each pact's reminders to fire only while the occurrence still needs evidence (on scheduled days for Fixed days; once, on its own date, for each One-time reminder), so that I'm not nagged about things I've already done.
86. As an owner on a Weekly count pact, I want reminders to fire only on days without evidence and only until I've met the week's target, so that they stop once I'm done.
87. As an owner, I want bedtime reminders (e.g. "11:30pm: wind down") to go off every scheduled night, even if I'm already in bed, so that I get a cue to start getting ready for bed. The app can't tell I'm in bed until my ring syncs, usually the next morning.
88. As a user, I want to turn each kind of event notification (picked as a reviewer on a new pact, new review item, decision, comment, Missed occurrence, data-source problem, new bill, overdue bill) on or off and choose push and/or email for each, so that I control how much I'm contacted.

### Today and navigation

89. As an owner, I want things waiting on someone else (evidence, excuses, payments, change requests) listed under "Waiting for approval" at the bottom of Today, each with an icon showing its kind, so that they stay visible without crowding what I need to do.
90. As an owner, I want the overdue alert to go away once a pending payment covers the overdue bill, so that I'm only warned when there's something for me to do.
91. As an owner, I want to tap a pact on Today to open its page, and Back to return me to Today, so that I can check details without losing my place.
92. As an owner, I want a pact in its edit window to stand out, with a blue "New · edit for 7 min" chip and edge on Today and in Pacts and a bar with Edit and Delete on its page, so that I can see it's still free to change. It returns to normal on its own when the window closes.

### Connections

93. As an owner, I want my profile to list only the connections I've made (Oura in v0), each with its status and a Reconnect button when it needs one, so that I can fix a broken connection without hunting for it.
94. As an owner, I want a warning that says how many active pacts use a connection before I disconnect it, so that I know their nights will count as Missed until I reconnect.
95. As a reviewer, I want a pact's evidence kind fixed for its whole life, so that its proof can't be swapped for something weaker.

## Implementation Decisions

### Architecture

- **One deep module, the Pact core.** It holds every domain rule. Its interface is a set of **commands** and **queries**, each called as a particular account.
  - **Commands:** create pact; edit or delete a pact in its edit window; approve/reject/comment on a review item; submit evidence; file excuse; record payment; accept a miss ("I'll pay it"); request change; add reviewer; create/accept invite; connect/disconnect Oura; check Oura now; manage recipients, reminders and notification settings; and **advance to time T**, which runs every judgment, bill, due-date transition and reminder that's due by T.
  - **Queries:** Today (alerts, then cards in their sections, then waiting for approval and Yesterday); the review queue and item detail; a pact page with its heat map; the pacts list; ledgers (owed, overdue, bill due, awaiting approval, lifetime paid) and a ledger's history, including held penalties and which bill each penalty is on.
- **Four ports** sit outside the core, each with a production adapter and a fake for tests:
  - **Clock**: the current time. The core never reads system time directly.
  - **Oura source**: given an account and a date range, returns sleep periods in the Oura API's shape, or a "disconnected" error (token revoked or expired, membership lapsed).
  - **Notifier**: delivers a notification (recipient, kind, channel, payload).
  - **Photo store**: stores and fetches images, the v0 form of submitted evidence, returning the time the server received each one.
- **Thin adapters outside the core:** the PWA user interface, Google sign-in, Oura OAuth, web push, email, and a scheduler that periodically calls "advance to now". The tech stack is in ADR 0002: one server, with SQLite as the core's storage.
- **Notifications are sent after commit.** A command saves the notifications it produces in the same transaction as its other changes, and they're delivered only after that transaction commits. A crash can therefore cause a duplicate notification but never a lost one, and duplicates are acceptable.
- **Oura is polled in v0, not hooked.** While an account has a bedtime night that isn't judged yet, each scheduler tick (every minute) fetches its sleep periods. Today also sends "check Oura now" when it opens or comes back to the foreground while it shows a No Oura data card, then every 30 seconds while the card is on screen; the core ignores a check less than 15 seconds after the last one for that account. An account with no night waiting on Oura causes no calls. Webhooks were rejected for v0: they need a public callback with a challenge handshake, signature checks, subscriptions renewed before they expire, and deduplication, and an expired subscription stops events silently, so a poll would be needed as a backstop anyway.
- **Oura calls stay out of the way.** Sleep periods are fetched before the write transaction, never inside it, so a slow response can't block other writes. Each call times out after about 10 seconds. A connection's token refreshes go through one place, one at a time, because Oura's refresh tokens are single-use and two parallel refreshes would leave a dead token. A "disconnected" result marks the connection Needs reconnecting once, with one alert, and it isn't polled again until the owner reconnects.
- **Payments never move money in v0** (ADR 0001). Penalties go on a ledger, and a reviewer approves the owner's proof of payment.

### Domain model (schema level)

- **Account**: Google identity, display name, timezone.
- **Connection**: account, service (Oura in v0), tokens, status (Connected | Needs reconnecting). Exists only once the owner has connected the service.
- **Friendship**: two accounts. Either can pick the other as a reviewer or a person recipient; accepting an invite is agreeing to that. **Invite**: creator, single-use token, expires 7 days after creation, accepted by.
- **Recipient**: owned by an account. Either a person (a friend's account) or an organization (name, link).
- **Pact**: owner, name, description, evidence kind (Camera | Oura Ring, fixed at creation), schedule, optional start date, optional end date, optional due-by time (Camera only), in-bed-by time (Oura Ring only), penalty amount (USD), recipient, reviewers (one or more), reminders (time and channel; One-time pacts add a date, and each fires once), stage (Active | Ended), created-at time (starts the edit window).
- **Schedule**: one of three kinds:
  - **Fixed days**: a set of weekdays.
  - **Weekly count**: a target per Mon–Sun week.
  - **One-time**: a deadline.
- **Occurrence**: pact, period (a date, a Mon–Sun week, or start-to-deadline), outcome (not judged yet | Kept | Missed | Excused), judged-at time, for bedtime pacts the observed bedtime, and whether the owner accepted a miss ("I'll pay it", which only takes it off Today).
- **Evidence**: occurrence (for Weekly count: the week plus the day it counts for), files (photos in v0), server-received time, decision.
- **Excuse**: owner, pacts covered, date range, reason, photos, decision. The occurrences it covers are worked out from the pacts and the date range.
- **Review item**: kind (Change request | Evidence | Excuse | Payment), subject, comment thread, decision (approve/reject, a reason when rejected, decided by, decided at). It's waiting on the owner whenever the latest comment is a reviewer's.
- **Change request**: pact and the proposed new terms.
- **Penalty**: occurrence, recipient, amount, added-at time, state (held, while a pending excuse covers it; or owed), and the bill it's on, once it's on one.
- **Bill**: owner, recipient, created-at time (a Wednesday at 18:00), due-at time (created + 7 days), and its penalties. It never changes after it's created.
- **Payment**: owner, recipient, amount, screenshot, note, decision.
- **Alert**: account, optional pact, kind (data-source problem, rejected evidence, reviewer question awaiting reply, overdue bill not covered by pending payments), resolved state.

### Rules the core enforces

**Creation and change**
- A pact is Active as soon as it's created. There's no approval step and no Draft stage.
- For 10 minutes after creation, the owner can edit or delete the pact freely. Editing doesn't restart the 10 minutes. After that, changes follow the rules below.
- The pact's reviewers are notified when the edit window closes. A pact deleted inside the window notifies nobody.
- A pact's first occurrence:
  - Fixed days: the first scheduled day (night, for Oura Ring) whose due time is at least 1 hour after creation. The due time is the due-by time, the in-bed-by time, or midnight.
  - Weekly count: the week starting the Monday after creation.
  - One-time: the deadline must be at least 1 hour after creation.
  - A start date can only push the first occurrence later.
- A pact's evidence kind is set when it's created and never changes, not even in the edit window. Proving it a different way means making a new pact.
- Oura Ring pacts use Fixed days only. Camera pacts can use any schedule.
- A change that relaxes the pact (delete, pause, end, lower penalty, ease schedule, remove reviewer) creates a change request. The old terms stay in force until it's approved.
- A change that only makes the pact stricter (higher penalty, more days) takes effect at once, with no review. A change that both relaxes and tightens is reviewed as a whole.
- Adding a reviewer is immediate, and the new reviewer is notified. A pact can never have zero reviewers.
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
- The night of date D is decided by the first `long_sleep` period Oura reports whose `bedtime_start` is between 18:00 on D and 18:00 on D+1. Times come from Oura's timestamps, in the timezone those timestamps carry.
- The night is judged as soon as that period arrives: Kept if `bedtime_start` is before the deadline, otherwise Missed. A later period in the same window never changes it. This accepts a loophole: a sleep of 3 hours or more that starts before the deadline counts, even if the owner gets up again afterwards.
- No qualifying period by 18:00 on D+1 means Missed, judged then.
- A "disconnected" result raises a data-source alert and notification but doesn't judge the night. It stays not judged until 18:00 on D+1, so reconnecting in time still lets the data count.
- At 15:00 on D+1, a night still not judged sends the owner one push (the data-source problem notification kind).

**Excuses**
- Can be filed for any future date range and for any occurrence that isn't judged yet, such as last night before Oura reports it. For occurrences already judged, only within 48 hours of being judged Missed or having evidence rejected.
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
- Owed = penalties not held − approved payments. Awaiting approval = payments a reviewer hasn't decided yet.
- A new payment can't exceed owed minus awaiting approval.
- Payments are applied to penalties oldest first.
- Overdue = the unpaid part of bills whose due-at time has passed. The owner is warned only about the part that payments awaiting approval don't cover.
- Lifetime paid = all payments ever approved, per recipient.

**Bills**
- Every Wednesday at 18:00, each recipient gets one bill holding the owner's owed penalties whose 48-hour excuse window has closed and that aren't on a bill yet. In a normal week that's every penalty from the Mon–Sun week before: Sunday night's bedtime is judged by 18:00 Monday at the latest, so its excuse window has closed by 18:00 Wednesday.
- A penalty that comes later (say, evidence rejected after its week ended, or a held penalty released when its excuse is rejected) goes on the next Wednesday's bill.
- A bill never changes after it's created, since nothing on it can be excused any more. It's due 7 days later, at 18:00.
- Accepting a miss ("I'll pay it") doesn't put its penalty on a bill any sooner.
- The owner can pay at any time, before or after a bill. Payments still clear penalties oldest first, and a bill is paid once all its penalties are.
- A new bill notifies the owner. No bill is made for a recipient with nothing to bill.

**Reminders**
- Fixed days: fire on scheduled days, only if that day has no evidence.
- One-time: each reminder has its own date and time and fires once, unless evidence has already been submitted. There are no recurring reminders on One-time pacts.
- Weekly count: fire only on days without evidence and while the week's target is unmet.
- Bedtime: fire every scheduled night, even if the owner is already in bed. The app can't know that until the ring syncs, usually the next morning.

**Overdue**
- While any bill is overdue and not covered by payments awaiting approval, the owner gets a daily reminder and an alert.
- Reviewers of pacts with that recipient are notified when the owner first goes overdue, then weekly.

**Time**
- Bedtime pacts use the timezone in Oura's timestamps.
- Every other date and time uses the owner's account timezone.

### Screens (settled with the prototype)

- **Navigation:** bottom tabs Today · Pacts · Review · Ledgers, plus a profile menu. Opening a pact from Today pushes its page, and Back returns to Today. The current tab sits on a soft blue tile behind its icon and label, in the accent colour with a bold label, while the other tabs stay grey with a regular label. There's no highlight flash when a tab is tapped, and the tile stays while a page is pushed on top. Chosen over colour alone (too subtle), a filled icon, a bar on the top edge, a pill behind the icon, and a solid pill.
- **Today:** only what's still open, in this order:
  1. Alerts, only for things that need the owner (including an overdue bill).
  2. **No Oura data** (orange): last night's bedtime while Oura hasn't reported it, e.g. "Tue night hasn't synced. Open the Oura app." and, in orange, "Counts as missed at 6pm · 5h 20m". While a check runs the card says "Checking Oura…". There's no button to open the Oura app until we find a link that opens it.
  3. **To do** (green): evidence that can be submitted today, and bills to pay, soonest due first. A Weekly count pact mid-week or a One-time pact that's already open sorts by its own due date, below things due today.
  4. **Missed** (red): misses that can still be excused, with "File excuse · 31h left" and "I'll pay it". A Camera pact past today's due-by time shows here as **Closed**.
  5. **Automatic** (grey): bedtime pacts that run tonight. When last night is on the card above, tonight's deadline rides on that card instead.
  6. **Coming up**, under its own label: pacts that haven't opened yet ("Opens Nov 1", "Starts Mon Oct 26").
  7. **Waiting for approval**: items with a reviewer, last because there's nothing to do.
  8. Yesterday.

  Done cards don't appear, and neither do recurring pacts on days they aren't due. Evidence submitted today moves the card into Waiting for approval. Evidence is submitted **inline on the card**. There's no total owed; money appears only as a bill's To do card or an overdue alert. When nothing is open, a "Nothing to do right now" card says so. A pact in its edit window has a blue "New · edit for 7 min" chip next to its name and a blue left edge, here and in the Pacts list; both go away when the window closes. Each card shows its penalty as a bare amount in red ("$5"). An open Camera card shows the due time in orange as "Due at 9:00pm · 4h 12m", or "Due at midnight · 16h 19m" with no due-by time.
- **Create pact:** a **step-by-step** form: Source → Goal → Schedule → Penalty (amount and recipient) → Reviewers → Reminders → Check → Create pact. Source is two tiles, Camera and Oura Ring, each with an icon and one line of explanation; tapping one moves straight to Goal. The Goal step depends on the kind: Camera asks for a name, then "What will your photo show?"; Oura Ring asks for the in-bed-by time and fills in the name from it. Oura Ring pacts only see Fixed days on the Schedule step. The Reviewers and Reminders text depends on the kind: an Oura Ring pact has no photos to review, and its reminders go off every scheduled night. The Check step says the pact is Active as soon as it's created and names its first occurrence (e.g. "Wed Oct 21, due 10:00pm"). Editing a pact in its edit window reuses the form and skips the Source step. Chosen over a one-sentence fill-in-the-blanks builder because it extends more easily to richer penalty rules and several reviewers. Both fill in the same fields, so switching later is a layout change.
- **Pact page:** in the edit window, a blue bar at the top says how many minutes are left, with Edit and Delete. After that it offers File excuse and Request change. Its "Waiting on" list holds that pact's evidence, excuses and change requests, never payments, which belong to a recipient rather than a pact.
- **Occurrence labels:** an occurrence that isn't judged yet says what it's waiting for: **No Oura data**, **Waiting for approval** (a photo with a reviewer), or **Due today** ("This week" for Weekly count, the due date for One-time). A Missed occurrence with an excuse waiting reads **Missed · excuse waiting for approval**. The heat map legend calls them "Not judged yet". The UI never shows the word "pending".
- **Lists:** rows you can tap are separate cards with a › chevron; rows you can't tap (Friends, Notifications, Connections, History) stay grouped in one block. The pacts list shows the penalty as a red amount too. The full wording, "$5 per miss", appears only in a pact's terms.
- **Item kinds:** each review item kind has its own colour and icon: Change amber pencil, Evidence green camera, Excuse slate calendar with an X, Payment red $. Waiting items show the icon in a coloured square on the left, with the kind name in the small line under the title. Review and item pages show it as a coloured badge with the icon. Chosen over plain colour badges.
- **Review:** **one item at a time**, with Reject (a reason is required), Ask and Approve, plus Prev/Skip. Items waiting on the owner's reply are listed below the current item.
- **Profile:** a Connections section lists only the connections the owner has made, and is hidden when there are none. Disconnecting warns how many active pacts use it.
- **Invite:** the page an invite link opens says that accepting makes you friends, so the inviter can pick you to review their pacts and you can pick them.
- **Ledgers:** one card per recipient showing a big owed amount, one status line only when needed (overdue in red, "$4 bill due Wed Oct 28", or a payment awaiting approval), lifetime paid, and Record payment. Record payment starts at the open bills' amount. Held penalties appear only in the history, where each penalty also says which bill it's on, or that it goes on a Wednesday bill once it can't be excused. Tapping a card opens its history, pushed on the current tab.
- **Theme:** light only. v0 ignores the system's dark-mode setting; a dark theme can come later.

## Testing Decisions

- **One test seam: the Pact core's command and query interface.** Tests act as named accounts (owner, reviewer), issue commands, move the fake clock forward with "advance to T", and assert only on query results and on what the fake notifier recorded. They never inspect internal state or storage.
- **Fakes for the four ports:**
  - a controllable clock
  - an Oura source that returns sleep periods shaped like real API responses (seeded from a recorded real response once one is available) and can simulate "disconnected"
  - a recording notifier
  - an in-memory photo store
- **Storage is real SQLite, not a fake.** Each test gets its own temporary database file in WAL mode with the production pragmas. Storage isn't a port.
- **Restart scenarios:** partway through a scenario, the test discards the core and builds a new one on the same database file, then carries on. Nothing that matters may live only in memory. This also covers catching up after downtime: advancing hours in one step catches up judgments, due dates and overdue changes, and drops reminders more than 15 minutes late.
- **Mid-command failure scenarios:** a fake port fails partway through a command, e.g. the Oura source errors on its third call during "advance to T". Nothing from that command is half-applied, and the next tick completes the work.
- **Good tests are scenarios written in domain language**, e.g. "owner creates a Mon/Wed/Fri gym pact for $5 on Sunday → Monday ends with no evidence → occurrence is Missed and the recipient's ledger shows $5 owed → owner files an excuse within 48h → reviewer approves → occurrence is Excused and owed returns to $0". A test should survive any refactor that keeps behavior the same.
- **Areas the scenarios must cover:**
  - the edit window, first-occurrence lead time and start dates
  - each schedule kind
  - due-by times and which days accept evidence
  - the bedtime night window, judging on the first `long_sleep` that arrives, and the 6pm cutoff
  - the 3pm no-data push
  - checking Oura only while a night isn't judged, and ignoring check-now requests that come too fast
  - naps ignored
  - no data, and disconnection leaving the night not judged until 6pm
  - excuse timing limits (ahead of time, before an occurrence is judged, and the 48-hour window)
  - multi-pact excuses
  - the Weekly count whole-week excuse
  - penalty holds
  - the first decision winning
  - a reviewer's question handing the item to the owner, and the reply handing it back
  - change requests keeping the old terms
  - payment limits
  - oldest-first allocation
  - weekly bills: what goes on each, late penalties rolling to the next, and bills never changing
  - overdue bills, the pending-payment cover, and notifications
  - Today's sections, their order, and what Today leaves out
  - accepting a miss
  - lifetime paid
  - reminder conditions
  - timezone handling
- **Not tested at this seam:** the UI, Google sign-in, real Oura OAuth and HTTP calls, real push and email delivery, and real photo storage. These are thin adapters, verified by manual or smoke checks once the stack exists. One or two end-to-end browser smoke tests may be added later. SQLite's own crash safety and Litestream aren't tested in CI either. The practice restore in ADR 0002 covers backups.
- **Prior art:** none. The repository has no code yet, so these tests set the pattern.

## Out of Scope

- Automatic payments or donations of any kind (ADR 0001).
- Escalating penalties for consecutive misses (X, 2X, 4X…), and earning back penalties by recovering.
- Late fees on overdue balances, or blocking new pacts while overdue.
- AI review, and auto-approving review items after a timeout.
- Reviewers viewing an owner's pact pages.
- Evidence kinds other than Camera and Oura Ring, Oura goals other than in-bed-by, and Oura schedules other than Fixed days (see Future Ideas).
- Showing reviewers evidence metadata such as capture time or notes.
- Oura webhooks (see Future Ideas), and re-judging a night when later Oura data arrives.
- Weekly count excuses that cover only part of a week.
- Travel and timezone-change handling beyond the rules above.
- Sign in with Apple. It needs the $99/yr Apple Developer membership plus relay-email setup.
- Unfriending.
- Reviewers stepping down from a pact. A reviewer who wants off asks the owner to remove them.
- Streaks, a cross-pact activity feed, or an overall heat map.
- Currencies other than USD.

## Future Ideas

- **Oura webhooks:** Oura can notify an app when a sleep period is created (one app-wide subscription per data type and event, a challenge handshake, signed events carrying only the user and object ids, and subscriptions that must be renewed). They'd remove most polling, but the poll would stay as a backstop because an expired subscription stops events silently. The details come from third-party guides and need checking against Oura's own docs.
- **More evidence kinds:** GPS check-in, Apple Health, Strava. Each brings its own goals and schedules on the Goal step, and its own connection where it needs one.
- **More Oura goals:** sleep at least X hours (Oura's total sleep, not time in bed, which is easy to game), and up by a time.
- **More Oura schedules:** Weekly count, e.g. "in bed by midnight 5 nights a week".
- **Anki evidence kind:** the owner connects their Anki account and picks the decks they care about, not all decks. An occurrence is Kept when every picked deck has zero due cards by its due-by time. Unverified: AnkiWeb has no public API as far as we know, and AnkiConnect is a desktop add-on that serves a local HTTP API, so the connection may need sync-server access or a small client on the owner's machine.
- **Richer Camera evidence:** video or a time-lapse.
- **Vacation mode:** the owner sets a date range and every pact is suspended for it: no occurrences, no reminders and no penalties. It's simpler than an excuse that covers every pact, and it could need no reviewer approval if it's set far enough ahead.
- **Getting overdue bills paid:** v0 only notifies reviewers (when a bill first goes overdue, then weekly). Something with more social weight could follow, such as a text to the reviewer or a friend. The mechanism isn't designed yet.
- **Text messages** (a rough idea that needs refining before it's built). Prompted by a reviewer who's happy to review but won't remember to open the app. v0's email notifications partly cover that case. Two possible stages:
  1. SMS reminders for owners, and SMS nudges for reviewers that link straight to the review item.
  2. Answering a review item by text, with Y/N or a comment.
  - Sending texts needs a provider such as Twilio, at a fraction of a cent per text. US numbers also need A2P 10DLC registration, and replies need an inbound webhook. SMS would be one more Notifier channel.

## Further Notes

- Vocabulary follows the project glossary: Pact, Owner, Reviewer, Friend, Schedule, Occurrence, Kept/Missed/Excused, Evidence, Evidence kind, Connection, Excuse, Review Queue, Change Request, Penalty, Recipient, Ledger, Bill, Payment, Overdue, Active/Ended, Edit window.
- **Oura API facts (researched 2026-10-24):**
  - OAuth2 only. Personal access tokens were removed in December 2025.
  - Refresh tokens are single-use, so each new one has to be stored.
  - Apps Oura hasn't approved are limited to 10 users. The `daily` scope covers sleep.
  - An active Oura membership is required; a lapsed membership returns 403.
  - Sleep periods come from the `sleep` collection endpoint, with `bedtime_start`, `bedtime_end`, `type`, `day` and `latency`. The `daily_sleep` endpoint only has scores.
  - Data appears only after the Oura app syncs.
  - A night without the ring looks the same as an unsynced one: neither has a `long_sleep` period.
- **Still to verify:**
  - Whether Oura's sleep timestamps include a UTC offset. The bedtime rules depend on it. Check against a live response before building the Oura adapter, and use that response as the seed for the fake.
  - Oura's API rate limit. Polling every minute is about 5 calls a minute for 5 users, which should be far below it.
  - Whether Oura sleep of under about 3 hours is ever reported as `long_sleep`, since the first one decides the night.
  - Whether the Oura iOS app has a link that opens it. If so, the No Oura data card gets an "Open Oura" button.
- **Prototype:** a clickable throwaway prototype of these flows lives on the branch `prototype/pact-v0-flows`, not on main. It went through eight rounds: 3c0e6a0 has all variants, f159123 settles Create pact and Review, f2c1330 settles inline evidence, 66d9ead makes Create start with the evidence kind, 7aca1d8 applies UI comments (separate cards, red penalties, orange due times, kind icons, live photos only), 7053336 gives One-time pacts one-off reminders with a date, and 5d3b7c5 replaces Drafts and approval with the 10-minute edit window, adds occurrence labels that say what they're waiting for, simplifies ledger cards and makes the current tab easier to see, and eb928fe adds weekly bills, reorders Today and hides what isn't open, adds "I'll pay it", and switches to an iOS-style tab bar, and 73a87b1 compares ways to mark the current tab (the Tile verdict follows it). It's the primary source for the Screens decisions above.
- The first real users are the owner and one friend as reviewer, so anything involving several reviewers should be correct but kept minimal.
