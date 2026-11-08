# Vacation

Status: needs-triage

Design in progress (grilling started 2026-11-08). This file records decisions as they're made. Vocabulary follows `GLOSSARY.md`.

## Problem

An owner going away for a week or two has to file one excuse per pact (story 45 dropped multi-pact excuses). A vacation lets them ask once, ahead of time, for a date range off.

## Decisions

1. **Name.** It's a **vacation**, not "vacation mode": a dated request, not a switch.
2. **Reviewer approval.** Every vacation needs a reviewer's approval, however far ahead it's set. A no-approval rule (e.g. at least 10 days ahead and at most 2 weeks long) was considered and dropped as more complicated.
3. **Outcome.** Occurrences a vacation covers are judged **Excused**, the same outcome an approved excuse gives. There's no separate "Vacation" outcome or heat map square.
4. **Earliest day.** A vacation covers only occurrences that haven't opened yet. An occurrence that's already open or past still needs an excuse.
5. **Money.** A vacation doesn't pause the ledger. Bills are still made every Wednesday, and an Overdue spell's reminders and reviewer notices keep running.
6. **Owners only.** Reviewers can't go on vacation. A reviewer who's away can turn off notifications.

## Open questions

- Which pacts a vacation covers: every Active pact, or a checklist with every pact ticked.
- Whether a vacation is one review item or one excuse per pact, and which reviewers decide it.
- A Weekly count week only partly inside a vacation.
- One-time pacts whose deadline falls inside a vacation.
- The longest vacation allowed.
- Withdrawing, ending early or changing a vacation.
- Screens: where it's set up, Today during a vacation.

## Prototype

`prototype/vacation` branch (local, not pushed), `.scratch/vacation/prototype/vacation.prototype.html`, published as a private artifact. Round 1 compared every pact vs a checklist, Profile vs Today as the entry point, Today during a vacation (banner only vs banner plus muted pacts) and the heat map (own marker vs Excused). The heat map is settled by decision 3: Excused.
