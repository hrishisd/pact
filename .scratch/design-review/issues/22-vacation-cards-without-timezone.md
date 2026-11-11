# 22 Profile's vacation queries without a timezone

Status: needs-triage
Blocked by: none

Found while building ticket 04.

## Problem

`vacationCards` and `lastVacation` (`src/core/vacations.ts`, `AccountView.vacations()` and `lastVacation()`) read the owner's timezone through `timezoneOf`, which throws "account ... owns a pact but has no timezone" (`ownerZone`, `src/core/rows.ts`) for an account with no confirmed timezone. `GET /api/vacations` and `GET /api/vacations/last` then answer 500 with a misleading message. Ticket 04 fixed the same path for `vacationOptions`, `previewVacation` and `fileVacation`, which now refuse with `no-timezone`. The client confirms the timezone first, so only a direct call (or a future screen that loads Profile earlier) reaches it.

## What to build

An account with no timezone can have no vacations, so these queries can answer an empty list and null without changing their result types. Check other `timezoneOf` callers reachable from an account without pacts for the same throw.

## Acceptance criteria

- [ ] Core scenario: `vacations()` and `lastVacation()` for an account with no timezone answer `[]` and `null`.
- [ ] Remove the known-bug note in `docs/behaviour.md`, "Time and timezones".
- [ ] `npm run check` passes.
