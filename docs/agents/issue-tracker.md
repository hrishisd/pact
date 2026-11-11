# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## Manual checks

Checks an agent can't do (a signed-in `flyctl`, a real Oura Ring, a phone, real push notifications) go in `.scratch/<feature-slug>/manual-checks.md` as a checklist, not only in a ticket's Comments. When work leaves something for the human to try by hand, add it there and link it from the ticket.

## Closing a ticket

- A finished ticket gets `Status: done` once every acceptance criterion is checked and the work is on `main`
- A ticket is unblocked when every ticket in its `Blocked by:` line is `done`
- A ticket that adds or changes a rule updates `docs/behaviour.md` in the same change, including removing any known-bug note it fixes.

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.
