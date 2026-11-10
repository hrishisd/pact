# 03 Session coverage test built from `API_PATHS`

Status: ready-for-agent
Blocked by: 01

Closes: S1 (`../code-structure-review.md`, section 2).

## Problem

Whether an API route needs a session depends only on whether it is registered after the authentication middleware at `src/server/app.ts:366-377`. The invite lookup (`app.ts:356`) and the auth handler are deliberately above it. The test that guards this, "every API route needs a session" (`src/server/app.test.ts:1925-1962`), is a hand-kept list of 11 read paths and 11 write paths. It misses excuses, excuse previews and options, vacations, change requests, ledgers, notifications, push subscriptions and the Oura and Anki routes. A route added above line 366, or a reordering of the middleware, would make it public and the test would still pass.

## What to build

- Rewrite the test to enumerate every entry of `API_PATHS` (`src/shared/api.ts:143`), calling each function form with placeholder ids, minus a short explicit list of public paths with a one-line reason each (the invite lookup, the auth handler, the Oura callback if it is public).
- For every method the app registers on each path, assert 401 with `{ error: "unauthenticated" }`. Read the registered methods from the Hono app's routes, so a new method on an existing path is covered without editing the test.
- A new entry in `API_PATHS` is then covered automatically. A public one must be added to the explicit list on purpose.

## Where to start

- `src/server/app.test.ts:1925-1962`, the current test.
- `src/shared/api.ts:143-240`, `API_PATHS`.
- `src/server/app.ts:350-377`, the public routes and the middleware.

## Acceptance criteria

- [ ] "every API route needs a session" enumerates `API_PATHS` and the registered methods, with the public exceptions listed and explained.
- [ ] Shown to fail: temporarily register one of the vacation routes above the middleware, see the test fail, and revert.
- [ ] `npm run check` passes.

## Out of scope

- Any change to which routes are public.
