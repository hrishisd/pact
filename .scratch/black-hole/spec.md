# Black hole

Status: needs-triage

An idea jotted down on 2026-11-23. Nothing here is decided. Vocabulary follows `GLOSSARY.md`.

## Problem

Nothing makes an owner pay a ledger. Today an owner pays a recipient outside the app and uploads a screenshot for a reviewer to approve. If the owner never pays, the only cost is social: Overdue reminders to the owner and alerts to their reviewers. An owner can stop opening the app, or delete it, and nothing else happens. The money at stake is only as real as the owner's willingness to pay.

## Idea

Give the app a way to move money without the owner's cooperation, so that an unpaid ledger has a consequence the owner can't walk away from.

The working name is the **black hole**: an organization the owner picks ahead of time, which the app can pay directly. The owner connects a way to pay before the pact starts, so the app can take money later. If a ledger is still unpaid some time after its bill is due, the app pays the black hole on the owner's behalf.

The black hole is a separate organization, not the recipient. It doesn't need to be one the owner dislikes. What makes the owner prefer paying the recipient is the price: **the black hole gets twice what the owner owes** (decided 2026-11-23). Paying the recipient on time always costs half as much.

Two shapes the idea could take:

- **Escrow up front.** The app takes money from the owner when a pact starts (or as penalties arise) and holds it. Paying the recipient on time releases it back to the owner. Missing the deadline sends it to the black hole.
- **Charge on default.** The app holds no money. The owner saves a payment method, and the app charges it only when a bill is overdue past some limit.

## Open questions

- Which organization is the black hole? It is separate from the recipients, and the main requirement is that the app can send it money easily. Not chosen yet.
- If the black hole pays 2× what is owed, does the escrow or the saved payment method need to cover 2× from the start? Escrowing 2× of every penalty up front is a lot of money to lock away.
- How long after a bill is due does the app act? How does this fit the Overdue spell?
- What happens to excuses and held penalties? The app must not take money for a penalty an excuse may still cover.
- Does a black hole payment count as an approved payment on the ledger, so the ledger reads $0 owed afterwards?
- Holding money is a regulatory question. An app that takes custody of users' funds may need money-transmitter licensing; a payment processor's platform product (for example Stripe Connect) may carry that burden instead. Card authorization holds expire after days, so they can't back a pact that runs for weeks.
- Which organizations can accept money directly, and how does the owner connect to one?
- Can the owner remove the payment method or cancel the arrangement mid-pact? If they can, the guarantee is gone; if they can't, what are the exit rules (an approved change request, like a lower penalty)?
- Accepting and sending money is a large new area: refunds, disputes and chargebacks, failed charges, fees, and tax receipts for donations.

## Comments
