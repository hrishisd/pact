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

- [x] $15 owed → record $10 → owed $15, awaiting $10 → a further $10 payment is refused, $5 is allowed.
- [x] Reviewer approves $10 → owed $5, lifetime paid $10. Reviewer rejects instead → owed $15, awaiting $0, lifetime paid $0.
- [x] A reviewer of pact A can decide a payment to recipient R when pact A uses R, even if the penalties came from pact B; a friend who reviews no pact with R can't.
- [x] Three $5 penalties and an approved $7 payment → history shows the oldest paid, the second partly paid, the third unpaid.
- [x] The owner can't decide their own payment.

## Comments

### 2026-10-31: built, waiting on the phone check

What was done:
- **Core.** Migration 8 adds the `payment` table. `recordPayment` refuses an amount over what can still be paid (owed less payments awaiting approval), and it checks again inside the transaction so two payments at once can't both get through. Every reviewer of any of the owner's pacts with that recipient gets a review item. `decide` takes payment ids too: the first decision is final, a rejection needs a reason, and the owner and anyone who reviews no pact with that recipient get `item-not-found`. Ledgers gain `awaitingCents`, `awaitingCount`, `payableCents` and approved payments in `paidCents`. A ledger's history lists payments with their state (awaiting approval, approved by X, or rejected by X with the reason) and gives each penalty `paidCents`, paying the oldest first.
- **Screenshots.** `POST /api/ledgers/:id/payments` takes the amount, an optional note and one JPEG. It shares its photo intake with the evidence route (`receivePhotos`) and goes into the existing photo store. `GET /api/photos/:id` now also serves a payment's screenshot to its owner and to any reviewer of any of the owner's pacts with that recipient. Everyone else gets 404.
- **Screens.** The ledger card has the status line ("$10 payment awaiting approval", or "2 payments awaiting approval · $15") and Record payment, which also appears on the history page. The Record a payment sheet picks a screenshot from the photo library (no `capture`) and shrinks it like evidence. History shows payment rows and "Paid" / "$3 of $5 paid" markers. Today lists payments under Waiting for approval with the red $ icon. Review has a Payment item with the screenshot, note, what's owed, and what approving leaves owed.
- **Decided with the human.** The card's big number stays at owed while a payment awaits approval. For the markers, see the spec's Changes since the prototype, which also records that a rejected payment has no alert and shows in the history.
- **Departure from this ticket.** Record payment starts at what can still be paid (owed less payments awaiting approval), not the full owed amount, because the core would refuse the full amount while a payment is awaiting approval. With nothing awaiting, the two are the same.
- **Tests.** Every acceptance criterion has a scenario: `payments.test.ts` covers the limits, approve and reject, the reviewer of pact A with penalties from pact B, the friend who reviews no pact with R, and the owner deciding their own payment; `ledgers.test.ts` covers $7 against three $5 penalties. `app.test.ts` covers the upload route, its 400s, the review over HTTP, and screenshot access, including a 404 for a friend who reviews no pact with that recipient.
- **Browser check.** I drove the browser at phone width with dev sign-in. The server clock was shifted forward with a throwaway preload to get three $5 misses. As the owner I recorded $10 and $5, then as the reviewer approved the $10 and rejected the $5. I checked owed, the status line, lifetime paid, Waiting for approval and the history after each step. A further $3, once approved, showed "$3 of $5 paid".

Left for the human:
- Deploy. Migration 8 runs on boot.
- On a real iPhone, check:
  - that "Choose screenshot" opens the photo library (with the camera offered only as iOS's own option)
  - that a shrunk screenshot (1280px long edge) keeps a Venmo or bank receipt's text readable for the reviewer
  - that the sheet works with the keyboard up: the amount field's keypad, the note, and Send for approval staying reachable
  - that tapping the ledger card opens its history and tapping Record payment doesn't
  - that the reviewer's screenshot loads quickly over cellular

Status stays ready-for-agent until the phone check passes.
