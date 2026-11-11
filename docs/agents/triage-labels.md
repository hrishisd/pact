# Status values

A ticket's `Status:` line uses one of these. `scripts/check-conventions.ts` refuses any other.

- `needs-triage`: the maintainer needs to evaluate it.
- `needs-info`: waiting on the owner for a decision or information.
- `ready-for-agent`: fully specified; an agent can build it.
- `ready-for-human`: needs the human to do it.
- `done`: every acceptance criterion is checked and the work is on `main`. Checks only the human can do are in the feature's `manual-checks.md`.
- `wontfix`: will not be done.

Skills that speak of `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` and `wontfix` mean these values.
