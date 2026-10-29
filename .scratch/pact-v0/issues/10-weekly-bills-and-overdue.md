# 10 Weekly bills and Overdue

Status: ready-for-agent
Blocked by: 04, 05, 07

Spec stories: 76–78, 80 (bill status lines and bill markers), 84, 90. Rules: Bills, Overdue, Ledger (Overdue).

## What to build

Turn penalties into one bill per recipient every Wednesday at 6pm, due a week later, and make an unpaid bill impossible to ignore.

### Bills
- Every Wednesday at 18:00 (owner's timezone), each recipient gets one bill holding the owner's owed penalties whose 48-hour excuse window has closed and that aren't on a bill yet. Held penalties wait. No bill for a recipient with nothing to bill.
- Due at 18:00 seven days later. A bill never changes after it's created.
- A penalty that comes later (rejection after its week, a released hold) goes on the next Wednesday's bill. Accepting a miss doesn't bill it sooner.
- A bill is paid once payments (applied oldest first) cover all its penalties. The owner can pay at any time.
- New bill → notifies the owner (new bill kind).

### Screens
- **Today:** no money until a bill exists; then a To do card such as "Pay Rival Org $12 · due Wed Nov 4 at 6pm" with Record payment. The card goes away once a payment covering the bill is approved or waiting for approval.
- **Ledgers card:** one status line only when needed: overdue in red, "$4 bill due Wed Oct 28", or a payment awaiting approval. Record payment starts at the open bills' amount.
- **Ledger history:** each penalty says which bill it's on, or that it goes on a Wednesday bill once it can't be excused (held penalties too).

### Overdue
- Overdue = the unpaid part of bills whose due time has passed. The owner is warned only about the part payments awaiting approval don't cover.
- While that part is above zero: a red alert on Today and a daily reminder push (overdue bill kind).
- Reviewers of pacts with that recipient are notified when the owner first goes overdue, then weekly.

## Acceptance criteria (core scenarios)

- [ ] Penalties judged Mon–Sun → all on Wednesday 18:00's bill, including Sunday night's bedtime judged Monday 18:00.
- [ ] A penalty judged Tuesday (excuse window still open Wednesday 18:00) waits for the next Wednesday.
- [ ] A held penalty released by a rejected excuse lands on the next bill; an earlier bill is unchanged.
- [ ] No penalties → no bill and no notification.
- [ ] Bill unpaid at its due time → alert and daily reminder; a pending payment covering it removes the alert and stops reminders; that payment rejected → alert returns.
- [ ] Reviewers notified on first overdue, not again for six days, again on day seven.
- [ ] Catching up after hours of downtime in one advance creates the bills and overdue states it missed.
- [ ] Today shows no money before a bill exists, and the bill's To do card afterwards.
