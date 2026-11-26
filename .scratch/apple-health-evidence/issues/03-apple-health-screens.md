# 03 Apple Health: screens

Status: ready-for-agent
Blocked by: 02

Spec: `../spec.md` stories 1, 2, 3, 5, 7, 8 and the Screens and Shortcut sections. The human skipped a prototype; screenshots go in the PR and they'll give feedback on the built screens.

## What to build

- The Apple Health tile in Create pact, and the setup step when there's no connection.
- The Apple Health setup page (its own app path): make key / upload URL with Copy, the Shortcut steps exactly as in the spec, the automations, Run Pact Health, last upload with its sleep and mindful counts.
- Profile's Apple Health connection row.
- Today's Automatic and No Apple Health data cards, with Sync now.
- The night's source where a bedtime is shown.
- Copy uses glossary words; style matches the existing screens (`src/client/styles.css`).

## Acceptance criteria

- [ ] Client tests for the tile, the setup page and the Sync now card.
- [ ] `npm run check` and `npm run test:e2e` pass.
- [ ] Screenshots of each screen at phone width.

## Comments
