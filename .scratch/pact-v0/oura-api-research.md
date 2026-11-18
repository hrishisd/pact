# Oura API research: will Pact work for many users?

Researched 2026-11-18 from public sources and a few credential-free probes. Nothing here was checked with a real ring or a real Oura account.

Source labels used below:
- **[Oura]** Oura's own pages: the OpenAPI spec, cloud.ouraring.com docs, support.ouraring.com, partnersupport.ouraring.com, the API agreement.
- **[Probe]** a request I sent myself, with fake or no credentials, on 2026-11-18.
- **[Community]** GitHub issues and PRs, forums, third-party docs. Real-world reports, not promises.

## Summary

What will work:
- One Oura API application can serve many Pact accounts. Each user does their own OAuth consent. This is the model Oura documents.
- The authorize URL `https://cloud.ouraring.com/oauth/authorize`, scope `daily`, client credentials in the form body, and reading `expires_in` all match the docs.
- The `sleep` collection has what Pact needs: `bedtime_start` with a UTC offset, `type`, `day`, and `next_token` paging.
- Asking for `start_date = night`, `end_date = night + 2` covers the night whatever `end_date` means. In practice `end_date` is exclusive and the filter is on the date of `bedtime_start`.

What will not work, or will break first:
1. **The token URL is probably wrong for a new app.** Oura moved its login server to `moi.ouraring.com` in 2026. Several projects report that apps made on the new developer portal get `400 invalid_request` from `api.ouraring.com/oauth/token`, the URL Pact uses. They now use `https://moi.ouraring.com/oauth/v2/ext/oauth-token`. Oura's own docs still name the old URL. [Community, several independent reports, Sep–Nov 2026] Pact would show every connect as failed. _Fixed 2026-11-18 by ticket 20._
2. **10 users, then approval.** An unapproved app is capped at 10 users. Approval needs a privacy policy and terms of service, and at least one active user. Pact has no privacy policy. No source gives a review time.
3. **Membership.** Owners of Gen3, Ring 4 (including Ceramic) and later rings get no API data without an active Oura Membership. Only Gen2 is exempt. Pact treats the 403 as "Needs reconnecting". Reconnecting can't fix a lapsed membership.
4. **Sleep arrives only after the owner opens the Oura app.** Oura says so plainly. The 3pm push is the right fix. Data can also change after it first appears.
5. **Polling cost.** Pact asks Oura once a minute for every account with a night waiting, from 18:00 until the sleep arrives, about 840 calls per user per night. Oura's stated limit is 5000 requests per 5 minutes. That allows about 1000 waiting accounts per app. Oura strongly recommends webhooks and reserves the right to block apps that overburden it.
6. **API terms (effective 2026-06-08)** require prior express consent before anyone other than the user sees their data (Pact shows reviewers the bedtime), a privacy policy, and deleting a user's data within 72 hours on request.

## 1. Multi-user limits, approval, rate limits

