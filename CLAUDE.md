# pact

## Before writing code

- Layers: `src/core` decides every domain rule behind `AccountView` (`src/core/core.ts`); `src/server` translates HTTP to core calls; `src/client` renders what the core returns; `src/shared` holds the wire types and paths both sides import.
- Read `CODING_STANDARDS.md` before writing code.
- Read `DESIGN.md` before any UI change: tokens, type, mobile rules, icons and components.
- Read `docs/behaviour.md` for how the app behaves now. The feature specs under `.scratch/` record designs as they were decided.
- Run `npm run check` before calling work done.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as `Status:` lines in issue files. See `docs/agents/triage-labels.md`.

### Production

Debugging production (logs, health, the machine): see `docs/agents/production.md`.

### Local development

Running the app locally, signing in without Google, dev logs, resetting the dev database: see `docs/agents/local-dev.md`.

### User-facing changes

Before building a change the human will see or feel (screens, copy, behaviour), ask whether to prototype first; prototyping is the default. See `docs/agents/prototype-first.md`.

To show the human what a screen looks like, send screenshots in the chat. Don't ask them to open a page or a prototype themselves unless they need to interact with it.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
