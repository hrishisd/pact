# Every change to an Oura or Anki pact is refused while the source is disconnected

Status: needs-triage
Blocked by: none

## Problem

Found by the randomised test of the core (`src/core/fuzz.test.ts`). `changePact` and `changePreview` check the whole of the new terms as `createPact` does, and `evidenceSource` (`src/core/pacts.ts`) refuses with `oura-not-connected` or `anki-not-connected` when the owner has no connection. So while an owner's Oura Ring or AnkiWeb connection is gone, they cannot make any change to that pact through `changePact`: not a higher penalty, not another recipient, not fewer days. The change asked for has nothing to do with the connection.

This may be intended (reconnect first), and the refusal does tell the owner what to do. It is recorded because no rule in `docs/behaviour.md` states it, and because a pact whose source is disconnected is the one an owner most likely wants to change.

Not checked: which of the pact page's sheets go through `changePact`, so which the owner actually meets; whether an end request (`requestEnd`) is affected (it should not be).

## What to build

Decide one of:

- Keep it, and state it in `docs/behaviour.md`.
- Check the connection only when the change touches what the source provides (the evidence kind or the Anki deck).

## Acceptance criteria

- [ ] `docs/behaviour.md` says what an owner can change while the source is disconnected.
- [ ] If the rule changes: a scenario test covers a change with the source disconnected, and the allowance for these two refusals is removed from the `current-terms-are-valid` invariant in `src/core/testing/fuzz-invariants.ts`.
- [ ] `npm run check` passes.
