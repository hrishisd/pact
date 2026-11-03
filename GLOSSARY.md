# Pact

An accountability app where people make commitments with money at stake, and friends review the evidence and excuses for them.

## Language

### Commitments

**Pact**:
A commitment the owner makes: what they'll do and when, how it's proven, and what it costs to miss.
_Avoid_: Commitment, contract, habit, task, goal

**Owner**:
The person who made a pact and is held to it.
_Avoid_: Creator, user (when the role matters)

**Active / Ended**:
The stages a pact goes through. A pact is Active from the moment it's created; nobody approves it first. An Ended pact is past its end date or was ended through an approved change request.
_Avoid_: Draft, pending, live, archived

**Edit window**:
The first 10 minutes after a pact is created, when the owner can edit or delete it freely. Its reviewers are notified when it closes. After it, stricter changes apply at once and looser ones need a change request.
_Avoid_: Draft, grace period

**Schedule**:
When a pact's occurrences fall due. There are three kinds: **Fixed days** (e.g. Mon, Wed, Fri, each day its own occurrence), **Weekly count** (e.g. 3× per week, the week being one occurrence), and **One-time** (one occurrence by a deadline).
_Avoid_: Frequency, recurrence, cadence

**Deadline**:
When a One-time pact is due: a date, plus its due-by time if one is set, or else midnight.

**Submit anytime**:
A setting on One-time pacts. Off, which is the default, evidence counts only on the deadline's date. On, it counts any time from the pact's creation until the deadline.
_Avoid_: Flexible, open window

**Occurrence**:
One dated instance of a pact that gets judged on its own, e.g. "the night of Tue Oct 21" for a bedtime pact. An occurrence **opens** when its period starts (its date, its Mon–Sun week, or for One-time the deadline's date, or the pact's start with Submit anytime). A change to a pact applies only to occurrences that haven't opened yet, except on One-time pacts.
_Avoid_: Instance, check-in, day, session

**Due time**:
When an occurrence is due and judged: on Fixed days, the due-by time or in-bed-by time, or else midnight; for Weekly count, the end of Sunday; for One-time, the deadline.

**In-bed-by time**:
The time an Oura Ring pact's owner must be in bed by each scheduled night, such as 12:00am. An evening time (from 6pm) is that evening; an earlier one is the morning after. It's the night's due time.

**Night**:
A bedtime pact's occurrence: the night of Tue Oct 21 runs from 6pm Tuesday to 6pm Wednesday. Oura's first main sleep starting in it decides it; with none by 6pm Wednesday, it's Missed.

**Due-by time**:
An optional time of day, such as 9:00am, that a Camera pact's evidence is due by instead of midnight. On a recurring pact it applies each day; on a One-time pact it's the time of the deadline.

**Kept / Missed / Excused**:
The three ways an occurrence can end: the owner met the pact, the owner didn't, or a reviewer approved an excuse for it. Until then, the occurrence is **not judged yet**.
_Avoid_: Passed, failed, success, failure, pending

### Proof and review

**Evidence**:
Proof that an occurrence was kept. It's either pulled automatically (e.g. sleep data) or submitted by the owner (e.g. a photo).
_Avoid_: Proof, submission, check-in

**Evidence kind**:
How a pact's evidence is gathered. It's the first thing picked when creating a pact and never changes. v0 has two: **Camera** (the owner takes a photo and a reviewer checks it) and **Oura Ring** (the ring reports when the owner got into bed, so there's nothing to submit or review).
_Avoid_: Evidence type, data source, source

**Connection**:
A link between a Pact account and an outside service that supplies evidence, such as Oura. Some evidence kinds need one; Camera doesn't.
_Avoid_: Integration, connector, link

**Excuse**:
The owner's request to have one or more occurrences of one pact treated as excused, either because there was a good reason not to keep them or because the evidence was wrong.
_Avoid_: Appeal, dispute, exemption, pass

**Reviewer**:
A person the owner has picked to decide on their evidence, excuses, payments and change requests for a pact. An account can be an owner on some pacts and a reviewer on others.
_Avoid_: Referee, judge, verifier, buddy

**Friend**:
Another account you're connected with through an accepted invite. Only friends can be picked as reviewers. Accepting an invite is agreeing that either of you can pick the other as a reviewer.
_Avoid_: Contact, connection, follower, buddy

**Review Queue**:
The list of items waiting for a reviewer's decision.
_Avoid_: Inbox, to-do list

**Terms**:
What a pact holds its owner to: its schedule, what its photo must show or its in-bed-by time, its penalty, recipient and reviewers. Each occurrence follows the terms in force when it opened, so a change applies only to occurrences not open yet.

**Change Request**:
An owner's proposed change to a pact after its edit window that makes it less strict, such as ending it, lowering the penalty, removing a day or a reviewer, or changing the recipient or description. The pact keeps its terms until a reviewer approves it; a change that relaxes anything is reviewed as a whole. A pact has at most one waiting, and the owner can withdraw it. It may carry a note saying why.
_Avoid_: Edit, amendment

**Stricter change**:
A change that only makes a pact stricter, such as a higher penalty or more days. It needs no approval and applies from the first occurrence not open yet. Renaming a pact or adding a reviewer applies at once, even inside a change request.

### Notifications

**Push subscription**:
One device's permission to get an account's notifications, as its browser reports it. An account can have several. Turning notifications on is per device.

**Notification setting**:
An account's on/off for one kind of notification, on all its devices. Every kind starts on.

### Money

**Penalty**:
The fixed amount the owner owes for each missed occurrence of a pact.
_Avoid_: Fine, stake, forfeit, charge

**Recipient**:
Who a pact's penalties are meant to go to: anyone the owner names, such as a friend or an organization. It's just a name; a recipient isn't an account and is never notified. Several pacts can share one recipient.
_Avoid_: Anti-charity, beneficiary, charity, payee

**Ledger**:
The running total an owner owes one recipient: penalties from every pact with that recipient, minus the payments to it that have been approved.
_Avoid_: Balance, debt, tab

**Bill**:
The penalties an owner owes one recipient, gathered once a week (Wednesday at 6pm) after they can no longer be excused, and due 7 days later. A bill never changes once it's made.
_Avoid_: Invoice, statement, charge

**Overdue**:
Describes a bill still unpaid after its due date.
_Avoid_: Late, delinquent, outstanding

**Payment**:
The owner's record that they paid off some of their ledger, with proof attached. It counts only after a reviewer approves it.
_Avoid_: Settlement, transaction
