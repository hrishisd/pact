# 22 Name Pact in every request to Oura

Status: ready-for-agent
Blocked by: 21

## Problem

Oura asks API clients to send a `User-Agent` header that names the app (`.scratch/pact-v0/oura-api-research.md`). Pact sets none, so Node's `fetch` sends `node`. Oura's troubleshooting notes list a missing or generic User-Agent among the causes of a 403, and Pact reads a 403 from the sleep endpoint as a lapsed membership, which disconnects the account.

## What to build

- Send `User-Agent: Pact (+<the server's URL>)` on every request the Oura adapter makes: code exchange, refresh and sleep. The server's URL is `config.auth.url`; pass it in from `src/server/main.ts` as part of the adapter's options or `OuraClient`, rather than hard-coding a domain in the core.
- The dev stand-in (`devOura`) needs no change.

## Acceptance criteria

- [x] A test in `src/core/oura.test.ts` shows the header on token and sleep requests.
- [x] `npm run check` passes.

## Comments

- 2026-11-18: Built on `claude/festive-goldberg-cvw6p4`, pending merge to `main`. `OuraClient` has an `appUrl`, which `src/server/main.ts` sets to `config.auth.url`; `#userAgent` in `src/core/oura.ts` sends `Pact (+<appUrl>)` on the code exchange, refresh and sleep requests. Test: `oura.test.ts`, "every request names Pact and its address in the User-Agent". `devOura` is unchanged.
