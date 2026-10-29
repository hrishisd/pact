# 07 Excuses, penalty holds and "I'll pay it"

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
- **Today Missed card:** "File excuse · 31h left" and **I'll pay it**. I'll pay it records that the owner accepted the miss, which only takes the card off Today; it doesn't change the ledger, and the owner can still file an excuse from the pact page until the 48 hours are up.
- **Pact page:** File excuse button, and a "Waiting on" list holding the pact's evidence and excuses.
- **Occurrence labels:** a Missed occurrence with an excuse waiting reads "Missed · excuse waiting for approval". The UI never says "pending".

## Acceptance criteria (core scenarios)

- [ ] Spec example: Mon/Wed/Fri $5 gym pact → Monday Missed, $5 owed → excuse within 48h → held, owed $0 → reviewer approves → Excused, owed $0, no penalty in history.
- [ ] Same, but rejected → owed $5 again.
- [ ] Excuse filed 49 hours after a miss is refused; one filed 47 hours after is accepted.
- [ ] Excuse for next Fri–Sun filed Wednesday, approved Thursday → those days are Excused when they end, with no penalty.
- [ ] One excuse covering two pacts over three days → one review item; approval excuses every covered occurrence on both.
- [ ] Rejected evidence on Monday → excuse filed within 48h of the rejection is accepted.
- [ ] I'll pay it removes the Missed card from Today, leaves owed unchanged, and an excuse is still accepted afterwards inside the window.
- [ ] A pending excuse survives a restart with its holds intact.

## Out of this ticket

Weekly count whole-week excuses (14). Oura nights (08/09) reuse this as-is.
