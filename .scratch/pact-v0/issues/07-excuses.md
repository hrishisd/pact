# 07 Excuses, penalty holds and Take the L on Missed cards

Status: ready-for-agent
Blocked by: 03

Spec stories: 42–49, 51, 89 (excuses). Rules: Excuses.

## What to build

The owner asks a reviewer to treat one or more occurrences as Excused, ahead of time, on the day, or after the fact.

- **File excuse:** pick one or more pacts and a date range, a reason, and optional photos (photo library allowed, since they're often screenshots). Before submitting, show exactly which occurrences it will cover.
- **When it can be filed:** any future date range; any occurrence not judged yet; an occurrence judged Missed, or whose evidence was rejected, only within 48 hours of that. The core refuses the rest.
- **Holds:** while an excuse is pending, the penalties it covers are held: they don't count toward owed, and the ledger history marks them held.
- **Approved:** covered occurrences become Excused and their penalties are removed. Occurrences covered ahead of time are judged Excused when they would have been judged. **Rejected:** held penalties are released to owed, and covered occurrences not yet judged are judged normally.
- **Review item:** Excuse kind (slate calendar with an X), showing the reason, photos and covered occurrences. Same Approve / Reject-with-reason flow; any reviewer of a covered pact may decide. Notifies reviewers (new review item) and the owner (decision).
- **Today Missed card:** "File excuse · 31h left" and **Take the L**. Take the L records that the owner accepted the miss, which only takes the card off Today; it doesn't change the ledger, and the owner can still file an excuse from the pact page until the 48 hours are up.
- **Rejected-evidence alert** (from ticket 03): gets "File excuse · 31h left" beside Take the L, with the 48 hours running from the rejection. After Take the L, an excuse can still be filed from the pact page within 48 hours of the rejection.
- **Pact page:** File excuse button, and a "Waiting on" list holding the pact's evidence and excuses.
- **Occurrence labels:** a Missed occurrence with an excuse waiting reads "Missed · excuse waiting for approval". The UI never says "pending".

## Acceptance criteria (core scenarios)

- [ ] Spec example: Mon/Wed/Fri $5 gym pact → Monday Missed, $5 owed → excuse within 48h → held, owed $0 → reviewer approves → Excused, owed $0, no penalty in history.
- [ ] Same, but rejected → owed $5 again.
- [ ] Excuse filed 49 hours after a miss is refused; one filed 47 hours after is accepted.
- [ ] Excuse for next Fri–Sun filed Wednesday, approved Thursday → those days are Excused when they end, with no penalty.
- [ ] One excuse covering two pacts over three days → one review item; approval excuses every covered occurrence on both.
- [ ] Rejected evidence on Monday → excuse filed within 48h of the rejection is accepted.
- [ ] Take the L removes the Missed card from Today, leaves owed unchanged, and an excuse is still accepted afterwards inside the window.
- [ ] The rejected-evidence alert shows "File excuse" with the time left counted from the rejection; after Take the L on the alert, an excuse is still accepted within 48 hours of the rejection.
- [ ] A pending excuse survives a restart with its holds intact.

## Out of this ticket

Weekly count whole-week excuses (14). Oura nights (08/09) reuse this as-is.

## Comments

**Prototype, round 1.** `.scratch/pact-v0/prototype/excuses.prototype.html` compares three filing forms (A one sheet, B pick days, C steps) and has switches for the behaviours this ticket leaves open: what Today shows when an excuse covers today, an alert for a rejected excuse, re-filing after a rejection, one review item vs one per reviewer set, withdrawing, and where File excuse on a pact page starts. Waiting on the human's picks before the spec and this ticket are updated.

**Prototype, round 2.** Feedback on round 1: an excuse should target one pact or one occurrence, and the all-pacts picker with Yesterday / Today / Tomorrow shortcuts offered days the pact may not have. Round 2 opens every File excuse for its own pact and compares three ways to pick its days: A (the day you came from, shown as a card, optionally run on to later days; from the pact page, one recent day or a range ahead), B (tap the pact's real days as tiles, a week back and four ahead) and C (From/To dates starting on that day, listing the pact's days in range). A new switch covers story 45 (one excuse for several pacts): add other pacts in the sheet, offer them after sending, or one pact per excuse.

**Prototype, round 3.** The human dropped other pacts from the excuse sheet: an excuse covers one pact, so story 45 (one excuse across several pacts) and the one-item-vs-split question go away. The reason box loses its helper text and its example becomes "e.g. Sick with the flu"; the photo field loses its helper text.

**Prototype, round 4.** Decided by the human: when an excuse covers today, today's card leaves To do and the excuse shows under Waiting for approval; a rejected excuse raises an alert on Today with Take the L; no withdrawing an excuse in v0. "Excused when it ends, if approved" is dropped from the owner's copy. The sheet gets a prototype-only A/B/C switch so the filing forms can be compared on a phone. Still open: which filing form, and whether a day can be excused again after its excuse is rejected.
