# 04 Body size and text length limits

Status: ready-for-agent
Blocked by: 01

Closes: S2 and the vacation preview 500 (`../code-structure-review.md`, section 2).

## Problem

- `bodyLimit` is applied only to the three photo routes (`src/server/app.ts:522`, `533`, `552`). JSON routes read the whole body (`app.ts:745-747`), and the core caps no text length: names, notes, reasons, questions and replies are unbounded. Push text is truncated (`src/core/web-push.ts:68`); screens are not. Any signed-in friend can write a reject reason or question of many megabytes that then loads on the owner's Today and item pages on every visit. Sign-up is invite-only, so the realistic risk is a bug or a paste.
- `previewVacation` for an account with no confirmed timezone throws "account ... owns a pact but has no timezone" (`src/core/vacations.ts:104-107` via `timezoneOf` and `ownerZone`, `src/core/rows.ts:111-117`). That is a 500 with a misleading message. The client always confirms the timezone first, so only a direct call reaches it.

## What to build

- `app.use("/api/*", bodyLimit({ maxSize: 64 * 1024 }))` registered so the three photo routes keep their own larger limits. A body over the limit gets 413.
- A shared `MAX_TEXT_CHARS` in `src/shared/types.ts` (suggested 2,000; pact and recipient names much shorter, say 80, as `MAX_NAME_CHARS`). The core refuses longer text as a domain refusal (`{ ok: false, reason: "text-too-long" }`) in every command that takes free text: pact and recipient names, change request notes, evidence and payment notes, excuse reasons, vacation notes, reject reasons, questions and replies. The client's text fields set `maxLength` from the same constants and show the refusal through `failureText`.
- `previewVacation` and `vacationOptions` return a refusal (for example `no-timezone`) for an account with no timezone, as other commands do, instead of throwing. Check `fileVacation` for the same path.

## Where to start

- `src/server/app.ts:522-552` (photo routes), `app.ts:745-747` (JSON body read).
- Every command in `src/core/core.ts:182-451` that takes a string.
- `src/core/vacations.ts:55-60`, `104-107`, `217`.

## Acceptance criteria

- [ ] Route test: a 65 KB JSON body to a JSON route gets 413; a photo upload over 64 KB still works.
- [ ] Core scenarios: a reject reason, a question and an excuse reason one character over the cap are refused with `text-too-long`; at the cap they are accepted.
- [ ] Core scenario: `previewVacation` for an account with no timezone returns the refusal, not a throw.
- [ ] Update `docs/behaviour.md` with the limits.
- [ ] `npm run check` passes.

## Out of scope

- Rate limiting.
- Trimming text already stored.
