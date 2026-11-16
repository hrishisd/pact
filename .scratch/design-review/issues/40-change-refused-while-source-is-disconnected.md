# Every change to an Oura or Anki pact is refused while the source is disconnected

Status: done
Blocked by: none

## Decision

An owner may change an Oura Ring or Anki pact while its connection is gone, when the change does not need the connection (the recommended answer). The connection is needed to create a pact and to give an Anki pact another deck.

## Problem

Found by the randomised test of the core (`src/core/fuzz.test.ts`). `changePact` and `changePreview` check the whole of the new terms as `createPact` does, and `evidenceSource` (`src/core/pacts.ts`) refuses with `oura-not-connected` or `anki-not-connected` when the owner has no connection. So while an owner's Oura Ring or AnkiWeb connection is gone, they cannot make any change to that pact through `changePact`: not a higher penalty, not another recipient, not fewer days. The change asked for has nothing to do with the connection.

This may be intended (reconnect first), and the refusal does tell the owner what to do. It is recorded because no rule in `docs/behaviour.md` states it, and because a pact whose source is disconnected is the one an owner most likely wants to change.

Not checked: which of the pact page's sheets go through `changePact`, so which the owner actually meets; whether an end request (`requestEnd`) is affected (it should not be).

## What the code does

Checked since this ticket was filed.

- The refusal comes only when the owner disconnected the service. `hasConnection` (`src/core/rows.ts`) asks whether a connection exists; one that Needs reconnecting still exists, so a change goes through then.
- Only the Request change form meets it: `changePact` and `changePreview` call `checkedPact` (`src/core/pacts.ts`), which calls `evidenceSource`. The pact page's Name, Add a reviewer and Reminders sheets (`renamePact`, `addReviewers`, `setReminders`) and `requestEnd` do not check the connection.
- `editPact`, in the edit window, goes through `checkedPact` too.

## What to build

Rule: the connection is needed to create a pact, and to give an Anki pact another deck. Every other change to an existing pact goes through without it.

- In `evidenceSource`, when `existing` is given (an edit or a change):
  - Oura Ring: no connection check.
  - Anki with the deck it has, and a stored rollover hour: no connection check. This is the `ownDeck` case, which already needs no deck list.
  - Anki with another deck: as now, `anki-not-connected` without a connection, `unknown-deck` when the deck is not in the list.
- `createPact` is unchanged.
- This opens no way out of a pact. What needs approval is unchanged (`termDiffs`, `src/core/changes.ts`), and a pact whose source is disconnected still has its days judged Missed.
- Check that the Request change form (`src/client/ChangePact.tsx`) loads and sends for an Anki pact with AnkiWeb disconnected: it must send the pact's own deck without the deck list. Fix it if it does not.
- No stored data changes and there is no migration.

`docs/behaviour.md`, Change requests, gains: "A change needs the Oura or AnkiWeb connection only to give an Anki pact another deck; with the connection gone, every other change is taken as usual (`evidenceSource`, `pacts.ts`)."

## The alternative

Keep the refusal and state it in `docs/behaviour.md`. It costs nothing to build. It is not recommended: the refusal blocks stricter changes too (a higher penalty, more days), the owner can already get round it for an end request, and "Connect your Oura Ring first" is a strange answer to a change of recipient.

## Tests to write first

- `src/core/change-requests.test.ts`: with Oura disconnected, a higher penalty on an Oura Ring pact applies and a later in-bed-by time waits for approval; with AnkiWeb disconnected, fewer days on an Anki pact waits for approval, and another deck is refused with `anki-not-connected`.
- `src/core/edit-window.test.ts`: an edit to an Oura Ring pact in its edit window, after disconnecting, is taken.
- Remove `oura-not-connected` and `anki-not-connected` from the refusals the `current-terms-are-valid` invariant allows (`src/core/testing/fuzz-invariants.ts`), and see the fixed seeds pass.

## Prototype

Not needed. A refusal goes away; no screen or words are new.

## Acceptance criteria

- [x] `docs/behaviour.md` says what an owner can change while the source is disconnected.
- [x] The scenarios above pass, and the allowance for the two refusals is gone from the `current-terms-are-valid` invariant.
- [x] The Request change form works for an Anki pact with AnkiWeb disconnected.
- [x] `npm run check` passes.

## Outcome

Built as planned. `evidenceSource` (`pacts.ts`) checks the connection only when there is no `existing` pact (creating), or when an Anki pact is given a deck other than its own; an Anki pact's own deck with its stored rollover hour is taken first, with no connection or deck list. `editPact` and `changePact`/`changePreview` go through it, so both follow the rule. The `current-terms-are-valid` invariant no longer allows `oura-not-connected` and `anki-not-connected`.

- The Request change form already worked for an Anki pact with AnkiWeb disconnected: it loads no deck list until the Goal sheet is opened, and sends the pact's own deck. A client test now holds it (`ChangePact.test.tsx`, "an Anki pact with AnkiWeb disconnected loads and sends its own deck").
- Tests: `change-requests.test.ts`, "a change with the Oura or AnkiWeb connection gone"; `edit-window.test.ts`, "an Oura Ring pact is edited with Oura disconnected".
- `npm run check` was run in its parts (shellcheck isn't installed where this was built, so its lint step wasn't run): `tsc`, Prettier, knip, `check-conventions.ts`, the tests and the build.
