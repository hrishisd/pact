# 02 Workflow document edits for the owner to approve

Status: needs-info
Blocked by: 01

Closes: W3, W5, T2, and W1's status check (`../code-structure-review.md`, section 4).

## Decision needed

Decision 7 in `../spec.md`: the owner approves, edits or rejects each block of text below. Once approved, apply it exactly. `CLAUDE.md` is the owner's file, so no session changes it without this approval.

## Problem

- W3: `CLAUDE.md` does not mention `CODING_STANDARDS.md`, the layer split or `npm run check`, and `CODING_STANDARDS.md:3` says it is "Read at review time". Its most important rule, "A rule decided in a route or a component is a finding" (`CODING_STANDARDS.md:7`), reaches a session only after the code is written. C1 and C2 are the kind of thing it exists to stop.
- W5: `docs/agents/domain.md` describes `GLOSSARY-MAP.md`, multi-context layouts and skills that do not exist here; `docs/agents/issue-tracker.md:26-39` specifies `/wayfinder` map files no feature uses; `docs/agents/triage-labels.md` is an identity table ending "Edit the column to match"; `docs/agents/prototype-first.md:13` names `/grill-with-docs`, while the installed skill is `grilling`; the `domain-modeling` skill writes a `CONTEXT.md`, while this repo uses `GLOSSARY.md` and the lint reads only that (`scripts/check-conventions.ts:35`); `docs/agents/local-dev.md` assumes `fnm` and an iCloud folder.
- T2: server tests re-walk domain flows the core tests own (`src/server/app.test.ts:1373-1450`, `1281-1334`, `1519-1555`, `1591-1630`).
- W1: nothing checks that a `Status:` line uses a known value.

## Proposed text

### `CLAUDE.md`: add after "# pact"

```markdown
## Before writing code

- Layers: `src/core` decides every domain rule behind `AccountView` (`src/core/core.ts`); `src/server` translates HTTP to core calls; `src/client` renders what the core returns; `src/shared` holds the wire types and paths both sides import.
- Read `CODING_STANDARDS.md` before writing code.
- Read `docs/behaviour.md` for how the app behaves now. The feature specs under `.scratch/` record designs as they were decided.
- Run `npm run check` before calling work done.
```

### `CODING_STANDARDS.md`

Line 3, replace "Read at review time." with "Read before writing code and at review time."

Under "## Tests", add:

```markdown
- Server tests check route wiring: one test per route for a shape refused with 400, a refusal returned as 200, and one success through to the core, using `objectContaining` on core output. Domain flows are tested in the core.
```

### `docs/agents/domain.md`: replace the whole file

```markdown
# Domain docs

- Read `GLOSSARY.md` before naming anything. Add a new term there, never in a `CONTEXT.md` or a second glossary: the lint reads only `GLOSSARY.md`.
- Architecture decisions are in `docs/adr/`. Add one when a decision is hard to reverse.
```

### `docs/agents/triage-labels.md`: replace the whole file

```markdown
# Status values

A ticket's `Status:` line uses one of these. `scripts/check-conventions.ts` refuses any other.

- `needs-triage`: the maintainer needs to evaluate it.
- `needs-info`: waiting on the owner for a decision or information.
- `ready-for-agent`: fully specified; an agent can build it.
- `ready-for-human`: needs the human to do it.
- `done`: every acceptance criterion is checked and the work is on `main`. Checks only the human can do are in the feature's `manual-checks.md`.
- `wontfix`: will not be done.

Skills that speak of `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` and `wontfix` mean these values.
```

### `docs/agents/issue-tracker.md`

Delete the "## Wayfinding operations" section (lines 26-39).

### `docs/agents/prototype-first.md`

Line 13: replace `/grill-with-docs` with the `grilling` skill.

### `docs/agents/local-dev.md`

Add under its first heading: "The `fnm` and iCloud notes apply to the owner's Mac. A cloud session has Node on its path and the repo checked out locally."

## What to build once approved

- Apply the approved text.
- Add a check to `scripts/check-conventions.ts`: every `Status:` line in `.scratch/**/*.md` is one of the values above (W1). A spec's `Status:` line counts too.

## Where to start

- `CLAUDE.md`, `CODING_STANDARDS.md:3`, `docs/agents/*.md`.
- `scripts/check-conventions.ts:1-80` for how existing checks read files and report.

## Acceptance criteria

- [ ] The approved text is applied, word for word.
- [ ] `scripts/check-conventions.ts` refuses an unknown `Status:` value; shown by temporarily writing one and running `npm run lint`, then removing it.
- [ ] `npm run check` passes.

## Out of scope

- Changes to skills installed outside the repo.
- Rewriting existing server tests (T2 says not to).
