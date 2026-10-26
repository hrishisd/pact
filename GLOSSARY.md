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

**Occurrence**:
One dated instance of a pact that gets judged on its own, e.g. "the night of Tue Oct 21" for a bedtime pact.
_Avoid_: Instance, check-in, day, session

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
The owner's request to have one or more occurrences treated as excused, either because there was a good reason not to keep them or because the evidence was wrong.
_Avoid_: Appeal, dispute, exemption, pass

**Reviewer**:
A person the owner has picked to decide on their evidence, excuses, payments and change requests for a pact. An account can be an owner on some pacts and a reviewer on others.
_Avoid_: Referee, judge, verifier, buddy

**Friend**:
Another account you're connected with through an accepted invite. Only friends can be picked as reviewers or as a person recipient. Accepting an invite is agreeing that either of you can pick the other as a reviewer.
_Avoid_: Contact, connection, follower, buddy

**Review Queue**:
The list of items waiting for a reviewer's decision.
_Avoid_: Inbox, to-do list

**Change Request**:
An owner's proposed edit to a pact that makes it less strict, such as deleting or pausing it or lowering the penalty. The pact stays as it is until a reviewer approves the change.
_Avoid_: Edit, amendment

### Money

**Penalty**:
The fixed amount the owner owes for each missed occurrence of a pact.
_Avoid_: Fine, stake, forfeit, charge

**Recipient**:
Where a pact's penalties are meant to go: a person (e.g. a friend) or an organization. Several pacts can share one recipient.
_Avoid_: Anti-charity, beneficiary, charity, payee

**Ledger**:
The running total an owner owes one recipient: penalties from every pact with that recipient, minus the payments to it that have been approved.
_Avoid_: Balance, debt, tab

**Bill**:
The penalties an owner owes one recipient, gathered once a week (Wednesday at noon) after they can no longer be excused, and due 7 days later. A bill never changes once it's made.
_Avoid_: Invoice, statement, charge

**Overdue**:
Describes a bill still unpaid after its due date.
_Avoid_: Late, delinquent, outstanding

**Payment**:
The owner's record that they paid off some of their ledger, with proof attached. It counts only after a reviewer approves it.
_Avoid_: Settlement, transaction
