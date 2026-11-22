# 01 A check now says when it couldn't reach the service

Status: done
Blocked by: none

Spec: `../spec.md`, "A check that can't reach the service".

## What to build

`checkOura` and `checkAnki` (`AccountView`, `core.ts`) answer whether the check couldn't reach Oura or AnkiWeb, and `POST /api/oura/check` and `POST /api/anki/check` pass that on: `{ ok: true }`, or `{ ok: false, reason: "unreachable" }` when the call to the service failed (a timeout, a network failure, a 5xx, the Anki check script failing).

- A check with nothing to check (nothing waiting, or a connection that needs reconnecting) answers `{ ok: true }`. A check skipped within 15 seconds of the last answers what that one found, so a quick second pull can't clear the "Couldn't reach" line (found while building ticket 03).
- A refused login answers `{ ok: true }`: it marks the connection Needs reconnecting, and Today's alert says so.
- A failure Pact has already raised as an operator alert answers `{ ok: true }`: an AnkiWeb protocol error, or Oura refusing Pact's app at its token endpoint. The adapters mark these so the core can tell.
- The scheduler's tick is unchanged: a failed call is logged and tried again next tick.

## Acceptance criteria

- [x] A check now whose call to Oura or AnkiWeb throws answers unreachable; one that succeeds, is skipped or finds a refused login answers ok (`oura-no-data.test.ts`, `anki-days.test.ts`).
- [x] A protocol error or Oura refusing Pact's app answers ok (the adapters in `anki.test.ts`, `oura.test.ts`; the answer in `anki-days.test.ts`, `oura-no-data.test.ts`).
- [x] Each route passes the core's answer through (`app.test.ts`).
- [x] `docs/behaviour.md` says what a check now answers.

## Comments

### 2026-11-22: built

Built on branch `claude/dazzling-noether-u1w82i`, with the other pull to refresh tickets, for one pull request. Status stays until it is on `main`.