**User cap.** "API Applications are limited to **10** users before requiring approval from Oura. There is no limit once an application is approved." [Oura, OpenAPI 1.43 description, https://cloud.ouraring.com/v2/static/json/openapi-1.43.json, linked from https://cloud.ouraring.com/v2/docs]. Also: "By default, API Applications have a ten user limit. If you want to release your application to a wider audience, your application needs to be approved. Once you have finished developing your application, you can submit it for review from the application's page." [Oura, https://cloud.ouraring.com/docs]. The FAQ adds: "the Oura API is free to use for both personal and commercial applications. However, API applications accessing more than 10 users require approval from Oura." [Oura, OpenAPI 1.43]

**Where apps are made.** "You can use the Oura API by creating an application in our newest developer portal. Our previous developer portal is still accessible to edit existing applications." The new portal is https://developer.ouraring.com/, the old one https://cloud.ouraring.com/oauth/applications. [Oura, https://support.ouraring.com/hc/en-us/articles/4415266939155-The-Oura-API, updated 2026-10-01]

**What approval needs.** Oura publishes no criteria. A third-party guide says the app form needs "Display Name, Description, Contact Email, Website, Privacy Policy, and Terms of Service" (URLs for the last two), that you use "Request more users" on the app page, and that "Oura requires at least one active user before they'll approve the request." [Community, https://www.sahha.ai/docs/connect/integrations/oura]. The API agreement requires "a conspicuous privacy policy" that "accurately explain[s] how you collect, store, use, disclose, share, retain, and delete User Data" (section 5(c)). [Oura, https://cloud.ouraring.com/legal/api-agreement]

**How long approval takes.** Unknown. The only data point I found: intervals.icu wrote "I am still waiting for app approval from them. Its max 10 users until that happens" on 2021-07-03 and "the app was approved" on 2021-07-13. [Community, https://forum.intervals.icu/t/oura-ring-intervals-icu-integration/3567]. Many search hits about months-long waits are about WHOOP, not Oura.

**Who counts as a user.** Unknown: whether the cap counts current grants, or every user who ever connected. Pact's disconnect does not revoke at Oura, so a disconnected user may still hold a slot.

**What the 11th user sees.** Unknown.

**Rate limits.** "The API enforces rate limits at two layers ... a per-access-token limit ... and a per-application limit, which caps the aggregate traffic across all of an application's end-user tokens ... A request that trips either layer receives a `429 Too Many Requests`. The `X-RateLimit-Tier` response header identifies which layer fired." On a 429 Oura sends `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Window`, `X-RateLimit-Reset`, `X-RateLimit-Tier`. [Oura, OpenAPI 1.43]. The FAQ in the same spec: "The Oura API is limited to 5000 requests per 5-minute period." The error page: "rate limited to 5000 requests in a 5 minute period. You will receive a 429 error code if you exceed this limit." [Oura, https://cloud.ouraring.com/docs/error-handling]. The per-token number is not published. Approval lifts the user cap; nothing says it lifts rate limits.

**Sandbox shares the limit.** "The rate limit for the sandbox endpoints is shared with your rate limit on other data endpoints." [Oura, OpenAPI 1.43]

## 2. Membership

- "Gen3 and later users without active Oura Membership can't access their data through the Oura API. Partner applications that are integrated with the Oura API do not have access to the data of Gen3 and later users who do not have active Oura Membership." [Oura, https://support.ouraring.com/hc/en-us/articles/4415266939155-The-Oura-API, updated 2026-10-01]
- "Oura Ring Generation 2 users will not experience any changes to the availability of their data through the Oura API." [Oura, https://partnersupport.ouraring.com/hc/en-us/articles/20949682312211, updated 2026-10-05]
- So: Gen2 free. Gen3, Ring 4, Ring 4 Ceramic and Ring 5 need a membership. The spec's ring hardware list is `gen1, gen2, gen2m, gen3, gen4, or5`. [Oura, OpenAPI 1.43, `PublicRingHardwareType`]
- What the API returns: the sleep route documents "403: Access forbidden. Usually means the user's subscription to Oura has expired and their data is not available via the API." [Oura, OpenAPI 1.43]. The response code table: "403 Forbidden | The requested resource requires additional permissions or the user's Oura subscription has expired." I found no report of a 200 with empty data instead.
- Whether a non-member can still finish the OAuth consent is unknown. If they can, Pact will connect them and then get 403 on the first call.
- **Pact's handling.** 403 to "disconnected" is the right status code. But 403 has three documented causes: lapsed membership, a missing scope, and a missing User-Agent. Pact calls all three "Needs reconnecting". Reconnecting fixes only the scope case.

## 3. Scopes

- Documented scopes: `email, personal, daily, heartrate, workout, tag, session, spo2`, plus `heart_health` in the spec. "`daily`: Daily summaries of sleep, activity and readiness." [Oura, https://cloud.ouraring.com/docs/authentication and OpenAPI 1.43 `securitySchemes`]
- The spec does not name a scope per endpoint. No source says `/v2/usercollection/sleep` needs more than `daily`. One project notes that "sleep" is not an Oura v2 scope. [Community, https://github.com/ferni-ai/voiceai/pull/3102]. Behind the new login server the scopes are named `extapi:daily` and so on, and there is also an undocumented `extapi:stress`. [Probe, https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous/.well-known/openid-configuration]. Projects that send the short names (`daily`, `spo2`, `stress`) to cloud.ouraring.com report that they work. [Community, https://github.com/MBombeck/HealthLog/issues/1204]
- Format: "Space-separated list of permissions (scopes) your application requests access to ... If left blank, the application will request all available scopes." [Oura, authentication page]
- Unticking: "When an Oura user authorizes access to your application, she can enable and disable scopes based on her preferences." [Oura, authentication page]. The scope in the redirect "is deprecated and may be omitted from the redirect; applications should not rely on it." [same]
- What happens without the scope: the docs say 403 ("Missing Scope Permission", OpenAPI 1.43 troubleshooting). One project saw 401 instead, with a body naming the scope: "Token is not authorized access stress scope." [Community, HealthLog #1204, Oct 2026]. With a 401, Pact spends a refresh, retries, gets 401 again, and marks the connection Needs reconnecting. The end state is right, but Pact never tells the owner they unticked sleep.
- The app itself must have the scope turned on: "Requested scopes must be a subset of the scopes enabled on the app." [Community, https://openwearables.io/docs/providers/oura-api-integration]

## 4. OAuth details

**URLs.**
- Docs: "Authorize: https://cloud.ouraring.com/oauth/authorize. Access Token URL: https://api.ouraring.com/oauth/token". There is also a new alternative: "An alternative authorization URL is now provided at https://developer.ouraring.com/authorize for new OAuth clients. On supported mobile devices with the Oura app installed, this link can open the OAuth consent page within the app." [Oura, authentication page]
- The login server moved. Oura's OIDC discovery document at `https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous/.well-known/openid-configuration` gives issuer `https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous`, `token_endpoint` `https://moi.ouraring.com/oauth/v2/ext/oauth-token`, `revocation_endpoint` `https://moi.ouraring.com/oauth/v2/ext/oauth-revoke`, `code_challenge_methods_supported` `S256, plain`, and `token_endpoint_auth_methods_supported` `client_secret_post, client_secret_basic, none`. [Probe]. `https://developer.ouraring.com/authorize` redirects to `cloud.ouraring.com/oauth/authorize?prompt=consent&acr_values=urn:se:curity:...`, so cloud.ouraring.com now sits in front of a Curity server. [Probe]
- Real-world reports:
  - "Oura had moved its authorization server. Apps from the new developer portal get codes from moi.ouraring.com, and the old endpoint rejects them with 400 invalid_request." The fix was to exchange codes at `moi.ouraring.com/oauth/v2/ext/oauth-token`. [Community, https://github.com/MBombeck/HealthLog/issues/1204, 2026-10-11]
  - "every token refresh failed with 400 invalid_request" from 2026-10-09; fixed by using the moi endpoint "from the issuer's discovery document". [Community, https://github.com/IvanFox/oura-reader/pull/4]
  - Home Assistant integration: "moi.ouraring.com is the endpoint Oura's infrastructure actually uses today for both new- and legacy-portal apps" and "cloud.ouraring.com's published documentation is stale on this point". [Community, https://github.com/louispires/Oura-Home-Assistant-Integration/pull/76 and release v2.10.0, 2026-09-21]
  - Trying the wrong endpoint first burns the code: "Oura revoked the code (single-use ...), so the retry against moi also failed." The same notes say "a rejected refresh does not consume the token", so a refresh can fall back to the other endpoint safely. [Community, same PR and release]
  - The callback now carries `iss=https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous`. [Community, https://github.com/trig-point/tare/pull/101, 2026-11-08]
- Error shapes [Probe]:
  - Legacy token endpoint, unknown client: `400 {"status": 400, "error": "invalid_client", "error_description": "Invalid client_id."}`, for both form-body and Basic credentials. With no client: `400 {"status": 400, "title": "Bad Request"}`.
  - moi token endpoint, unknown client: `401 {"error":"invalid_client"}`.
  - Authorize with a fake client id: 302 to Oura's sign-in page. It does not check the client first.

**Access token lifetime.** The docs contradict each other: "OAuth2 access tokens expire after a period (typically 24 hours for Oura)" and "The token hasn't expired (they typically last 30 days)". [Oura, OpenAPI 1.43]. The implicit-flow example shows `expires_in=2592000`. One project observed about 30 days (`2591999`). [Community, https://cdn.jsdelivr.net/npm/oura-hr@1.1.0/OURA-API.md]. Pact reads `expires_in`, which is right.

**Refresh tokens.** "The refresh token is single-use, meaning it is invalidated after being used." [Oura, authentication page]. The error page lists "Token already used or revoked. If you are trying to use a refresh token, note that it can only be used once." [Oura, error-handling page]. The status code for a spent refresh token is not documented. OAuth's `invalid_grant` is normally a 400. Projects report `invalid_grant` when two refreshes race. [Community, IvanFox/oura-reader #4]. Refresh-token lifetime is not documented.

**Authorization codes.** "`invalid_grant`: The authorization code is expired (valid for only 10 minutes) or already used". [Oura, OpenAPI 1.43]. One project saw Chrome send the callback twice about 150 ms apart: "The second exchange returned invalid_grant, and Oura revoked the first token." [Community, HealthLog #1204, 2026-10-20]

**Redirect URI.** "The redirect URIs listed for your application act as a whitelist of allowed values, meaning this parameter must match one of the URIs exactly." In the token request it must be "The exact same redirect URI that was included in the authorization request". [Oura, authentication page]. HTTPS is required in practice. [Community, openwearables.io]

**Client credentials.** Either in the form body, or "using the HTTP Basic Authorization, with client_id as username and client_secret as password." The body must be `application/x-www-form-urlencoded`. [Oura, authentication page]. Pact uses the body, which is fine on both endpoints.

**PKCE.** Supported and "Recommended", not required. `code_challenge_method` "must be S256". [Oura, authentication page]

**Client-side-only flow.** Still documented, with no deprecation note: "the client-side only flow does not support refresh tokens. Once a token expires (currently set to 30 days), the user will need to re-authenticate your app." [Oura, authentication page]. Pact doesn't use it.

**Personal Access Tokens.** "Please note that personal access tokens were deprecated in December 2025 and are no longer available for use." [Oura, OpenAPI 1.43]

**Revoking.** Legacy: `https://api.ouraring.com/oauth/revoke?access_token={access_token}`. [Oura, authentication page]. New: `revocation_endpoint` in the discovery document. [Probe]

**User-Agent.** "All requests to the Oura API must include a non-empty User-Agent header. Requests without one may be rejected with an HTTP 403 Forbidden response." [Oura, authentication page]. Node's `fetch` sends `User-Agent: node` by default (checked on Node 22.23.5). So Pact sends a value, but not one that names the app, which is what Oura asks for. Real-world: the Home Assistant integration added one because "Oura API 1.43 requires" it. [Community, Oura-Home-Assistant-Integration v2.12.0]

## 5. Sleep data shape

**Fields** (`PublicModifiedSleepModel`, OpenAPI 1.43). Always present: `id, bedtime_end, bedtime_start, day, low_battery_alert, period, time_in_bed`. Nullable: `type`, `total_sleep_duration`, `average_breath`, `average_heart_rate`, `average_hrv`, `awake_time`, `deep_sleep_duration`, `efficiency`, `heart_rate`, `hrv`, `latency`, `light_sleep_duration`, `lowest_heart_rate`, `movement_30_sec`, `readiness`, `readiness_score_delta`, `rem_sleep_duration`, `restless_periods`, `sleep_algorithm_version` (`v1`/`v2`), `sleep_analysis_reason`, `sleep_phase_30_sec`, `sleep_phase_5_min`, `sleep_score_delta`, `ring_id` ("Deprecated, returns null"), `app_sleep_phase_5_min`. The page is `{data: [...], next_token: string|null}`, both required.

**`bedtime_start` format.** The schema type is `LocalizedDateTime` (a string). "All timestamps in the Oura API use ISO 8601 format with timezone information. When querying data with date parameters, the dates are interpreted in the user's local timezone." [Oura, OpenAPI 1.43 FAQ]. The sandbox returns `"2025-01-01T00:00:00.000+00:00"`: milliseconds, then `+00:00`, not `Z`. [Probe]. Real exports from an older API show local offsets such as `"2022-09-26T00:09:32-07:00"`, `"2022-10-02T23:56:02+02:00"` and `"2022-09-05T01:29:01+05:30"`. [Community, https://raw.githubusercontent.com/stethoscope-js/stethoscope/master/data/oura-sleep/daily/2022/09/25/sessions.json; that is v1-era data, so not proof for v2]. Pact's `utcOffsetOf` and `wallClock` handle both forms. I found no current v2 recording with a non-UTC offset. That still needs a real ring.

**`type` values.** `deleted, sleep, long_sleep, late_nap, rest`, and `type` may be null. Oura's definitions: "'deleted' = deleted sleep by user. 'sleep' = user confirmed sleep / nap, min 15 minutes, max 3 hours, contributes to daily scores. 'late_nap' = user confirmed sleep / nap, min 15 minutes, ended after sleep day change (6 pm), contributes to next days daily scores. 'long_sleep' = sleep that is long enough (>3h) to automatically contribute to daily scores. 'rest' = Falsely detected sleep / nap, rejected in confirm prompt by user". [Oura, OpenAPI 1.43 `PublicSleepType`]

**Can a sleep under 3 hours be `long_sleep`?** By definition no, but "3h" is not defined as time in bed or as sleep. Support pages say: "The Oura Ring requires a minimum of three hours of sleep stage detection between 6 PM and 6 PM the following day to identify a main sleep cycle." [Oura, https://support.ouraring.com/hc/en-us/articles/39695406607507] And "manually edited sleep periods must be at least three hours long". [Oura, https://support.ouraring.com/hc/en-us/articles/360025445994]. The sandbox returns a `long_sleep` with `time_in_bed: 300`, but that data is fake. [Probe]

**Several `long_sleep` in a day.** Yes, possible. "A user can have multiple sleep periods per day." [Oura, OpenAPI 1.43]. "if you sleep again later in the day for three hours or more, the daytime sleep period will be displayed and considered as the main sleep cycle." [Oura, sleep gaps article]. "Any sleep picked up by Oura that's longer than three hours will be viewed as your longest sleep period, and added automatically." [Oura, https://support.ouraring.com/hc/en-us/articles/1500009653181-Nap-Detection]. One project saw a 20-minute `sleep` at 23:05 and then a `long_sleep` from 00:02 to 06:46 on the same night. [Community, https://github.com/nekodas-neko/TrainingAi_Open/issues/3057]. Pact uses the first `long_sleep`, so that night would read 00:02.

**`end_date`.**
- Not documented.
- [Probe, sandbox]: `start_date=2025-01-01&end_date=2025-01-01` gave `[]`. `...&end_date=2025-01-02` gave only the 01-01 record. So `end_date` is exclusive there.
- Real API: "Oura API end_date is exclusive" (code comment) [Community, https://github.com/louispires/Oura-Home-Assistant-Integration/blob/main/custom_components/oura/api.py]. Also intervals.icu (2026-07-29) and mcpforoura PR #27. [Community]
- The filter is on `bedtime_start`, not `day`: "Oura filters /sleep by bedtime_start, so a session that belongs to start_date but began the evening before is missed." [Community, same HA file]. Pact asks for `night` to `night + 2`, which covers bedtime dates `night` and `night + 1`. That holds the whole 18:00-to-18:00 window.
- Unknown: whether the filter uses the local date of `bedtime_start` or its UTC date.

**`day`.** "Day that the sleep belongs to." [Oura, OpenAPI 1.43]. The Sleep Day "runs from 6 pm to 6 pm. Example: You wake up on New Year's Day at 10 am after going to bed at 4 am. You check the app and get a Sleep Score for 6 hours of sleep." [Oura, https://partnersupport.ouraring.com/hc/en-us/articles/29160913203219]. So a normal night of date D has `day` = D+1. The `late_nap` definition ("ended after sleep day change") suggests Oura uses the end time to pick the day. Pact uses `bedtime_start`.

**Pagination.** `next_token` comes back on the page and goes in as a query parameter. Pact follows it.

**Edits by the owner.** "You can only shorten sleep periods, not extend them", and "Sleep data older than three days can no longer be edited". [Oura, edit bedtime article]. `sleep_analysis_reason` can be `bedtime_edit`. So the owner can make `bedtime_start` later, never earlier. Pact keeps the first `bedtime_start` it sees, so an edit can't turn a Missed night into a Kept one.

**Sandbox.** `GET https://api.ouraring.com/v2/sandbox/usercollection/sleep` works with any bearer string. With none: `400 {"detail":"Missing auth token. Include any string in 'Authorization' header."}`. [Probe]. Its data alternates `late_nap` and `long_sleep`, all starting at 00:00 UTC. It is no use for testing clocks or durations.

**Data endpoint error shapes** [Probe]:
- No token: `400 {"detail":"Token is missing from Request Authorization Heade"}` (sic).
- Fake token: `401 {"detail":"The access token provided is expired, revoked, malformed, or invalid for other reasons."}`.

## 6. Data latency and later changes

- "Sleep Data: Only syncs when the user opens the Oura app and actively syncs their ring". Daily activity, stress and heart rate "may sync in the background". [Oura, OpenAPI 1.43]. Pact's "Open the Oura app to sync it" push matches this.
- Webhooks fire "approximately 30 seconds after data syncs from the mobile app". [Oura, OpenAPI 1.43]
- "Background uploads are best effort and can lag hours." Opening the app is "helpful, not a guarantee of sub-minute cloud lag." [Community, oura-hr field notes]
- Data can change after it first appears:
  - The webhook event types `create`, `update` and `delete` exist for `sleep`. [Oura, OpenAPI 1.43]
  - `sleep_analysis_reason` has `foreground_sleep_analysis`, `bedtime_edit`, `background_sleep_analysis` and `background_created_foreground_updated`, described as "The reason for the creation or update of the latest version of this sleep." [Oura, OpenAPI 1.43]
  - Nap merging depends on when you sync: "the Oura App won't detect a nap if it occurs within four hours of the end of the main sleep cycle. To increase the likelihood of additional sleep being included in your main sleep cycle, we recommend syncing your Oura Ring ... only after your second wake-up time". [Oura, Nap Detection article]. So an early sync can split a night that a later sync would merge.
  - Owners can shorten a period for 3 days, and can delete naps (`deleted`) or reject them (`rest`). [Oura]
  - Real-world: a day's entry "changed from 20m30 to 8h14" after the main sleep synced. [Community, https://forum.intervals.icu/t/oura-sync-issue-daily-oauth-token-refresh-not-working/130138, 2026-08-24]. A period's type can change when Oura re-sends it. [Community, nekodas-neko/TrainingAi_Open #3148, #3080]
- What this means for Pact: Pact judges a night the moment the first `long_sleep` arrives. If the owner syncs after a first long chunk, the verdict is fixed then. Since edits can only move a bedtime later, a later version could only show a later bedtime or the period's removal, not an earlier bedtime. So early judging is mostly safe for Kept. It can still lock in a Missed from a period Oura later retypes or deletes.
- Current known problems [Oura, https://support.ouraring.com/hc/en-us/articles/360037714493-Known-Issues, updated 2026-11-09]:
  - "Issue 343 | Sleep data may be missing or incomplete | All users on version 7.19.1 or newer | Open".
  - "Issue 495 | Oura Ring 4 May Stop Syncing After Firmware 2.13.1 Update ... Syncing may stay stopped for a day or two".

## 7. Webhooks

Oura offers them and strongly recommends them. "Webhooks are the preferred way to consume Oura data". [Oura, OpenAPI 1.43]

How they work [Oura, OpenAPI 1.43 "Webhook Subscription Routes"]:
- `POST /v2/webhook/subscription` with headers `x-client-id` and `x-client-secret` and body `{callback_url, verification_token, event_type, data_type}`. You need one subscription per pair of `event_type` (`create`, `update`, `delete`) and `data_type` (`sleep` is one).
- Oura checks the endpoint with `GET callback?verification_token=...&challenge=...`. You must answer `{"challenge": "..."}`.
- Events arrive as POST with `x-oura-signature` and `x-oura-timestamp`, body `{event_type, data_type, object_id, event_time, user_id}`. The signature is the uppercase hex HMAC-SHA256, keyed with the client secret, of the timestamp followed by the JSON body. You then fetch the document by `object_id`.
- Answer within 10 s. "For 4xx responses: 10 retries"; Oura "will retry webhook deliveries for about an hour". Answering 410 cancels the subscription. Oura advises a reconciliation pull for outages.
- Subscriptions carry an `expiration_time` and are renewed with `PUT /v2/webhook/subscription/renew/{id}`. Openwearables.io says: "Oura subscriptions expire after 90 days" and "Subscriptions are app-level ... they cover all authorized users." [Community, openwearables.io]
- [Probe]: `GET /v2/webhook/subscription` with no client headers gives `401 {"detail":"Missing x-client-id or x-client-secret headers."}`. With fake ones: `401 {"detail":"Invalid client credentials."}`.

What Pact would need:
- A public HTTPS route that answers the challenge and checks the signature.
- A map from Oura `user_id` to Pact account. `personal_info` returns an `id` "with any access token (no scopes are required)". [Oura, OpenAPI 1.43]. That this `id` equals the webhook `user_id` is likely but unverified.
- A slow reconciliation poll as a backstop, and a job that renews subscriptions.
- Unknown: whether webhooks work before the app is approved.

## 8. Other things that could break for real users

- **The new developer portal and token endpoint.** See section 4. This is the most likely break.
- **API agreement**, effective 2026-06-08 [Oura, https://cloud.ouraring.com/legal/api-agreement]:
  - 5(j): "You shall not use the Oura API ... in any way that would grant someone other than you or the applicable user the right to see any data related to that user without obtaining the prior express consent of that user." Pact shows reviewers the bedtime. The connect screen does say "Your reviewers see only Kept or Missed and that time." Check that this counts as prior express consent.
  - 5(c): a privacy policy is required.
  - 5(f): "Upon a request for deletion, you shall delete all User Data relating to such User within seventy-two (72) hours." Revoking consent "shall be effective immediately".
  - 3(m): data "may not be stored or retained beyond the duration strictly necessary." Pact keeps `occurrence.bedtime_start` and `account.oura_latest_bedtime_start` after a disconnect.
  - 4(a)(xiii) prohibits "charging Users in any manner for access to or use of ... any services or functionality included in or related to the ... Oura API". Pact's penalties are paid between users, not to Pact. That is probably fine, but a reviewer may ask.
  - 4(a)(xiv) prohibits use "which might overburden, impair, or disrupt the Oura Platform". 2(e): Oura may "revoke or suspend access for you or any Collaborator Application that Oura determines is not providing added benefit to Users".
  - Section 6(e): the Oura name may not be part of the app's name or icon.
  - 3(i): one client id per application or service.
  - No AI-model use of the data (several clauses). Not relevant to Pact today.
- **Regions.** I found no region or country limits on the API. Unknown.
- **Data loss on the ring side.** An empty battery loses the night ("all data from that night will be lost"). Days without a sync can overwrite data. [Oura, sleep gaps article]. The night then just has no data, which Pact already handles.
- **Owners must keep the app updated** "to support new data types". [Oura, support article]. Sleep is not a new type.
- **Announced changes, 2025–2026.** PATs gone (Dec 2025). V1 removed (2024-01-22). New developer portal and `moi.ouraring.com` login server (2026). `User-Agent` required (spec 1.43, about Oct 2026). `ring_id` deprecated (spec 1.41). New API agreement (2026-06-08). I found no reported API outage.

## Mismatches with Pact's code

1. _Fixed by ticket 20._ `DEFAULTS.tokenUrl` in `src/core/oura.ts` was `https://api.ouraring.com/oauth/token`. For an app made on the new portal, community reports say this returns `400 invalid_request`, and Pact's `#tokenRequest` turned that into "exchange-failed". Use the discovery document's `token_endpoint` (`https://moi.ouraring.com/oauth/v2/ext/oauth-token`). Never retry a code exchange on a second endpoint, because that burns the code. A refresh may fall back once. Verify with the real app first.
2. _Fixed by ticket 21._ `#tokenRequest` in `src/core/oura.ts`: 400 and 401 were both treated as "Oura refused the grant", so the account is disconnected. But `invalid_client` (a wrong or rotated client secret) is 400 on the legacy endpoint and 401 on moi [Probe]. One bad secret would quietly disconnect every account at its next refresh, with no operator alert. Read the `error` field: only `invalid_grant` means "this account must reconnect".
3. `sleepPeriods` in `src/core/oura.ts` and `checkOura` in `src/core/bedtime.ts`: every 403 becomes "Needs reconnecting" / "Reconnect Oura". The documented causes are a lapsed membership (reconnecting doesn't help), a missing scope, and a missing User-Agent. The body is not read.
4. `sleepPeriods` in `src/core/oura.ts`: a missing scope may come back as 401, not 403 [Community]. Pact then spends a refresh token for nothing before it disconnects. Nothing checks after connect that `daily` was granted. A test call right after `connect` would catch an unticked scope while the owner is still on the page.
5. _Fixed by ticket 22._ `#get` and `#tokenRequest` in `src/core/oura.ts`: no `User-Agent` was set, so Node sends `node`. Oura requires a non-empty one and asks for one that names the app (e.g. `Pact/1.0`). Low risk, trivial fix.
6. `sleepPeriods` in `src/core/oura.ts`: a 429 throws a generic error and the next tick tries again a minute later, ignoring `Retry-After`. That's acceptable at small scale.
7. `checkOura` in `src/core/bedtime.ts` and the tick in `src/server/scheduler.ts`: Pact polls every minute per waiting account from 18:00, hours before any sleep can exist. That is about 840 to 1440 calls per user per night. Against the app-wide 5000 per 5 minutes, about 1000 waiting accounts saturate the app. Oura recommends webhooks and prohibits overburdening. Cheaper options: poll rarely before the owner's usual wake time, or use the `sleep` webhooks.
8. The Oura callback route in `src/server/app.ts` (`API_PATHS.ouraCallback`): the callback doesn't claim the state once before exchanging the code. A duplicate callback (seen in Chrome, about 150 ms apart [Community]) makes a second exchange. Per the report, Oura then revokes the first token, which Pact has already stored. The state check passes for both requests because the cookie deletion only lands with the response.
9. `disconnect` in `src/core/connections.ts`: Pact deletes its tokens but doesn't revoke them at Oura. Pact stays listed in the owner's Oura app, and it may keep holding one of the 10 user slots (unknown).
10. `OuraSleepPeriod` in `src/core/ports.ts`: `type` can also be `null` per the spec. It's harmless at runtime, since `bedtime.ts` only accepts `long_sleep`.
11. `devOura` in `src/core/oura.ts`: the dev stand-in filters on `day`, inclusive at both ends. The real API filters on the `bedtime_start` date, with `end_date` exclusive. Tests built on the stand-in may hide a range bug.
12. `nightOf` in `src/core/oura-clock.ts`: a `long_sleep` that starts before 18:00 and runs into the night counts for the previous night. Oura would file it under the next day, since a `late_nap` is placed by when it ends. This is a rare edge case, but it reads as Missed with no sleep.
13. `.scratch/pact-v0/issues/08-oura-bedtime-pact.md`, Comments, "Rate limit": the note says the spec "says ... approved apps have none". The spec says approval removes the **user** cap. It says nothing about lifting rate limits.
14. _Fixed by ticket 20._ `.scratch/pact-v0/manual-checks.md`, Oura Ring setup: "At cloud.ouraring.com, open the API application ... (create one if there's none)". New apps are made at https://developer.ouraring.com/, and the form wants privacy policy and terms URLs that Pact doesn't have. The `daily` scope must be turned on in the app. Approval needs at least one active user and has no known timeline.
15. Missing: a privacy policy and terms page. The app form and the API agreement (5(c)) both need them.

## Still unknown — needs a real ring

- Which token endpoint Pact's own app needs (legacy or moi). Find out with one connect while watching the logs. If it fails, don't retry the same code.
- What a real v2 `bedtime_start` looks like for a user outside UTC: offset form, milliseconds.
- The real `expires_in`. Whether the token response includes `scope`.
- The status and body for a spent refresh token on whichever endpoint is used (expect 400 `invalid_grant`).
- What `/sleep` returns for a Gen3-or-later owner whose membership has lapsed (expect 403), and whether such an owner can still finish consent.
- Whether the consent screen lets the owner untick `daily`. If so, what `/sleep` returns then (401 or 403).
- What the 11th user sees before approval. Whether disconnected users still count.
- Whether the `start_date`/`end_date` filter uses the local or UTC date of `bedtime_start`.
- How soon after waking sleep appears, with and without opening the app, on current app versions.
- How often a sleep document changes after it first appears (type, `bedtime_start`, merges, deletes), and whether its `id` survives. Compare the first-seen document with the same night at 18:00 the next day.
- Whether `long_sleep` is ever under 3 hours of `time_in_bed` or of `total_sleep_duration`.
- Whether webhooks work for an unapproved app. Whether the webhook `user_id` equals `personal_info.id`.
- Per-token rate limit numbers. Whether `X-RateLimit-*` headers come on normal responses.
