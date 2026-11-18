# 21 Tell a refused grant from a broken Oura app

Status: ready-for-agent
Blocked by: 20

## Problem

`#tokenRequest` in `src/core/oura.ts` treats every 400 and 401 from Oura's token endpoint as "Oura refused this account's grant". For a refresh, the account then reads as Needs reconnecting.

Oura also answers 400 or 401 when Pact's own app credentials are wrong: `invalid_client` comes back as 400 on the old endpoint and as 401 on the new one (probes in `.scratch/pact-v0/oura-api-research.md`, section 4). So a mistyped or rotated `OURA_CLIENT_SECRET` would quietly mark every account Needs reconnecting at its next refresh. Each owner would be told to reconnect, reconnecting would fail too, and nothing would tell the operator the real cause.

OAuth error bodies carry an `error` field (RFC 6749 section 5.2). Only `invalid_grant` means this account's code or refresh token is no good. The others (`invalid_client`, `unauthorized_client`, `invalid_request`, `unsupported_grant_type`, `invalid_scope`) mean Pact or its app setup is wrong, and the account's refresh token was not spent.

## What to build

- In `#tokenRequest`, read the error body. Only `invalid_grant` is a refused grant (the current `null`). Any other 400 or 401, including one with no readable `error`, is a problem with Pact's app: raise an operator alert that names the `error` value and says to check the Oura app's credentials, and treat it like a failed request (throw), so the account keeps its tokens and is tried again next tick.
- A refresh that fails this way did not spend the refresh token, so it must not mark `refresh_outcome_unknown_at`. That mark stays for timeouts, network errors and 5xx answers.
- Don't send the same alert every tick. Alert once until a token request succeeds again, in the way `anki.ts` handles AnkiWeb protocol errors (`#protocolErrorEmailed`).
- On connect, a problem with Pact's app still shows the owner the existing "failed" result, and also raises the alert.
- Update the Oura Ring section of `docs/behaviour.md` and the operator alerts list there.

## Acceptance criteria

- [x] A refresh refused with `invalid_grant` marks the account Needs reconnecting, as today.
- [x] A refresh refused with `invalid_client` (as 400, and as 401) leaves the account connected, keeps its tokens, raises one operator alert, and doesn't mark the refresh outcome unknown. A later successful refresh works normally.
- [x] A connect refused with `invalid_client` shows the owner "failed" and raises the operator alert.
- [x] Tests in `src/core/oura.test.ts`, written first and seen failing.
- [x] `docs/behaviour.md` updated.
- [x] `npm run check` passes.

## Comments

- 2026-11-18: Built on `claude/festive-goldberg-cvw6p4`, pending merge to `main`. `#tokenRequest` in `src/core/oura.ts` reads the answer's `error` (`oauthErrorOf`); anything but `invalid_grant` on a 400 or 401 raises the "Oura refused Pact's app" operator alert and throws an `AppRefused`, which `#refresh` doesn't mark as maybe spent. A connect refused that way throws, which the server already turns into the failed result. Tests: `oura.test.ts`, "a refresh Oura refuses for Pact's app (invalid_client, HTTP 400/401)" and "a connect Oura refuses for Pact's app, not the code". `invalid_grant` keeps the existing tests ("a refused refresh token, or a 403").
- As in `anki.ts`, every refusal writes the `OPERATOR_ALERT` log line, and only the first is emailed. Unlike AnkiWeb's, the flag is one for the whole app (`#appRefusalEmailed`), not per account, since a broken app setup refuses every account; any successful token request clears it.
- 2026-11-18: Review follow-ups: an `invalid_grant` also clears `#appRefusalEmailed` (Oura accepted the app's credentials); a 400 with a non-JSON body is tested as Pact's app refused; the alert now says to check the token URL too (`invalid_request` usually means the wrong endpoint).
