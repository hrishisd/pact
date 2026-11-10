# Pact v0

Status: done

Note (2026-11-10): Anki pacts and vacations have their own specs, `../anki-evidence/spec.md` and `../vacation/spec.md`, which add to and in places change this one. Review items now have five kinds: vacation joined evidence, excuses, payments and change requests. The Review item entry under "Domain model (schema level)" is corrected for that; other lists of four kinds in this spec are as originally written.

## Problem Statement

I want money on the line to help me keep commitments: going to bed at a reasonable hour, going to the gym. Apps like Forfeit and Beeminder handle the commitment side well, but two things are missing for me:

1. **No human in the loop.** My evidence is checked by an algorithm or AI. Nobody I know reviews it, and I can't ask a friend whether my excuse is legitimate ("I was sick", "I was at a party", "the ring didn't sync").
2. **Penalties go to the wrong place.** The money goes to the app or to a charity I like. I'd be far more motivated if a missed commitment cost me money that goes to an organization I dislike, or to my friend.

I also want missed bedtimes to be detected automatically from my Oura Ring rather than self-reported. And I don't want to hand over real payment automation to an app that's still being built.

## Solution

Pact is a phone-first web app, installed to the home screen as a PWA, where an **owner** makes **pacts**. Each pact is a commitment with a schedule, a type of evidence, a penalty, and a **recipient** for that penalty. One or more **friends** act as **reviewers**. They check photo **evidence**, decide on **excuses**, and approve any **change request** that would make the pact less strict. A new pact needs no approval: it's Active as soon as it's created, and the owner has a 10-minute **edit window** to fix or delete it.

Each scheduled **occurrence** is judged as **Satisfied**, **Missed** or **Excused**. Bedtime pacts are judged automatically from Oura sleep data. Pacts with submitted evidence are judged by a reviewer. Each Missed occurrence adds its penalty to the owner's **ledger** for that recipient. The owner pays the recipient outside the app and records a **payment** with a screenshot, which a reviewer approves. Every Wednesday, the penalties for each recipient that can no longer be excused become one **bill**, due 7 days later. An unpaid bill becomes **Overdue**, which triggers an alert and reminders, and the reviewer is notified too.

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

10. As an owner, I want to start a new pact by picking its evidence kind (Camera or Oura Ring; Anki came later, in `../anki-evidence/spec.md`), so that the rest of the form only asks what makes sense for that kind.
11. As an owner of a Camera pact, I want to give it a name and describe what my photo will show, so that my reviewer knows exactly what to accept.
12. As an owner, I want picking Oura Ring to take me straight to connecting my ring when I haven't yet, and back to the source picker if I cancel, so that sleep data can be checked automatically.
13. As an owner of an Oura Ring pact, I want to set an in-bed-by time (e.g. 12:00am), with the pact's name filled in from it until I change it, so that the app knows what counts as on time.
14. As an owner, I want a Fixed days schedule (e.g. Mon/Wed/Fri, or every night), so that each of those days is held to the pact. It's the only schedule for Oura Ring pacts.
15. As an owner of a Camera pact, I want a Weekly count schedule (e.g. 3× per week), so that I can choose which days I go.
16. As an owner of a Camera pact, I want a One-time schedule with a deadline, so that I can commit to a single task such as filing my taxes. By default the evidence is due on the deadline's date only; a **Submit anytime** toggle lets it count any time from creation until the deadline.
17. As an owner of a Camera pact, I want to optionally make evidence due by a set time of day (e.g. by 9:00am) instead of midnight, on any schedule, so that I'm held to doing it early. On One-time it's the time on the deadline's date.
18. As an owner, I want to set an optional start date on a recurring pact, so that I can create a pact now that begins later.
19. As an owner, I want to set an optional end date on a recurring pact, so that it finishes automatically.
20. As an owner, I want to set a penalty amount in USD on each pact, so that more important pacts can cost more to miss.
21. As an owner, I want to pick a recipient from my saved list, or add a new one by name, so that I decide where my penalties go.
22. As an owner, I want to choose one or more reviewers for each pact, so that the right friend checks each commitment.
23. As an owner, I want to add reminders to a pact, each with a time, plus a date on One-time pacts, so that I'm nudged at the right moment.
24. As an owner, I want a pact to be Active as soon as I create it, with no approval step, so that I can make a pact that counts today.
25. As an owner, I want to edit or delete a new pact freely for 10 minutes after I create it, so that I can fix a mistake before it counts. Editing doesn't restart the 10 minutes.
26. As an owner, I want a pact's first occurrence to be the first one due at least an hour after I create it (for Weekly count, the week starting the next Monday), or my start date if that's later, so that nothing falls due while I can still edit it.
27. As a reviewer, I want to be notified when a friend picks me for a new pact, once its 10-minute edit window has closed, so that I know what I'm holding them to without being pinged about typos.

### Keeping a pact: submitted evidence

