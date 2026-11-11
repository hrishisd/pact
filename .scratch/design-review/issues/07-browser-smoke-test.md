# 07 Browser smoke test and an ExcuseSheet test

Status: ready-for-agent
Blocked by: 01

Closes: T1 (`../code-structure-review.md`, section 3).

## Problem

Nothing checks that a whole flow works in a browser. Client component tests exist for seven screens; `ExcuseSheet.tsx` (606 lines, shows held money and decides which preview day is the opened one), `RecordPayment.tsx`, `Ledgers.tsx`, the four item pages and the navigation wiring in `App.tsx:229-480` have none. A regression in a flow that crosses screens (file an excuse from a Missed card, see it under Waiting, open it) is found by the owner. The structure tickets that follow (08 to 21) move a lot of code; this test is their safety net.

## What to build

- One Playwright smoke test, using the Playwright already installed on the machine (`/opt/node22/bin/playwright`; check its version and browsers with `playwright --version` and install a matching `@playwright/test` as a dev dependency). It starts the dev server (`docs/agents/local-dev.md`) on a fresh database, signs in two accounts through `/api/dev/sign-in`, and walks: the owner invites the reviewer and they become friends; the owner creates a Camera pact; the owner submits evidence; the reviewer approves it; a day is Missed; the owner files an excuse from the Missed card, sees it under Waiting for approval and opens it; the reviewer rejects it; the owner records a payment.
- Time: the server runs on the real clock and has no dev hook to move it, while the flow needs the 10-minute edit window to pass (evidence is reviewable only after it, `src/core/review.ts:177-190`) and a day to fall due. Add a dev-only clock control: the server reads its `Clock` port from a controllable clock when an environment variable such as `PACT_DEV_CLOCK=1` is set, and registers `POST /api/dev/advance` (which runs the scheduler tick up to the new time) only then, beside the dev sign-in route (`src/server/auth.ts:134`, `src/shared/api.ts:88`). Production must refuse to start with it set. Say in Comments how this was done.
- Assert on what a user sees (text and roles), not on CSS classes.
- An `npm run test:e2e` script. Add it to CI after `build` only if it runs in under two minutes there; otherwise say so in Comments and leave it local.
- `ExcuseSheet.test.tsx`: opened on a Missed day (that day is the opened one, its held amount shows), and opened on a Weekly count week.

## Where to start

- `docs/agents/local-dev.md` for the dev server and dev sign-in.
- `src/server/main.ts:15-77`, where the server wires `systemClock` into the core and adapters.
- `src/client/App.tsx:229-480` for the navigation callbacks the flow crosses.
- `src/client/testing/render.tsx` for the component test helpers.

## Acceptance criteria

- [ ] `npm run test:e2e` passes locally and is documented in `docs/agents/local-dev.md`.
- [ ] Shown to fail: temporarily break one navigation callback in `App.tsx` that the flow uses, see the test fail, revert.
- [ ] `ExcuseSheet.test.tsx` covers the two cases above.
- [ ] `npm run check` passes.

## Out of scope

- Visual comparison of screenshots.
- More than one flow.
