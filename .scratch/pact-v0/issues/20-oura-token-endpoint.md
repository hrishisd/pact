# 20 Exchange Oura codes at Oura's current token endpoint

Status: ready-for-agent
Blocked by: none

## Problem

Pact exchanges authorization codes and refresh tokens at `https://api.ouraring.com/oauth/token` (`DEFAULTS.tokenUrl` in `src/core/oura.ts`). In 2026 Oura moved its login server to `moi.ouraring.com`. Several independent projects report that apps made on Oura's new developer portal get `400 invalid_request` from the old endpoint, for both code exchange and refresh. Pact's app will be made on the new portal, so every connect would fail with "Couldn't connect to Oura". Oura's own docs still name the old endpoint.

Oura's discovery document (`https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous/.well-known/openid-configuration`, fetched 2026-11-18) gives:

- `token_endpoint`: `https://moi.ouraring.com/oauth/v2/ext/oauth-token`
- `token_endpoint_auth_methods_supported`: `client_secret_post`, `client_secret_basic`, `none`. Pact sends the client id and secret in the form body (`client_secret_post`), which stays fine.

Evidence and sources: `.scratch/pact-v0/oura-api-research.md`, section 4.

## What to build

- Change the default token URL to `https://moi.ouraring.com/oauth/v2/ext/oauth-token`.
- Keep the authorize URL (`https://cloud.ouraring.com/oauth/authorize`) and the `daily` scope. Oura's documented authorize page now sits in front of the new login server, and projects report that the short scope names work there.
- No fallback to the old endpoint. Production has no stored Oura tokens yet, and trying the wrong endpoint first spends the single-use code.
- Update the "Oura's URLs" question in ticket 08's Comments and the manual check in `.scratch/pact-v0/manual-checks.md` that says to create the app at cloud.ouraring.com: new apps are made at `developer.ouraring.com`.

## Acceptance criteria

- [x] Code exchange and refresh both POST to the new token endpoint by default, shown by a test in `src/core/oura.test.ts`.
- [x] `manual-checks.md` points at `developer.ouraring.com` for creating the app, and its connect check confirms that a real connect succeeds with the new endpoint.
- [x] `npm run check` passes.

## Comments

- 2026-11-18: Built on `claude/festive-goldberg-cvw6p4`, pending merge to `main`. `DEFAULTS.tokenUrl` in `src/core/oura.ts` is `https://moi.ouraring.com/oauth/v2/ext/oauth-token`; test: `oura.test.ts`, "exchanges codes and refresh tokens at Oura's token endpoint on its login server". The fake Oura now answers on the new path. Whether a real connect succeeds is the connect check in `manual-checks.md` (Oura Ring section).
