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

7. **Which pacts.** The owner picks the pacts it covers. Every recurring pact is ticked by default; One-time pacts are listed but unticked. A pact created after the vacation is filed isn't covered.
8. **One review item, to reviewers the owner picks.** A vacation is one review item covering all its pacts, approved or rejected as a whole. The owner picks which reviewer or reviewers it goes to; it isn't sent to every reviewer automatically.
9. **Partial weeks.** A Weekly count week partly inside a vacation is excused whole, as with excuses.
10. **One-time pacts.** A ticked One-time pact whose deadline falls inside the vacation has that deadline excused, and the pact ends.
11. **Length.** At most 62 days, the same cap as excuses.
12. **Withdrawing.** The owner can withdraw a vacation while it's waiting for approval. Once approved it can't be changed or ended early; days after an early return stay Excused.
13. **Screens.** The owner sets up a vacation from a Vacation row on the Profile sheet, never from Today. A waiting or upcoming vacation shows on Profile only. Today during a vacation shows only a banner, with the covered pacts hidden. The heat map gives vacation days their own marker and legend entry, though their outcome is Excused.
14. **Creation flow.** Steps like Create pact: (1) first and last day; (2) pacts; (3) confirm, showing the dates, the pacts ("All pacts" whenever the choice covers every pact, however it was made) and what each loses, then asking for approval.
15. **Waiting when it starts.** If a vacation is still waiting for approval when its first day comes, excuse rules apply: occurrences are judged as usual, penalties are held, and reminders keep going. Approval then turns covered Missed occurrences into Excused and removes their penalties.
16. **Rejection.** Like a rejected excuse: held penalties become owed, Today shows a rejected-vacation alert with the reviewer's reason, Take the L clears it, and the owner can file again for days that haven't opened yet.
17. **No reason, an optional note.** A vacation needs no reason. The dates step has an optional note saying what the owner is doing, such as "Going to Portugal".
18. **Overlaps.** Days already Excused, on a pending excuse or on another vacation are skipped, not refused. A vacation is refused only when no day is left to cover.

## Open questions

- Which reviewers the owner can pick from, the default, and whether one picked reviewer's decision is enough.
- Whether a vacation day's outcome is Excused (drawn with its own heat map marker) or a fourth outcome.
- Partial Weekly count weeks: the whole-week rule turns Sun Dec 20 – Sat Jan 2 into 3 Gym weeks off. Keep it, excuse a week only with at least 4 of its days inside, or lower the target.
- Step 2's layout: "All pacts / Choose pacts" (V1) vs a plain checklist with Select all (V2).

## Prototype

`prototype/vacation` branch (local, not pushed), `.scratch/vacation/prototype/vacation.prototype.html`, published as a private artifact. Round 1 compared every pact vs a checklist, Profile vs Today as the entry point, Today during a vacation (banner only vs banner plus muted pacts) and the heat map (own marker vs Excused). Round 1 picks: Profile, banner only, and the heat map's own marker (decision 13). Round 2 shows the step flow and the approval lifecycle.
