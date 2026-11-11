# Hide Request change while an approved end waits

Status: ready-for-agent
Blocked by: none

## What to build

Ticket 27 hid "End pact" on the pact page while an approved end waits, and made the core refuse every change except the name, reminders and added reviewers. "Request change" still shows, and opens a form that refuses most edits. Hide "Request change" too while `pact.ending` is set. Leave the core's refusals as they are.

## Acceptance criteria

- [ ] The pact page shows neither "End pact" nor "Request change" while an approved end waits, and shows both otherwise.
- [ ] A client test covers both states.
- [ ] `docs/behaviour.md` says the owner can't open the change form while an end waits.

## Comments

Owner decision (2026-11-11): hide the button. Turning off reminders during the last few days is the one edit lost, and that cost is small. Runs right after ticket 15.
