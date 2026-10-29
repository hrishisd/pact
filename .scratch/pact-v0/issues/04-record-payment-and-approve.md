# 04 Record a payment and have a reviewer approve it

Status: ready-for-agent
Blocked by: 03

Spec stories: 71–75, 79, 80 (payment parts), 89 (payments).

## What to build

The owner pays a recipient outside the app, records the payment with a screenshot, and a reviewer approves it before it reduces what's owed (ADR 0001).

- **Record payment** from a recipient's ledger card: amount, one screenshot (from the photo library, since it's a screenshot), optional note. Starts at the full owed amount until bills exist (ticket 10 changes it to the open bills' amount).
- The core refuses a payment larger than owed minus payments awaiting approval, so ledgers never go negative.
- While a payment is undecided the ledger card shows one status line, "$20 payment awaiting approval", under what's owed. It also appears under Waiting for approval on Today with the red $ Payment icon.
- **Payment review item:** any reviewer of any pact that has that recipient can decide it. Approve, or Reject with a required reason. First decision is final.
- Approved: owed drops, lifetime paid rises. Rejected: nothing changes in owed (it never dropped), the status line goes away.
- Payments are applied to penalties oldest first; the ledger history shows payments and marks which penalties they've paid.

Ledger rules (spec, Ledger): Owed = penalties not held − approved payments. Awaiting approval = payments not yet decided. Lifetime paid = all approved payments, per recipient.

## Acceptance criteria (core scenarios)

- [ ] $15 owed → record $10 → owed $15, awaiting $10 → a further $10 payment is refused, $5 is allowed.
- [ ] Reviewer approves $10 → owed $5, lifetime paid $10. Reviewer rejects instead → owed $15, awaiting $0, lifetime paid $0.
- [ ] A reviewer of pact A can decide a payment to recipient R when pact A uses R, even if the penalties came from pact B; a friend who reviews no pact with R can't.
- [ ] Three $5 penalties and an approved $7 payment → history shows the oldest paid, the second partly paid, the third unpaid.
- [ ] The owner can't decide their own payment.
