# 17 Heat map and Yesterday summary

Status: ready-for-agent
Blocked by: 03

Spec stories: 81, 82.

## What to build

History views, once there's history to show.

- **Pact page heat map:** GitHub-style grid of the pact's occurrences coloured Kept, Missed, Excused and Not judged yet (legend uses that wording). One cell per day for Fixed days; for Weekly count, one per week (or the week's days) — pick the clearer one against the prototype on `prototype/pact-v0-flows`.
- **Yesterday** on Today, after Waiting for approval: how each pact did yesterday, so the owner can see results after alerts have cleared.

## Acceptance criteria (core scenarios)

- [x] The pact page query returns every occurrence since the first with its outcome, including Excused and not judged yet.
- [x] Yesterday lists yesterday's Kept, Missed and Excused occurrences and leaves out pacts not due yesterday.

## Comments

**Prototype round 1 (2026-11-03):** `.scratch/pact-v0/prototype/changes.prototype.html`, History tab. Option A, the GitHub grid, was chosen; Weekly count gets one square per week with its session count (ticket 14 adds that). See the spec's Screens (Heat map, Yesterday).

- 2026-11-03: Built on branch claude/unblocked-tickets-prototypes-361pre (stacked on ticket 08's branch). Pending human review, so Status stays ready-for-agent. Core scenarios are in src/core/history.test.ts. The core returns every day from the first occurrence through this week's Sunday (null on days not due), so the client holds no schedule rule. PactHistory has a "fixed-days" kind only; ticket 14 adds a "weekly-count" variant with one square per week. Yesterday also lists occurrences still waiting for approval, with that chip.
