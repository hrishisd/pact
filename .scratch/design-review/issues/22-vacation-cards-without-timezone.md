# 22 An account always has a timezone

Status: done
Blocked by: none

Found while building ticket 04. First filed as "Profile's vacation queries without a timezone"; reworked into a proposal to make that state impossible, at the owner's request.

## Problem

`account.timezone` is nullable (migration 1: "NULL until the user confirms one"), so every reader has to decide what an account with no timezone means. They decide differently:

- Refused with `no-timezone`: creating a pact (`checkedTerms`, `pact-rules.ts`), `firstOccurrence` (`pacts.ts`), and Plan a vacation's options, preview and filing (`vacations.ts`, `:111`, `:226`, added by ticket 04).
- Folded into `pact-not-found`: `pactPage` (`pacts.ts`), `excuseOptions` and `excusePreview` (`excuses.ts`, `:244`), `evidenceAcceptance` (`evidence.ts`).
- Answered empty: `todayPage` (`today.ts`); bills skip the account (`makeBills`, `money.ts`, `WHERE timezone IS NOT NULL`).
- Thrown: `ownerZone` and `timezoneOf` (`rows.ts`) throw "account ... owns a pact but has no timezone". Reached by `vacationCards` and `lastVacation` (`vacations.ts`, `:310`), so `GET /api/vacations` and `GET /api/vacations/last` answer 500 for such an account (the original bug in this ticket). Every other `ownerZone` caller is behind a pact, which can't exist without a timezone.
- Typed `string | null` and passed on: row types in `judging.ts`, `reminders.ts`, `change-requests.ts` and `:303`, `occurrence-state.ts`, `anki-days.ts` and `:198`, `money.ts`, `pact-rules.ts`, `evidence.ts`, `excuses.ts`, `pacts.ts`; `Profile.timezone` (`src/shared/types.ts`).
- Client: `ConfirmedProfile` and `isConfirmed` gate the whole Shell (`App.tsx`, `:95`); copy for `no-timezone` in `pact-form-steps.tsx` and `PlanVacation.tsx`, `:472`.
- Planned: ticket 21 adds a rule for "a reviewer with no timezone yet" (use the owner's of their oldest waiting item).

### How an account gets no timezone, and for how long

`signIn` (`accounts.ts`) inserts the account without one. It gets one only when the client's ConfirmTimezone screen (`App.tsx`, story 2) posts `POST /api/me/timezone`. `setTimezone` refuses an invalid zone and nothing ever clears it, so once set it stays set.

The window is not bounded, though. It lasts until the person confirms, which may be never: a person who signs in and closes the tab keeps a timezone-less account indefinitely. And it is not inert: the invite page shows before the timezone screen (`App.tsx`), so an invited person accepts the invite and becomes the inviter's friend before confirming. From then on they can be picked as a reviewer, be told about pacts, and decide items, all without a timezone. Every API route is open to them; only the client hides the app until they confirm.

## Proposal

Record the timezone when the account is created, from the browser that signs in, and make the column NOT NULL. The state then can't be stored, the types lose `| null`, and every check above goes.

### Why not split the account into "before setup" and "after setup"

A pending-account type (say `core.as(id)` answering a `PendingAccountView` with only `setTimezone`, `profile`, `invite` and `acceptInvite`) keeps the state and moves the check to a boundary: the column stays nullable, the server needs a refusal for every other route, and a pending account can still be a friend, so it can still be picked as a reviewer, which is where ticket 21 needs its fallback. It is more code than today, not less. Creation-time timezone removes the state instead.

### How the timezone reaches the core

The browser knows its zone at sign-in (`Intl.DateTimeFormat().resolvedOptions().timeZone`, as `detectedTimezone` in `App.tsx` reads it now). Sign-in already carries an invite token through Google's redirect in the OAuth state (`signInWithInvite` passes `additionalData`; the `user.create.before` hook in `src/server/auth.ts` reads it with `getOAuthState()`). The timezone rides the same way:

- `src/shared/api.ts`: a `TIMEZONE_SIGN_IN_KEY` beside `INVITE_TOKEN_SIGN_IN_KEY`.
- `src/client/api.ts`: `signInWithGoogle` and `signInWithInvite` both pass `additionalData: { [TIMEZONE_SIGN_IN_KEY]: detectedTimezone() }` (move `detectedTimezone` out of `App.tsx`).
- `src/server/auth.ts`: the create hook passes the state's timezone to `core.signIn`; so does `devSignIn`, from a new `timezone` field on its body.
- `src/server/app.ts`: the dev sign-in route takes an optional `timezone` query parameter (default below). Update `docs/agents/local-dev.md`.
- Core: `signIn(ctx, operatorEmailKey, identity, { inviteToken?, timezone })` canonicalises it with `canonicalTimezone` and inserts it with the account. An existing account's sign-in ignores it: changing zone stays a Profile action.

The core decides what a missing or unrecognised zone means (a sign-in started before the deploy, a browser reporting a zone Intl can't resolve, a hand-made request). Proposed: fall back to `UTC` rather than refuse sign-in, since the person can change it in Profile. See open question 2.

### Database

A new migration (append; never edit migration 1). SQLite can't add NOT NULL to a column, so rebuild `account` by the 12-step procedure with `foreignKeysOff: true`, as migrations 25 and 26 do (34 foreign keys reference `account`):

1. Backfill: `UPDATE account SET timezone = <default> WHERE timezone IS NULL` (see open question 3; proposed: the operator's timezone if set, else `'UTC'`).
2. `CREATE TABLE account_new` with every current column (`id, email, email_key, name, timezone, is_operator, created_at, billed_through, oura_latest_bedtime_start`; check with `PRAGMA table_info(account)` before writing it), `timezone TEXT NOT NULL`.
3. Copy, drop, rename, and recreate the `account_one_operator` unique index.

A backfilled account owns no pact (creating one needed a timezone), so the guess moves no due time or reminder. `makeBills` starts covering it from `created_at`; it has no penalties, so no bill is made.

### The confirm-timezone step

`ConfirmTimezone` (`App.tsx`) exists to fill the null; with the timezone set at sign-up it has nothing to save. Proposed: remove it, along with `ConfirmedProfile` and `isConfirmed`. The detected zone is used, and Profile's Timezone row (already there, `App.tsx`) is where a wrong one is fixed. Story 2 in `.scratch/pact-v0/spec.md` ("shown for me to confirm") then no longer holds; record the change in `docs/behaviour.md`.

If the owner wants new people still to see their zone once (open question 1), keep the screen as a first-run welcome that needs no state: Better Auth's `signIn.social` takes `newUserCallbackURL` (in 1.7.14), so a new account lands on a welcome path showing the zone with Confirm and Pick another; Confirm just continues, Pick another calls `setTimezone`. The invite flow needs care there (new invitees must still come back to the invite page to accept). This is a user-facing change: per `docs/agents/prototype-first.md`, ask whether to prototype it.

## What it removes

- Core: `ownerZone` and `timezoneOf` (`rows.ts`); callers read `accountRow(...).timezone` or the joined column directly. `accountRow` returns `timezone: string`. Every `timezone === null` branch and `string | null` row type listed under Problem. `WHERE timezone IS NOT NULL` in `makeBills`. The "Every pact's owner has a timezone" comment in `today.ts` and the refusal note on `AccountView` (`core.ts`).
- Shared: `"no-timezone"` from the create-pact refusals (`types.ts`) and `FirstOccurrenceResult` (`types.ts`); the `NoTimezone` type (`types.ts`) and its uses in `VacationOptionsResult` and `VacationPreviewResult`. `VacationOptionsResult` then has only its success arm: either answer `VacationOptions` directly (changes the route's response shape and the client) or keep `{ ok: true, options }`; the implementer picks, the simpler one preferred. `Profile.timezone` becomes `string`; drop "Null until the user confirms one". Drop the note on `api.ts`.
- Client: `ConfirmedProfile`, `isConfirmed` and (if removed) `ConfirmTimezone` in `App.tsx`; the `no-timezone` copy in `pact-form-steps.tsx`; `PlanVacation.tsx`'s "No timezone yet" screen (`:38`) and its `no-timezone` case (`:472`).
- Tests: `text-limits.test.ts` "Plan a vacation with no timezone"; the `no-timezone` cases in `pacts.test.ts` (around lines 71 and 124); `sign-in.test.ts` ("with no timezone confirmed yet") becomes "with the browser's timezone"; `timezone: null` expectations in `invites.test.ts` and `app.test.ts`, `:594`. The scenario's `s.signIn` gives every account `America/New_York` unless told otherwise, so the `setTimezone` calls in `src/core/testing/*-pact.ts` become optional. The browser smoke test's two "Confirm" clicks (`e2e/smoke.spec.ts`, `:57`) go if the screen goes.
- Docs: the "Time and timezones" bullet in `docs/behaviour.md` about `no-timezone` and its known-bug note for this ticket.
- Ticket 21: its "reviewer with no timezone yet" fallback and scenario are no longer needed (see open question 4).

## Risks

- The migration guesses a zone for any account that never confirmed. Harmless for due times (such accounts own no pacts) but the person will see the guess in Profile. Check production first (open question 3).
- A sign-in whose OAuth state was made by the old client (a flow in progress across the deploy) has no timezone and gets the fallback.
- Silently using the detected zone removes a moment where a person on a VPN, or with a mis-set device clock, would notice a wrong zone. Profile still shows it.
- The rebuild runs with foreign keys off over the most-referenced table. `db.ts` refuses a migration that leaves a dangling reference; `migrations.test.ts` should cover the backfill and the NOT NULL.

## Acceptance criteria

- [x] New migration: `account.timezone` is `TEXT NOT NULL`; existing NULLs are backfilled with the agreed default; every other column, row and the `account_one_operator` index survive. A migration test opens a database with a NULL-timezone account at the previous version and finds the default after.
- [x] Core scenario: signing in a new account with a timezone stores its canonical name, and `profile().timezone` is it. With a missing or unrecognised timezone it stores the agreed fallback. An existing account's sign-in leaves its timezone as it was.
- [x] Google and invite sign-in pass the browser's zone through the OAuth state to `core.signIn`; the dev sign-in takes `timezone` (default `America/New_York`). An `app.test.ts` test signs in through the faked Google flow with a timezone and finds it on `GET /api/me`.
- [x] `ownerZone` and `timezoneOf` are gone; no core type has `timezone: string | null`; `"no-timezone"` appears nowhere in `src/`.
- [x] `vacations()` and `lastVacation()` work for every account (the original bug): covered by the existing vacation scenarios, with no special case.
- [x] The confirm-timezone step is removed or becomes the first-run welcome, as the owner decides (prototype first if kept), and `e2e/smoke.spec.ts` matches.
- [x] `docs/behaviour.md` "Time and timezones" says an account gets its browser's timezone at sign-up and can change it in Profile, and the ticket 22 known-bug note is gone. `docs/agents/local-dev.md` describes the dev sign-in's `timezone`.
- [x] `npm run check` passes.

## Open questions for the owner

1. Remove the "Is this your timezone?" screen entirely, or keep it as a one-time welcome for new accounts (via `newUserCallbackURL`)?
2. A sign-in with no usable timezone: fall back to `UTC` (proposed), fall back to something else, or refuse the sign-in?
3. The backfill: how many production accounts have no timezone (`SELECT id, created_at FROM account WHERE timezone IS NULL`, see `docs/agents/production.md`)? Fill them with the operator's timezone (proposed), `UTC`, or a value you choose per account?
4. Ticket 21 is ready-for-agent and plans a fallback for reviewers with no timezone. Land this first and drop that rule from 21, or let 21 go first and remove its fallback here?

## Owner decisions (2026-11-11)

1. Remove the confirm-timezone screen. Profile shows the timezone and lets people change it.
2. If sign-in brings no usable timezone, or a name `Intl` does not accept, save UTC. Do not refuse.
3. The migration fills UTC into existing accounts with no timezone.
4. This ticket lands before ticket 21, which is now blocked by it.