28. As an owner, I want Today to show only what's still open, most actionable first (No Oura data, then To do with the soonest due first, then Missed, then Automatic, then Coming up, with Waiting for approval last), so that I can see at a glance what I have to do. Done cards, and recurring pacts on days they aren't due, don't appear.
29. As an owner, I want to submit evidence right on the Today card by taking a live photo with my camera, so that I can prove I met the pact without leaving the screen.
30. As an owner, I want to attach several photos to one piece of evidence, so that I can show more context when needed.
31. As an owner, I want evidence accepted only on days it can count (scheduled days for Fixed days, any day for Weekly count, the deadline's date for One-time, or start to deadline with Submit anytime) and only until its due-by time, so that the rules are clear and nobody can backfill evidence later.
32. As an owner on a Weekly count pact, I want to see progress like "1 of 3 this week", so that I know how many sessions I still need.
33. As an owner, I want to be told at once when a reviewer rejects my evidence that the day is Missed, what it costs and why, so that I know where I stand. A rejection is final: the day takes no more evidence.
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

42. As an owner, I want to file an excuse for one pact ahead of time for a date range (e.g. a trip next weekend), so that I'm not penalized for days I know I'll miss.
43. As an owner, I want to file an excuse on the day (e.g. I woke up sick), so that I'm covered from that point on.
44. As an owner, I want to file an excuse for an occurrence that isn't judged yet (e.g. last night, when I forgot to wear the ring), or up to 48 hours after one is judged Missed or my evidence is rejected, so that I can explain things after the fact.
45. Dropped (ticket 07 prototype): an excuse covers one pact. Being sick across several pacts takes one excuse per pact.
46. As an owner, I want to see exactly which occurrences an excuse will cover before I submit it, so that there are no surprises.
47. As an owner, I want to attach photos to an excuse (e.g. a screenshot from the Oura app showing I was in bed on time), so that my reviewer has proof.
48. As an owner, I want an excuse to cover "the data was wrong" as well as "I had a good reason", so that there's one simple way to contest any outcome.
49. As an owner, I want penalties covered by a pending excuse kept off my ledger until it's decided, so that I'm not asked to pay something that may be excused.
50. As an owner on a Weekly count pact, I want an approved excuse for any day of the week to excuse the whole week, so that a sick week doesn't leave me with an impossible target.
51. As an owner, I want a Missed occurrence I can still excuse to stay on Today with how long I have left, plus a "Take the L" button that clears it from Today without filing an excuse, so that I don't miss the window but am not nagged about a miss I've accepted. Take the L doesn't change the ledger, and I can still file an excuse from the pact page until the 48 hours are up.

### Reviewing

52. As a reviewer, I want a Review tab with a count badge, so that I know when someone is waiting on me.
53. As a reviewer, I want change requests shown first, then everything else oldest first, so that I handle time-sensitive items before they become blockers.
54. As a reviewer, I want an evidence item to show just the evidence and the pact's description of what counts, so that I can judge it quickly. The app has already enforced when evidence can be submitted.
55. As a reviewer, I want to approve an item, so that the owner gets credit, the excuse is granted, or the payment is counted.
56. As a reviewer, I want to reject an item with a required reason, so that the owner knows why and can contest it with an excuse. Before I reject evidence, I'm told what it will cost the owner.
57. As a reviewer, I want to ask the owner a question about an item and have it leave my queue until they reply, so that my queue only holds things I can decide now.
58. As an owner, I want a reviewer's question to show up on my Today as something to act on, and my reply to send the item back to the reviewer, so that nothing stalls.
59. As a reviewer, I want the first decision made by any of the pact's reviewers to be final and to remove the item from everyone's queue, so that reviewers don't duplicate work.
60. As a reviewer, I want items to stay pending until someone decides them, so that nothing is approved just because I was busy.
61. As a reviewer, I want to be notified when a new item lands in my queue, so that I can review it promptly.

### Changing a pact

62. As an owner, I want to request a change to an Active pact through the same form I used to create it, pre-filled, so that changing it is easy.
63. As an owner, I want any change that makes a pact less strict (deleting, ending, lowering the penalty, easing the schedule, removing a reviewer, changing the recipient or the description) to need a reviewer's approval, and any change that only makes it stricter (raising the penalty, adding days) to take effect at once, so that I can't escape a commitment on a weak evening but can always raise the stakes.
64. As an owner, I want my pact to keep its current terms until the change is approved, and any change to start with the first occurrence that hasn't opened yet, with the pact page showing when the new terms start, so that it's always clear which rules apply and today's rules never shift under me. Excuses, not change requests, cover an occurrence that's already open.
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
82. As an owner, I want each pact page to show a GitHub-style heat map of Satisfied, Missed, Excused and not-yet-judged occurrences, so that I can see patterns over time.
83. As an owner, I want my Pacts tab to list Active pacts, with any still in their edit window at the top and Ended pacts collapsed, so that what I can still change is easy to find and the list stays short.
84. As an owner, I want Today to show no money until a bill exists, and then a To do card for it (e.g. "Pay Rival Org $12 · due Wed Nov 4 at 6pm") with Record payment, so that money shows up only when there's something to do. The card goes away once a payment covering the bill is paid or waiting for approval.

### Notifications

85. As an owner, I want each pact's reminders to fire only while the occurrence still needs evidence (on scheduled days for Fixed days; once, on its own date, for each One-time reminder), so that I'm not nagged about things I've already done.
86. As an owner on a Weekly count pact, I want reminders to fire only on days without evidence and only until I've met the week's target, so that they stop once I'm done.
87. As an owner, I want bedtime reminders (e.g. "11:30pm: wind down") to go off every scheduled night, even if I'm already in bed, so that I get a cue to start getting ready for bed. The app can't tell I'm in bed until my ring syncs, usually the next morning.
88. As a user, I want to turn each kind of event notification (picked as a reviewer on a new pact, new review item, decision, comment, Missed occurrence, Connection problem, new bill, overdue bill) on or off, so that I control how much I'm contacted.

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
  - **Commands:** create pact; edit or delete a pact in its edit window; approve/reject/comment on a review item; submit evidence; file excuse; record payment; accept a miss (Take the L, on a Missed card or a rejected-evidence alert); request change; add reviewer; create/accept invite; connect/disconnect Oura; check Oura now; manage recipients, reminders and notification settings; and **advance to time T**, which runs every judgment, bill, due-date transition and reminder that's due by T.
  - **Queries:** Today (alerts, then cards in their sections, then waiting for approval and Yesterday); the review queue and item detail; a pact page with its heat map; the pacts list; ledgers (owed, overdue, bill due, awaiting approval, lifetime paid) and a ledger's history, including held penalties and which bill each penalty is on.
- **Four ports** sit outside the core, each with a production adapter and a fake for tests:
  - **Clock**: the current time. The core never reads system time directly.
  - **Oura source**: given an account and a date range, returns sleep periods in the Oura API's shape, or a "disconnected" error (token revoked or expired, membership lapsed).
  - **Notifier**: delivers a notification (recipient, kind, channel, payload).
  - **Photo store**: stores and fetches images, the v0 form of submitted evidence, returning the time the server received each one.
- **Thin adapters outside the core:** the PWA user interface, Google sign-in, Oura OAuth, web push, and a scheduler that periodically calls "advance to now". The tech stack is in ADR 0002: one server, with SQLite as the core's storage.
- **Notifications are sent after commit.** A command saves the notifications it produces in the same transaction as its other changes, and they're delivered only after that transaction commits. A crash can therefore cause a duplicate notification but never a lost one, and duplicates are acceptable.
- **Oura is polled in v0, not hooked.** While an account has a bedtime night that isn't judged yet, each scheduler tick (every minute) fetches its sleep periods. Today also sends "check Oura now" when it opens or comes back to the foreground while it shows a No Oura data card, then every 30 seconds while the card is on screen; the core ignores a check less than 15 seconds after the last one for that account. An account with no night waiting on Oura causes no calls. Webhooks were rejected for v0: they need a public callback with a challenge handshake, signature checks, subscriptions renewed before they expire, and deduplication, and an expired subscription stops events silently, so a poll would be needed as a backstop anyway.
- **Oura calls stay out of the way.** Sleep periods are fetched before the write transaction, never inside it, so a slow response can't block other writes. Each sleep call times out after about 10 seconds; a token request waits about 30, because a refresh abandoned after Oura granted it loses the new pair. A connection's token refreshes go through one place, one at a time, because Oura's refresh tokens are single-use and two parallel refreshes would leave a dead token. A refresh stores its new pair only if the stored pair is still the one it spent, so a reconnect during a refresh isn't overwritten. If a refresh got no answer and Oura then refuses the refresh token, the server logs an `OPERATOR_ALERT` (log only, no push) that the lost answer most likely spent it. A "disconnected" result marks the connection Needs reconnecting once, with one alert, and it isn't polled again until the owner reconnects.
- **Payments never move money in v0** (ADR 0001). Penalties go on a ledger, and a reviewer approves the owner's proof of payment.

### Domain model (schema level)

- **Account**: Google identity, display name, timezone.
- **Connection**: account, service (Oura in v0), tokens, status (Connected | Needs reconnecting). Exists only once the owner has connected the service.
- **Friendship**: two accounts. Either can pick the other as a reviewer; accepting an invite is agreeing to that. **Invite**: creator, single-use token, expires 7 days after creation, accepted by.
- **Recipient**: owned by an account; just a name.
- **Pact**: owner, name, description, evidence kind (Camera | Oura Ring, fixed at creation; Anki is specified in `../anki-evidence/spec.md`), schedule, optional start date (recurring pacts), optional end date, optional due-by time (Camera only), in-bed-by time (Oura Ring only), penalty amount (USD), recipient, reviewers (one or more), reminders (time and channel; One-time pacts add a date, and each fires once), stage (Active | Ended), created-at time (starts the edit window).
- **Schedule**: one of three kinds:
  - **Fixed days**: a set of weekdays.
  - **Weekly count**: a target per Mon–Sun week.
  - **One-time**: a deadline (a date, plus the due-by time if one is set) and Submit anytime (off by default).
- **Occurrence**: pact, period (a date, a Mon–Sun week, or start-to-deadline for One-time with Submit anytime), outcome (not judged yet | Satisfied | Missed | Excused), judged-at time, for bedtime pacts the observed bedtime, and whether the owner accepted a miss (Take the L, which only takes it off Today).
- **Evidence**: occurrence (for Weekly count: the week plus the day it counts for), files (photos in v0), server-received time, decision.
- **Excuse**: owner, one pact, the occurrences it covers, reason, photos (0–3), filed-at time, decision. The covered occurrences are fixed when it's filed: the pact's scheduled days in the chosen dates that could be excused then. Days ahead are included, even though their occurrences haven't opened yet.
- **Review item**: kind (Change request | Evidence | Excuse | Payment | Vacation), subject, comment thread, decision (approve/reject, a reason when rejected, decided by, decided at). It's waiting on the owner whenever the latest comment is a reviewer's.
- **Change request**: pact and the proposed new terms.
- **Penalty**: occurrence, recipient, amount, added-at time, state (held, while a pending excuse covers it; or owed), and the bill it's on, once it's on one.
- **Bill**: owner, recipient, created-at time (a Wednesday at 18:00), due-at time (created + 7 days), and its penalties. It never changes after it's created.
- **Payment**: owner, recipient, amount, screenshot, note, decision.
- **Alert**: account, optional pact, kind (Connection problem, rejected evidence (resolved by Take the L or by filing an excuse for that day), rejected excuse (resolved by Take the L or by filing a new excuse for any of its days), reviewer question awaiting reply, overdue bill not covered by pending payments), resolved state.

### Rules the core enforces

**Creation and change**
- A pact is Active as soon as it's created. There's no approval step and no Draft stage.
- For 10 minutes after creation, the owner can edit or delete the pact freely. Editing doesn't restart the 10 minutes. After that, changes follow the rules below.
- The pact's reviewers are notified when the edit window closes. A pact deleted inside the window notifies nobody.
- Evidence submitted inside the edit window waits: no reviewer sees or hears of it until the window closes. Deleting the pact removes it, and so does an edit that takes its day off the schedule.
- A pact's first occurrence:
  - Fixed days: the first scheduled day (night, for Oura Ring) whose due time is at least 1 hour after creation. The due time is the due-by time, the in-bed-by time, or midnight.
  - Weekly count: the week starting the Monday after creation.
  - One-time: the deadline must be at least 1 hour after creation. Start dates don't apply, since Submit anytime sets the window.
  - A start date can only push the first occurrence later.
- A pact's evidence kind is set when it's created and never changes, not even in the edit window. Proving it a different way means making a new pact.
- Oura Ring pacts use Fixed days only. Camera pacts can use any schedule.
- A change that relaxes the pact creates a change request. The old terms stay in force until it's approved. These changes relax a pact:
  - deleting or ending it, lowering the penalty, easing the schedule, or removing a reviewer
  - any change of recipient, since only a reviewer can judge which recipient hurts more
  - any change of description, since it defines what a photo must show
  - a later due-by time, in-bed-by time, One-time deadline or start date; an earlier end date; removing a due-by time; adding an end date
  - turning on Submit anytime
  - any change to the date of a One-time pact without Submit anytime, since only a reviewer can judge whether another day is easier
- A change that only makes the pact stricter takes effect at once, with no review: a higher penalty, more days, the opposite direction on any time field above, adding a due-by time, removing an end date, or turning off Submit anytime. A change that both relaxes and tightens is reviewed as a whole.
- Changing the name or the reminders takes effect at once, with no review, since neither changes what counts.
- A change takes effect when it's made (stricter) or approved (relaxing). From then it applies to every occurrence that hasn't opened yet. Occurrences already open keep the old terms, and judged occurrences, their penalties and bills never change. Change requests never rescue an open occurrence; excuses do that.
- An occurrence opens when its period starts: at the start of its date for Fixed days (including a bedtime night), at 00:00 Monday for Weekly count, and for One-time at the start of the deadline's date, or at the pact's start with Submit anytime.
- One-time is the exception, since it has only one occurrence. A change applies to it even once it's open, as long as the new deadline is at least 1 hour after the change takes effect. Evidence already submitted still counts.
- Example: raising the penalty at 3pm Thursday on a daily pact applies from Friday. Lowering a Weekly count target, approved on Wednesday, applies from next Monday.
- v0 has no shortcut that skips approval for relaxing changes made well ahead.
- A pact has at most one change request waiting. The owner can withdraw it; until it's decided or withdrawn, the only changes allowed are the name, the reminders and adding a reviewer. A change request may carry an optional note.
- Adding a reviewer applies at once even when it's part of a change that waits for approval; the rest of that change still waits.
- Adding a reviewer is immediate, and the new reviewer is notified. A pact can never have zero reviewers.
- A pact is Ended when its end date passes or an approved change request ends it.

**Judging pacts with submitted evidence**
- Fixed days: judged when the day ends, or at the due-by time if one is set.
- Weekly count: judged at the end of Sunday.
- One-time: judged at the deadline.
- No evidence at that point: Missed. Evidence still pending a decision at that point: the outcome waits for the decision.
- On Fixed days and One-time, a rejection is final straight away. Rejected evidence makes the occurrence Missed as of the rejection, with its penalty, whether the occurrence is still open or already past its due time. The occurrence takes no more evidence, so there's no resubmitting after a rejection.
- Each rejection there raises a rejected-evidence alert for the owner. It stays until the owner taps Take the L, which only clears the alert (the penalty was already added at the rejection), or files an excuse for that day.
- On Weekly count, rejected evidence doesn't count toward the week's target, and the owner can make up the session on another day that week. The week still adds one penalty per session short of the target. Example: a 3× week with three photos submitted and one rejected adds one penalty; a week with no photos adds three.
- Evidence is accepted only on days it can count (scheduled days for Fixed days, any day of the week for Weekly count, the deadline's date for One-time, or start to deadline with Submit anytime) and only until the due-by time. With Submit anytime, the due-by time limits only the deadline's date. For Weekly count, at most one day of evidence counts per calendar day.
- Evidence photos are live photos taken with the camera. They can't be uploaded from the photo library. Photos attached to an excuse, and a payment's screenshot, can come from the library, since they're often screenshots.

**Judging bedtime pacts**
- The night of date D is decided by the first `long_sleep` period Oura reports whose `bedtime_start` is between 18:00 on D and 18:00 on D+1. Times come from Oura's timestamps, in the timezone those timestamps carry.
- The night is judged as soon as that period arrives: Satisfied if `bedtime_start` is before the deadline, otherwise Missed. A later period in the same window never changes it. This accepts a loophole: a sleep of 3 hours or more that starts before the deadline counts, even if the owner gets up again afterwards.
- No qualifying period by 18:00 on D+1 means Missed, judged then.
- A "disconnected" result raises a data-source alert and notification but doesn't judge the night. It stays not judged until 18:00 on D+1, so reconnecting in time still lets the data count.
- At 15:00 on D+1, a night still not judged sends the owner one push (the Connection problem notification kind).

**Excuses**
- An excuse covers one pact. It needs a reason; photos are optional (up to 3, from the camera or the photo library).
- Can be filed for any future date range and for any occurrence that isn't judged yet, such as last night before Oura reports it. For occurrences already judged, only within 48 hours of being judged Missed or having evidence rejected.
- The owner picks dates; the excuse covers the pact's scheduled days in them. Days that can't be excused are skipped, not refused: Satisfied, already Excused, already on an excuse waiting for approval, or Missed more than 48 hours ago. The core refuses an excuse only when no day is left to cover, the reason is blank, or the dates span more than 62 days.
- An occurrence can be on at most one excuse waiting for approval.
- While an excuse is pending, the penalties it covers are held.
- Any reviewer of the pact may decide. The decision is all or nothing: there's no approving some of the days.
- An approved excuse turns the covered occurrences that are already Missed into Excused and removes their penalties. Covered occurrences not judged yet are judged Excused at their due time, with no penalty.
- A rejected excuse releases the held penalties to owed (they go on the next Wednesday bill once their 48 hours are up), and covered occurrences not judged yet are judged as usual. It raises a rejected-excuse alert for the owner.
- A covered occurrence still waiting at its due time is judged as usual. If that makes it Missed, its penalty starts out held.
- After a rejection, the owner may file a new excuse for the same days, but only inside each day's original 48 hours. A rejection never restarts the window.
- The owner can't withdraw an excuse in v0.
- On Weekly count, covering any day of the week excuses the whole week.

**Review**
- Any reviewer of the relevant pact may decide, and the first decision is final.
- A payment can be decided by any reviewer of any pact that has that recipient.
- Rejecting requires a reason. Items never expire.
- Asking a question (commenting) takes the item out of every reviewer's queue until the owner replies. Meanwhile the owner sees it on Today as something to act on.
- Replies are text only. A reviewer can still decide an item that's waiting on the owner's reply.

**Ledger**
- Each Missed occurrence adds a penalty equal to the pact's amount. A short Weekly count week adds one penalty per missing day.
- Owed = penalties not held − approved payments. Awaiting approval = payments a reviewer hasn't decided yet.
- A new payment can't exceed owed minus awaiting approval.
- Payments are applied to penalties oldest first.
- A rejected payment raises no alert. It stays in the recipient's ledger history with who rejected it and why, the way rejected evidence appears there.
- Overdue = the unpaid part of bills whose due-at time has passed. The owner is warned only about the part that payments awaiting approval don't cover.
- Lifetime paid = all payments ever approved, per recipient.

**Bills**
- Every Wednesday at 18:00, each recipient gets one bill holding the owner's owed penalties whose 48-hour excuse window has closed and that aren't on a bill yet. In a normal week that's every penalty from the Mon–Sun week before: Sunday night's bedtime is judged by 18:00 Monday at the latest, so its excuse window has closed by 18:00 Wednesday.
- A penalty that comes later (say, evidence rejected after its week ended, or a held penalty released when its excuse is rejected) goes on the next Wednesday's bill.
- A bill never changes after it's created, since nothing on it can be excused any more. It's due 7 days later, at 18:00.
- Accepting a miss (Take the L) doesn't put its penalty on a bill any sooner.
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

The prototype settled these screens first. Where the app on `main` differs from it, `main` wins: those differences were made on purpose after using the real app, so don't restore the prototype's copy or layout. The prototype is the source only for screens that aren't built yet. When a ticket changes a built screen away from the prototype, add a line to **Changes since the prototype** at the end of this section.

- **Navigation:** bottom tabs Today · Pacts · Review · Ledgers, plus a profile menu. Opening a pact from Today pushes its page, and Back returns to Today. The current tab sits on a soft blue tile behind its icon and label, in the accent colour with a bold label, while the other tabs stay grey with a regular label. There's no highlight flash when a tab is tapped, and the tile stays while a page is pushed on top. Chosen over colour alone (too subtle), a filled icon, a bar on the top edge, a pill behind the icon, and a solid pill.
- **Today:** only what's still open, in this order:
  1. Alerts, only for things that need the owner (including an overdue bill). Each rejected occurrence gets one alert: "Sam rejected your evidence for Gym", the reason in quotes, "Wed Oct 28 is Missed · $5 to Red Cross", then "File excuse · 31h left" (the 48 hours run from the rejection) and **Take the L**, with no confirmation. The pact leaves To do for that day, and the day doesn't also show under Missed. The alert stays until the owner taps Take the L, which only clears it (the ledger doesn't change), or files an excuse for the day, which moves it to Waiting for approval. After Take the L the day shows in the ledger history and on the pact page. A rejected excuse gets the same kind of alert: "Sam rejected your excuse for Gym", the reason in quotes, "Mon Nov 2 · $5 is owed again" (or that days not judged yet are judged as usual), then "File another excuse · 31h left" while any of its days is still inside its 48 hours, and **Take the L**.
  2. **No Oura data** (orange): last night's bedtime while Oura hasn't reported it, e.g. "Tue night hasn't synced. Open the Oura app." and, in orange, "Counts as missed at 6pm · 5h 20m". While a check runs the card says "Checking Oura…". There's no button to open the Oura app until we find a link that opens it. A File excuse button covers a night without the ring, and an excuse filed for the night moves it to Waiting for approval.
  3. **To do** (green): evidence that can be submitted today, and bills to pay, soonest due first. A Weekly count pact mid-week or a One-time pact with Submit anytime sorts by its own due date, below things due today.
  4. **Missed** (red): misses that can still be excused, with "File excuse · 31h left" and **Take the L**. A bedtime miss says why: "Tue Nov 3 night · in bed at 1:00am" or "· no sleep data by 6pm". A Camera pact past today's due-by time shows here as **Closed**. A miss with an excuse waiting leaves this section.
  5. **Automatic** (grey): bedtime pacts that run tonight. Each card says "Tonight, in bed by 12:00am · 3h 12m"; a night already Satisfied isn't shown, and nothing says last night was Satisfied. When last night is on the card above, tonight's deadline rides on that card instead.
  6. **Coming up**, under its own label: pacts that haven't opened yet ("Opens Nov 1", "Starts Mon Oct 26"), including a One-time pact before its deadline's date.
  7. **Waiting for approval**: items with a reviewer, last because there's nothing to do. An excuse shows as the pact's name over "Excuse · Mon Nov 2" (or the first and last covered dates), with the slate calendar icon, and opens the excuse. An excuse that covers today takes today's card out of To do.
  8. Yesterday.

  Done cards don't appear, and neither do recurring pacts on days they aren't due. Evidence submitted today moves the card into Waiting for approval. Evidence is submitted **inline on the card**. There's no total owed; money appears only as a bill's To do card or an overdue alert. When nothing is open, a "Nothing to do right now" card says so. A pact in its edit window has a blue "New · edit for 7 min" chip next to its name and a blue left edge, here and in the Pacts list; both go away when the window closes. Each card shows its penalty as a bare amount in red ("$5"). An open Camera card shows the due time in orange as "Due at 9:00pm · 4h 12m", or "Due at midnight · 16h 19m" with no due-by time.
- **Create pact:** a **step-by-step** form: Source → Goal → Schedule → Penalty (amount and recipient) → Reviewers → Reminders → Check → Create pact. Source is two tiles, Camera and Oura Ring, each with an icon and one line of explanation; tapping one moves straight to Goal. The Goal step depends on the kind: Camera asks for a name, then "What will your photo show?"; Oura Ring asks for the in-bed-by time and fills in the name from it. Picking Oura Ring with no connection adds a Connect your Oura Ring step after Source, which says what Pact reads and opens Oura's page; the in-bed-by time uses the phone's own time field. Oura Ring pacts only see Fixed days on the Schedule step. The Reviewers and Reminders text depends on the kind: an Oura Ring pact has no photos to review, and its reminders go off every scheduled night. For One-time, the Schedule step asks for the deadline's date and an optional time, plus a small **Submit anytime** toggle, off by default, with the line "Anytime from now until the selected deadline." The Check step says the pact is Active as soon as it's created and names its first occurrence (e.g. "Wed Oct 21, due 10:00pm"; for One-time "Thu Nov 12, due midnight", or "Anytime until Thu Nov 12, midnight" with Submit anytime). Editing a pact in its edit window reuses the form, walking the steps from Goal and skipping the Source step. If the window closes while the form is open, the changes aren't saved and the form says "The 10 minutes are up". Chosen over a one-sentence fill-in-the-blanks builder because it extends more easily to richer penalty rules and several reviewers. Both fill in the same fields, so switching later is a layout change.
- **Pact page:** in the edit window, a blue bar at the top says "Feel free to edit or delete for 7 more minutes.", with Edit and Delete. Delete asks first in a sheet: "This action can't be undone." After that it offers File excuse and Request change. Once a change is in force but not yet applied, the page says when the new terms start, e.g. "New terms start Fri Oct 30. Today keeps $5 per miss." Its "Waiting on" list holds that pact's evidence, excuses and change requests, never payments, which belong to a recipient rather than a pact.
- **File excuse:** a sheet for one pact, titled "Excuse Gym, Mon Nov 2" when opened from a day (a Missed card, a To do card, a rejected-evidence alert, a No Oura data card), or "Excuse Gym" from the pact page. Under the title, "Gym is Mon, Wed, Fri · $5 per miss". Opened from a day, it shows that day as a card: its date and chip, "$5 held while Sam decides" for a miss (or "Due at midnight" today, "Not open yet" ahead), and the time left to file in orange. "+ Later days too, e.g. still sick" adds an "Also excuse Gym through" date and lists the pact's days up to it. From the pact page it asks "Which day?": one radio row per recent day that can still be excused, plus "Days ahead" (A trip, or anything you know is coming), which shows From and To dates starting today. Every date range lists the days it covers with a Covered chip, and the days it skips with a Skipped chip and why ("Satisfied", "Missed more than 48 hours ago"); with no days in range it says "No Gym day on Tue Nov 3. It's Mon, Wed, Fri." Then Reason (placeholder "e.g. Sick with the flu", no helper text) and Photos (optional), a grid with a + tile and no helper text. At the bottom, "Covers 3 days. $5 is held off what you owe until it's decided." over **Send to Sam**, disabled until a day is covered and the reason isn't blank. Dates use the browser's own date field, so the iPhone shows its calendar picker. Chosen over a single all-pacts form with Yesterday/Today/Tomorrow shortcuts (it offered days the pact doesn't have), tapping the pact's days as tiles, and a bare From/To range.
- **Excuse review item:** the date or first–last date as the title, Reason in quotes, the photos, then Covers: each day with its chip and "$5 held" or "Not open yet", and "Approving makes all 3 days Excused and removes $5 in held penalties. Days not judged yet are Excused when they end." The reject form says "Rejecting makes $5 owed again and leaves the days not judged yet to be judged as usual."
- **Occurrence labels:** an occurrence that isn't judged yet says what it's waiting for: **No Oura data**, **Waiting for approval** (a photo with a reviewer), or **Due today** ("This week" for Weekly count, the due date for One-time with Submit anytime). A Missed occurrence with an excuse waiting reads **Missed · excuse waiting for approval**; a day not judged yet with one waiting reads **Excuse waiting for approval**; a day ahead with an approved excuse already reads **Excused**. The heat map legend calls them "Not judged yet". The UI never shows the word "pending".
- **Lists:** rows you can tap are separate cards with a › chevron; rows you can't tap (Friends, Notifications, Connections, History) stay grouped in one block. The pacts list shows the penalty as a red amount too. The full wording, "$5 per miss", appears only in a pact's terms.
- **Item kinds:** each review item kind has its own colour and icon: Change amber pencil, Evidence green camera, Excuse slate calendar with an X, Payment red $. Waiting items show the icon in a coloured square on the left, with the kind name in the small line under the title. Review and item pages show it as a coloured badge with the icon. Chosen over plain colour badges.
- **Review:** **one item at a time**, with Reject (a reason is required), Ask and Approve, plus Prev/Skip. On Fixed days and One-time evidence, the reject form warns under the reason box what rejecting costs, e.g. "Rejecting makes Wednesday Missed and adds $5 to Hrishi's Red Cross ledger." Items waiting on the owner's reply are listed below the current item.
- **Profile:** a Connections section lists only the connections the owner has made, and is hidden when there are none. Disconnecting warns how many active pacts use it.
- **Turning on notifications:** an alert sits above Today until push is on for the device or the user taps Not now, which clears it for good on that device. It opens a pushed Notifications page: on an iPhone in Safari, the steps to add Pact to the Home Screen and sign in again; in the installed app, or on any other device, Turn on notifications; if blocked, how to allow it in Settings. Chosen over a first-run screen (one more screen before the app, and it gets in the way of an invite) and leaving it in the profile (nothing tells a new reviewer push exists). The profile's Notifications section shows this device's state, with a way back to that page, above one switch per kind that exists so far. Switches apply to the account, on every device; push is per device.
- **A rejection sends one push:** the decision, which names the reason. It doesn't also send a Missed occurrence push.
- **Invite:** the page an invite link opens says that accepting makes you friends, so the inviter can pick you to review their pacts and you can pick them.
- **Ledgers:** one card per recipient showing a big owed amount, one status line only when needed (overdue in red, "$4 bill due Wed Oct 28", or a payment awaiting approval), lifetime paid, and Record payment. Record payment starts at the open bills' amount. Held penalties appear only in the history, where each penalty also says which bill it's on, or that it goes on a Wednesday bill once it can't be excused. A penalty from rejected evidence says who rejected it and why. Payments appear in the history too, each saying whether it's awaiting approval, approved and by whom, or rejected, by whom and why. Tapping a card opens its history, pushed on the current tab.
- **Request change** (ticket 11 prototype, option B): opens on a Check page listing every term the owner can change, each row with a Change button that opens just that step of the create form in a sheet, with Done. A changed row shows the old value struck out above the new one, tinted amber with what it needs ("Needs approval: a lower penalty") or green ("Stricter"). Under the list a verdict box says either "Needs Sam's approval. Until then Gym keeps its current terms" (adding, when a stricter change is bundled with it, that a change that relaxes anything is reviewed as a whole) or "Applies without approval from Wed Nov 4. Today keeps $5 per miss.", then "Why? (optional)" when it needs approval, and **Send to Sam** or **Apply change**. Name, reminders and an added reviewer apply at once, even inside a change that waits, so a new reviewer can decide it. Chosen over walking the steps from Goal and over one page with every field.
- **Waiting change request:** a pact has at most one. While it waits, the pact page shows it under Waiting on, and Request change and End pact are replaced by "Request change is back once Sam decides the change below, or you withdraw it." Its page shows the before/after and **Withdraw change**. No other change can be made meanwhile except the name, reminders and adding a reviewer.
- **End pact:** a danger button at the bottom of the pact page after the edit window, with a sheet "End Gym?", "Ending needs Sam's approval. Until then Gym keeps running. Days already judged stay on your ledger.", "Why? (optional)", **Send to Sam** and Keep it. There is no Delete after the edit window.
- **Change request review item:** the pact's name, the note in quotes, then only the changed terms (old struck out, new in bold), "Approving applies from Wed Nov 4, the first Gym day not open yet. Today keeps $5 per miss.", and the unchanged terms folded under "Everything else stays". An end request reads "End Gym" and "Approving makes Gym Ended at once: no more days."
- **Reviewer questions** (ticket 12 prototype, option B): Ask opens a sheet "Ask Jordan" with a question box and **Send to Jordan**. The item leaves every reviewer's queue and the badge, and Review lists it under "Waiting on Jordan's reply" below the current item, where a reviewer can still open it and decide. Jordan's Today shows an info alert "Sam asked about your evidence for Gym, Mon Nov 2" with the question in quotes and **Reply**, which pushes the item's page: what was asked about (the photos, the payment, the change), the thread under "Questions", and a reply box with **Send reply** (text only). Replying sends it back to every reviewer. The thread also shows on the review item. Chosen over a reply box inside the alert.
- **Heat map** (ticket 17 prototype, option A): on the pact page under History, a GitHub grid with a column per week since the pact started, Mon–Sun rows labelled M, W, F, S, month names over the first week of each month, scrolled to now. Days the pact isn't due are empty outlined squares, today's open day is outlined blue, days ahead are dashed. Tapping a square shows its date, outcome and why below the legend. A Weekly count pact gets one square per week holding the number of sessions that counted. Chosen over month calendars and one row per week.
- **Yesterday:** after Waiting for approval, "Yesterday · Mon Nov 2", one row per pact due yesterday with its chip (Satisfied, Missed, Excused, or what it's waiting for) and a short line, opening the pact. Weekly count pacts aren't in it.
- **Theme:** light only. v0 ignores the system's dark-mode setting; a dark theme can come later.
- **Changes since the prototype** (`main` wins over the prototype on each):
  - Copy is short and plain throughout. New copy matches the existing empty states and timezone screen.
  - The sign-in tagline is "Commitments with money on the line, checked by your friends." It's the one place the glossary's avoided word "commitment" is used on purpose.
  - Pacts, Review and pushed pages have no subtitle under the title. Today keeps its date.
  - A new user's Today keeps "Nothing to do right now" and adds a line suggesting they invite a friend and create a pact, with a button for each.
  - The New pact button sits below the Pacts list, or below its empty state.
  - The Penalty step has a single recipient slot: "Pick a recipient", then the chosen name with Change. A recipient is just a name.
  - The invite page explains that accepting lets you pick each other as reviewers, and what a reviewer does.
  - A rejected photo makes the day Missed at once and shows on Today only as an alert with Take the L. The prototype's "I'll pay it" on Missed cards is called Take the L too.
  - A ledger card's big number is what's owed. A payment awaiting approval doesn't lower it; it shows only in the status line, "$10 payment awaiting approval", or "2 payments awaiting approval · $15" when there are several. The prototype showed owed minus awaiting.
  - Record payment opens from a recipient's ledger card or history page, so the sheet names the recipient instead of offering a picker. The screenshot comes from the photo library.
  - The ledger history marks each penalty payments have covered: "Paid", or "$2 of $5 paid" for part of it. The prototype worked this out but didn't show it.
  - A rejected payment shows in the ledger history with who rejected it and why. The prototype had no copy for it.
  - Excuses cover one pact and open from a day or a pact (see File excuse). The prototype's excuse sheet picked several pacts and a date range. A held penalty in the ledger history reads "Held while an excuse waits for approval", and its amount is grey with no "+".
  - The excuse page and the Excuse review item are titled with the pact's name, with the dates beside it; the prototype titled them with the dates. A review item's days use the short Missed chip, with "$5 held" under the date.
  - Reminders push only (v0 has no email), so the Reminders step has no channel picker. A pact starts with none; "+ Add reminder" suggests half an hour before the due time. A reminder at or after the due time (for a bedtime, the in-bed-by time, a night running from 6pm) is refused, since it would never go off. After the edit window the pact page's Reminders row has its own Change, which saves at once and works while a change request waits; Request change lists them too. Reviewers don't see reminders on a change request.
  - On a One-time pact each reminder is one date-and-time field, where the prototype had a date field and a time field. Its History is a single square for the deadline's date with how it went beside it, rather than a grid.

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
  - each schedule kind, including One-time with and without Submit anytime
  - due-by times and which days accept evidence
  - the bedtime night window, judging on the first `long_sleep` that arrives, and the 6pm cutoff
  - the 3pm no-data push
  - checking Oura only while a night isn't judged, and ignoring check-now requests that come too fast
  - naps ignored
  - no data, and disconnection leaving the night not judged until 6pm
  - excuse timing limits (ahead of time, before an occurrence is judged, and the 48-hour window)
  - excuses skipping days that can't be excused, and re-filing after a rejection inside the original 48 hours
  - the Weekly count whole-week excuse
  - penalty holds
  - the first decision winning
  - a reviewer's question handing the item to the owner, and the reply handing it back
  - change requests keeping the old terms, changes starting with the first occurrence not yet open, and the One-time exception
  - payment limits
  - oldest-first allocation
  - weekly bills: what goes on each, late penalties rolling to the next, and bills never changing
  - overdue bills, the pending-payment cover, and notifications
  - Today's sections, their order, and what Today leaves out
  - accepting a miss, and a rejection judging an occurrence Missed at once
  - lifetime paid
  - reminder conditions
  - timezone handling
- **Not tested at this seam:** the UI, Google sign-in, real Oura OAuth and HTTP calls, real push delivery, and real photo storage. These are thin adapters, verified by manual or smoke checks once the stack exists. One or two end-to-end browser smoke tests may be added later. SQLite's own crash safety and Litestream aren't tested in CI either. The practice restore in ADR 0002 covers backups.
- **Prior art:** `scenario()` in `src/core/testing/scenario.ts`, and the core's tests that use it.

## Out of Scope

- Automatic payments or donations of any kind (ADR 0001).
- Escalating penalties for consecutive misses (X, 2X, 4X…), and earning back penalties by recovering.
- Late fees on overdue balances, or blocking new pacts while overdue.
- AI review, and auto-approving review items after a timeout.
- Reviewers viewing an owner's pact pages.
- Evidence kinds other than Camera and Oura Ring (Anki is now covered by `../anki-evidence/spec.md`), Oura goals other than in-bed-by, and Oura schedules other than Fixed days (see Future Ideas).
- Showing reviewers evidence metadata such as capture time or notes.
- Oura webhooks (see Future Ideas), and re-judging a night when later Oura data arrives.
- Weekly count excuses that cover only part of a week.
- Travel and timezone-change handling beyond the rules above.
- Sign in with Apple. It needs the $99/yr Apple Developer membership plus relay-email setup.
- Unfriending.
- Reviewers stepping down from a pact. A reviewer who wants off asks the owner to remove them.
- Streaks, a cross-pact activity feed, or an overall heat map.
- Currencies other than USD.
- Email and text-message notifications. v0 notifies by Web Push only (ADR 0002).

## Future Ideas

- **Oura webhooks:** Oura can notify an app when a sleep period is created (one app-wide subscription per data type and event, a challenge handshake, signed events carrying only the user and object ids, and subscriptions that must be renewed). They'd remove most polling, but the poll would stay as a backstop because an expired subscription stops events silently. The details come from third-party guides and need checking against Oura's own docs.
- **More evidence kinds:** GPS check-in, Apple Health, Strava. Each brings its own goals and schedules on the Goal step, and its own connection where it needs one.
- **More Oura goals:** sleep at least X hours (Oura's total sleep, not time in bed, which is easy to game), and up by a time.
- **More Oura schedules:** Weekly count, e.g. "in bed by midnight 5 nights a week".
- **Anki evidence kind:** settled on 2026-11-05 in `.scratch/anki-evidence/spec.md`.
- **Meditation evidence kind (Waking Up):** an occurrence is Satisfied when the owner logged at least N mindful minutes that day. Waking Up has no public API, so Pact can't read it directly. It does write sessions to Apple Health as Mindful Minutes (HealthKit's `mindfulSession` category) when the owner turns on Account Settings → Apple Health, and to Google Fit on Android. Apple Health has no web API either, so the data has to leave the phone some other way. Options, cheapest first:
  - An iOS Shortcuts personal automation, run at a set time each night, that uses Find Health Samples for Mindful Minutes, filtered to the Waking Up source, and posts the total to a per-owner Pact endpoint with Get Contents of URL. Free, nothing to install, but health data is unreadable while the phone is locked, so the run can fail silently. The poll-style "no data" handling from Oura pacts would apply.
  - Health Auto Export, a paid third-party iOS app, whose REST API automation posts HealthKit data as JSON to a URL on a schedule. Same trust model, more reliable background runs.
  - A native iOS companion app reading HealthKit. Most reliable, but needs the $99/yr Apple Developer membership and App Store review.
  - Manual upload of the Health app's Export All Health Data zip. Fine for a one-off backfill, not for daily judging.

  Filtering by source keeps hand-entered Mindful Minutes out, but an owner could still post fake numbers to the endpoint, so this is about as trustworthy as Camera evidence and a reviewer would need to see the session list. Unverified: that Shortcuts exposes the Mindful Minutes type and sample source, that Health Auto Export includes mindful minutes, and whether Waking Up has moved from Google Fit to Health Connect.
- **One-time for more evidence kinds:** v0 keeps One-time to Camera. As more kinds arrive (Photo upload, Anki), they can offer One-time too. An Oura Ring One-time pact would be a single night, so it would only ever be due on its date.
- **Richer Camera evidence:** video or a time-lapse.
- **Photo upload evidence kind:** a separate kind, alongside Camera, where the owner picks a photo from the library (e.g. a screenshot from another app). Camera stays live-capture only, opening the camera directly.
- **Vacation:** being designed in `../vacation/spec.md`.
- **Getting overdue bills paid:** v0 only notifies reviewers (when a bill first goes overdue, then weekly). Something with more social weight could follow, such as a text to the reviewer or a friend. The mechanism isn't designed yet.
- **Email notifications:** a second Notifier channel, for reviewers who won't remember to open the app and for operator alerts, which survive a database restore better by email than by push.
- **Text messages** (a rough idea that needs refining before it's built). Prompted by a reviewer who's happy to review but won't remember to open the app. Two possible stages:
  1. SMS reminders for owners, and SMS nudges for reviewers that link straight to the review item.
  2. Answering a review item by text, with Y/N or a comment.
  - Sending texts needs a provider such as Twilio, at a fraction of a cent per text. US numbers also need A2P 10DLC registration, and replies need an inbound webhook. SMS would be one more Notifier channel.
- **Faster, more responsive app:** make fewer interactions wait on a network round trip, since each one makes the app feel slow. Options include optimistic UI updates, caching data on the device, and queueing actions taken offline until the connection returns. Not yet designed.

## Further Notes

- Vocabulary follows the project glossary: Pact, Owner, Reviewer, Friend, Schedule, Occurrence, Satisfied/Missed/Excused, Evidence, Evidence kind, Connection, Excuse, Review Queue, Change Request, Penalty, Recipient, Ledger, Bill, Payment, Overdue, Active/Ended, Edit window.
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
- **Prototype:** a clickable throwaway prototype of these flows lives on the branch `prototype/pact-v0-flows`, not on main. It went through nine rounds: 3c0e6a0 has all variants, f159123 settles Create pact and Review, f2c1330 settles inline evidence, 66d9ead makes Create start with the evidence kind, 7aca1d8 applies UI comments (separate cards, red penalties, orange due times, kind icons, live photos only), 7053336 gives One-time pacts one-off reminders with a date, and 5d3b7c5 replaces Drafts and approval with the 10-minute edit window, adds occurrence labels that say what they're waiting for, simplifies ledger cards and makes the current tab easier to see, and eb928fe adds weekly bills, reorders Today and hides what isn't open, adds "I'll pay it" (now Take the L), and switches to an iOS-style tab bar, and 73a87b1 compares ways to mark the current tab (the Tile verdict follows it), and 38d88ea adds the No Oura data card, judging nights on sync with a 6pm cutoff, the check on open, and Wednesday 6pm bills. It was the primary source for the Screens decisions above. Where the app on `main` now differs from it, `main` wins (see Changes since the prototype).
- **Changes prototype:** `.scratch/pact-v0/prototype/changes.prototype.html` (published as a private artifact) compared, for tickets 11, 12 and 17: walking the form's steps (A), opening on Check with a Change button per term (B), and one page with every field (C) for Request change; replying inline in the Today alert (A) or on the item's page (B); and a GitHub grid (A), month calendars (B) or one row per week (C) for the heat map. B, B and A were chosen.
- **Excuses prototype:** `.scratch/pact-v0/prototype/excuses.prototype.html` (published as a private artifact) went through four rounds for ticket 07. Round 1 compared an all-pacts form, picking occurrences, and steps; round 2 made every excuse start from one pact and compared this day (A), tapping days (B) and a date range (C); round 3 dropped other pacts from the sheet; round 4 settled Today's handling. A was chosen.
- **Oura prototype:** `.scratch/pact-v0/prototype/oura.prototype.html` (published as a private artifact) settled ticket 08's screens in one round: a Connect step before Oura's page over going straight there, the phone's time field over buttons of common times, and a tonight-only Automatic card over one that also shows last night's Satisfied bedtime or a quiet row.
- **Rejection prototype:** the branch `prototype/rejection-flow` compared ways to handle a rejected photo. Option C was chosen: a rejection is final at once, and Today shows it only as an alert with Take the L.
- The first real users are the owner and one friend as reviewer, so anything involving several reviewers should be correct but kept minimal.
