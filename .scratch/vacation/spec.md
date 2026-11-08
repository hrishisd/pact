# Vacation

Status: needs-triage

Design in progress (grilling started 2026-11-08). This file records decisions as they're made. Vocabulary follows `GLOSSARY.md`.

## Problem

An owner going away for a week or two has to file one excuse per pact (story 45 dropped multi-pact excuses). A vacation lets them ask once, ahead of time, for a date range off.

## Decisions

1. **Name.** It's a **vacation**, not "vacation mode": a dated request, not a switch.
2. **Reviewer approval.** Every vacation needs a reviewer's approval, however far ahead it's set. A no-approval rule (e.g. at least 10 days ahead and at most 2 weeks long) was considered and dropped as more complicated.
3. **Outcome.** Occurrences a vacation covers are judged **Excused**, the same outcome an approved excuse gives. There's no fourth outcome; only the heat map draws them differently (decision 13).
4. **Earliest day.** A vacation covers only occurrences that haven't opened yet. An occurrence that's already open or past still needs an excuse.
5. **Money.** A vacation doesn't pause the ledger. Bills are still made every Wednesday, and an Overdue spell's reminders and reviewer notices keep running.
6. **Owners only.** Reviewers can't go on vacation. A reviewer who's away can turn off notifications.

7. **Which pacts.** The owner picks the pacts it covers from a checklist with Select all. Every recurring pact is ticked by default; One-time pacts are in their own section below, unticked. A pact created after the vacation is filed isn't covered.
8. **One review item, to reviewers the owner picks.** A vacation is one review item covering all its pacts, approved or rejected as a whole. The owner picks which reviewer or reviewers it goes to, from the reviewers of the pacts they ticked, with nobody ticked by default; it isn't sent to every reviewer automatically. Any one picked reviewer can approve or reject it, and it then leaves the others' Review Queues.
9. **Partial weeks.** A Weekly count week is excused whole if its Wednesday falls inside the vacation. Otherwise it keeps its full target. (This differs from excuses, where any covered day excuses the week: a vacation starting on a Sunday would otherwise excuse the week before it.)
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

- Wednesday or Thursday as the day that decides a partial week.
- Whether the Reviewers step is skipped when the ticked pacts have one reviewer between them.
- Whether every covered pact must keep at least one of its own reviewers picked.
- Notifications: who is told when a vacation is asked for, decided, and starts.

## Prototype

`prototype/vacation` branch (local, not pushed), `.scratch/vacation/prototype/vacation.prototype.html`, published as a private artifact. Round 1 compared every pact vs a checklist, Profile vs Today as the entry point, Today during a vacation (banner only vs banner plus muted pacts) and the heat map (own marker vs Excused). Round 1 picks: Profile, banner only, and the heat map's own marker (decision 13). Round 2 shows the step flow and the approval lifecycle.
