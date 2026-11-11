# 07 Browser smoke test and an ExcuseSheet test

Status: done
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

- [x] `npm run test:e2e` passes locally and is documented in `docs/agents/local-dev.md`.
- [x] Shown to fail: temporarily break one navigation callback in `App.tsx` that the flow uses, see the test fail, revert.
- [x] `ExcuseSheet.test.tsx` covers the two cases above.
- [x] `npm run check` passes.

## Out of scope

- Visual comparison of screenshots.
- More than one flow.

## Comments

2026-11-11 (agent): Built.

- Dev clock: `loadConfig` reads `PACT_DEV_CLOCK=1` into `config.devClock` and throws in production when the variable is set at all. `main.ts` then wires `offsetClock()` (`src/core/adapters.ts`: the system clock plus an offset that only grows) into the core, the adapters and the scheduler in place of `systemClock`; the log file keeps real time. `createApp` takes it as `devClock` and, outside production and only then, registers `POST /api/dev/advance` (`DEV_ADVANCE_PATH` in `src/shared/api.ts`, beside `DEV_SIGN_IN_PATH`): `{ minutes }` moves the clock forward, awaits `core.advanceTo(now)` and answers `{ now }`. It answers only to this machine, as the dev sign-in does. Tests: `config.test.ts` "dev clock", `app.test.ts` "dev clock".
- The smoke test (`e2e/smoke.spec.ts`, `playwright.config.ts`) doesn't use `npm run dev`: it builds the client and runs `npm start` (development mode, serving `dist/client`) on port 3100 with a fresh database under the system temp directory, so it never collides with a dev server on 3000/5173 or touches the dev database. Each browser's clock is moved with the server's (`page.clock`), since the client reads `Date.now()` for headings and countdowns. It first moves to 9am New York so the pact's first day is today whatever time it runs. `@playwright/test` is pinned to 1.63.0, the machine's Playwright.
- Shown to fail: with `openExcuse` in `App.tsx` made a no-op, the step "files an excuse … and opens it" failed waiting for the Excuse page heading; reverted. `ExcuseSheet.test.tsx`'s Weekly count case fails when `DayCard`'s `holds` ignores the week; reverted.
- CI: not added. The run takes about 8 seconds locally, but in CI it would also need a Chromium download (`npx playwright install --with-deps chromium`), and I couldn't time that without pushing. It stays local (`npm run test:e2e`); adding it after `build` is a one-step change once someone times it there.
