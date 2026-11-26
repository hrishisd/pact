# Google Health API research: can Pact judge bedtimes from a Fitbit?

Researched 2026-11-26 from public sources and a few credential-free probes. Nothing here was checked with a real Fitbit, a real Google Health account, or a real Google Cloud OAuth client.

Source labels used below:
- **[Google]** Google's own pages: developers.google.com/health (fetched as `.md.txt`), the API discovery document, developers.google.com/identity, support.google.com/cloud, support.google.com/googlehealth and /fitbit.
- **[Probe]** a request I sent myself, with fake or no credentials, on 2026-11-26.
- **[Community]** GitHub issues and PRs, project READMEs, news and third-party guides. Real-world reports, not promises.

## Summary

What will work:
- One Google Cloud project with one OAuth client can serve many Pact accounts. Each user does Google OAuth consent with `access_type=offline`. The authorize URL is `https://accounts.google.com/o/oauth2/v2/auth`, the token URL is `https://oauth2.googleapis.com/token`. [Google]
- One scope is enough: `https://www.googleapis.com/auth/googlehealth.sleep.readonly`. It covers sleep reads, webhooks for sleep, and `users.getIdentity`. Because it is a single scope, Google shows no per-scope checkbox, so the user can't half-consent. [Google]
- Each sleep record has `startTime`/`endTime` in UTC plus `startUtcOffset`/`endUtcOffset` (e.g. `"-14400s"`), a `type` (`CLASSIC` or `STAGES`), stages, and `metadata.mainSleep` / `nap` / `manuallyEdited` / `processed`. That is enough to get a local bedtime and to tell the night's main sleep from a nap. [Google]
- Data arrives without the user opening the app: the Fitbit syncs every 15 minutes while the Google Health app runs in the background and Bluetooth is on. That is better than Oura. [Google]
- Rate limits are generous: 300 requests per user per minute. Pact's once-a-minute poll is fine. Webhooks exist for `sleep`. [Google]

What will not work, or will break first:
1. **The scope is Restricted.** Google lists `googlehealth.sleep.readonly` as a restricted scope, and says "All Google Health API scopes are categorized as Restricted". Going past 100 users needs OAuth verification plus a paid annual third-party security assessment (CASA, quoted at $500 to $4,500). [Google]
2. **100 users, for the life of the project.** An unverified app is capped at "100 new users in total", and "The user cap applies over the entire lifetime of the project, and it cannot be reset". Disconnected and test users still count. [Google]
3. **Stay unverified, but publish.** Left in "Testing", every refresh token dies after 7 days and each user must be on a hand-kept test-user list. Moved to "In production" without verification, Google's own pages say a limited-audience app (under 100 users) can keep running and users "will be allowed to click through 'unverified app' warning screens". One project reports a token issued that way still refreshing after 10 days. Every user sees "Google hasn't verified this app" and must click Advanced. Google Health's own setup page reads as if it expects verification first. [Google, Community]
4. **The user needs a Google account linked to Google Health.** Fitbit-account logins ended on 2026-05-19. A user who consents before signing in to the Google Health app gets `400 FAILED_PRECONDITION ACCOUNT_NOT_LINKED` on every call. Google Workspace accounts can't be linked at all. [Google]
5. **The owner can move the bedtime, in both directions, and add sleep by hand.** The Google Health app lets the owner edit a sleep's start and end time ("if you extend your time asleep ..."), and manually add a sleep. Oura only lets owners shorten. Pact must exclude manual entries (`dataSourceFamily=users/me/dataSourceFamilies/google-wearables` on `reconcile`) and either refuse `metadata.manuallyEdited` records or keep the first-seen bedtime (Pact already keeps the first). [Google]
6. **Sleep can only be filtered by end time.** Filtering on `start_time` returns `400 INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER`. Page size for sleep is capped at 25. Pact must ask for sleeps *ending* in a window wide enough to hold every sleep *starting* in its 18:00-to-18:00 night, then filter locally. [Google]
7. **Policy.** The Google Health developer policy limits who may see the data ("Do not allow humans to read user data, unless ... The user's explicit consent"), requires an in-app disclosure "immediately precede" consent, a privacy policy, a Limited Use statement, and tokens encrypted at rest. These apply verified or not. Pact shows reviewers the bedtime and has no privacy policy. [Google]

## 1. Auth

### Scope

- "All Google Health API scopes begin with: `https://www.googleapis.com/auth/googlehealth`". The table lists `.sleep.readonly` "See your Google Health sleep data." [Google, https://developers.google.com/health/scopes]
- The `sleep` data type: "Available operations: list, get, reconcile, create, update, batchDelete | Scope `.sleep.readonly` `.sleep.writeonly`". [Google, https://developers.google.com/health/data-types/sleep]
- The discovery document (revision `20261120`) lists `https://www.googleapis.com/auth/googlehealth.sleep.readonly | See your Google Health sleep data`. [Probe, `https://health.googleapis.com/$discovery/rest?version=v4`]
- `users.getIdentity` accepts any of the read scopes, `sleep.readonly` included. [Google, https://developers.google.com/health/reference/rest/v4/users/getIdentity]
- Webhooks for sleep: "Sleep, which covers the sleep data type: `.../googlehealth.sleep.readonly`, `.../googlehealth.sleep.writeonly`". [Google, https://developers.google.com/health/webhooks]
- Scope names changed once already, 2026-05-26: "`.sleep` is now `.sleep.writeonly`". [Google, https://developers.google.com/health/release-notes]
- **No checkboxes with one scope.** "For applications that request only **one** non-Sign-In scope, the granular permission consent screen is **not** applicable. In the other words, users either approve or deny the entire request, and there is no checkbox in the consent screen." [Google, https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions]. With more than one scope, users can untick some, and Google says apps must handle partial consent. [Google, scopes page]

### Sensitive or restricted?

- Restricted. Google's restricted-scope list has a "Google Health API" section that starts with `https://www.googleapis.com/auth/googlehealth.sleep.readonly`. [Google, https://support.google.com/cloud/answer/13464325]. (That list still shows old names, e.g. `googlehealth.sleep` and `health_metric_and_measurements`.)
- "All Google Health API scopes are categorized as Restricted, necessitating a privacy and security review for access." [Google, https://developers.google.com/health/about]
- "Most scopes for the Google Health API are restricted, which means you must complete verification before your app is publicly available." [Google, https://developers.google.com/health/app-verification]

### Unverified, "In production": what happens

What Google says, in its general OAuth pages:
- Publishing status Testing: "limited to up to 100 test users listed in the OAuth consent screen", "Google will display a warning message before allowing a specified test user to authorize", and "Authorizations by a test user will expire seven days from the time of consent. If your OAuth client requests an offline access type and receives a refresh token, that token will also expire." [Google, https://support.google.com/cloud/answer/15549945]
- In production: "available to any user with a Google Account", and "Google will display an Unverified apps warning message if your project's OAuth clients request authorization of scopes considered sensitive or restricted before your project has completed verification for those scopes." [Google, same page]
- The cap: "The user cap limits the number of users that can grant permission to your app when requesting unapproved sensitive or restricted scopes. The user cap applies over the entire lifetime of the project, and it cannot be reset or changed." Quota: "100 new users in total, after the app presents the unverified app screen". [Google, same page and https://support.google.com/cloud/answer/7454865]
- Below 100 users, verification is optional: "Limited Audience apps: If the app is intended for a limited audience (fewer than 100 users), you and your limited number of users can continue using the app without going through verification(users will be allowed to click through "unverified app" warning screens during sign-in). Such apps will need to complete a verification, if they want to grow their user base beyond 100." [Google, https://support.google.com/cloud/answer/13464323, "When is verification not needed"]
- "Personal use ... if your app is used by only a few users, all of whom are known personally to you. You and your limited number of users might be comfortable with advancing through the unverified app screen". [Google, https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification]
- Refresh-token expiry is tied to Testing, not to verification: "A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of "Testing" is issued a refresh token expiring in 7 days". [Google, https://developers.google.com/identity/protocols/oauth2#expiration]. The Google Health setup page agrees: "Published Mode: Once your app is moved to "In Production" status, refresh tokens generally don't expire unless they are revoked or remain unused for a prolonged period (typically six months)." [Google, https://developers.google.com/health/setup]
- Branding: "The app name will be displayed on the OAuth consent screen only if your app has been verified." [Google, https://support.google.com/cloud/answer/10311615]. So unverified users won't see "Pact" on the consent screen.

What the Google Health pages say, which reads more strictly:
- "By default, newly created OAuth clients are in an unverified state with a cap of 100 users for both testing and production purposes. To enable authorization during this period, you must manually add each user's email address to the Test users list". [Google, https://developers.google.com/health/setup]
- Checklist: "Once OAuth verification is complete, publish your app to "In production" in Google Cloud console to remove the 100-user limit." [Google, https://developers.google.com/health/developer-checklist]
- Rate limits: "Unverified applications: Max 250 QPS total (capped at 100 users @ 2.5 QPS per user)". [Google, https://developers.google.com/health/rate-limits]. This implies unverified apps do serve real users.
- None of these says publishing unverified is forbidden. Nothing says the Google Health API refuses tokens from an unverified production client.

What people report:
- "We moved the consent screen from Testing to In production without verification (own use, brand pages on GitHub Pages)." "The consent page shows the "Google hasn't verified this app" warning; the user clicks Advanced to continue." "After a fresh consent, the token answer no longer carries `refresh_token_expires_in` (in Testing it was `604799`)." "Our current refresh token was issued on 2026-10-12 and still refreshes on 2026-10-22, past the 7 days." [Community, https://github.com/soma-intelligence/open-health-sync/issues/206, 2026-10-22, one user]
- creinbold/health-sync README: "Publish the app ("In production")" because in Testing "Google lets refresh tokens expire after 7 days"; consent then shows "Google hasn't verified this app"; unverified apps are "capped at 100 users". [Community, https://github.com/creinbold/health-sync]
- HealthLog's guide says the opposite on one point: the client needs "Google brand verification plus an annual CASA assessment before it can leave Testing mode", and it tells self-hosters to stay in Testing and reconnect weekly. [Community, https://docs.healthlog.dev/guides/connect-google-health/]. Google's own pages do not say this; the report above shows the console let a project publish unverified.

So, for Pact: publish unverified. Expect the warning screen with an Advanced click-through for every user, no app name on the consent screen, at most 100 users ever per project, and refresh tokens that last.

### CASA below 100 users

- Not required below the cap. CASA is "the final step of the restricted scopes review process ... the Google Trust and Safety team will contact you when it is time to initiate the security assessment process." [Google, https://support.google.com/cloud/answer/13465431]. An app that never asks for verification never enters that process.
- If Pact ever needs more than 100: "apps using restricted scopes must also complete an annual security assessment based on the ... (CASA) ... The security assessment can take 2-3 weeks for tier-2 applications and 4-6 weeks for tier-3 applications to complete and involves fees payable to the third-party assessor, ranging from $500 to $4,500 USD". [Google, https://developers.google.com/health/app-verification]
- The Google Health data policy: "Depending on the API being accessed and number of user grants or users, we will require that your application or service follow the ... (CASA) undergo a periodic security assessment". [Google, https://developers.google.com/health/policies/health-api-developer-user-data-policy]

### Tokens

- **Access token:** about 1 hour. The Google Health refresh example returns `"expires_in": 3599`. [Google, setup page]. Real-world: "Google tokens expire after an hour", and a long backfill that kept one token got "401" on every request after an hour. [Community, https://github.com/MBombeck/HealthLog/pull/1196, 2026-10-10]
- **Refresh token rotation:** none. Google's refresh response has only `access_token, expires_in, scope, token_type`. [Google, https://developers.google.com/identity/protocols/oauth2/web-server#offline]. "Keeps the refresh token on refresh, because Google does not send it again." [Community, https://github.com/hhzks/sleep-visualisation/pull/1, 2026-11-09]. Unlike Oura, a refresh does not spend the refresh token, so two racing refreshes are harmless.
- **`refresh_token_expires_in`:** "only set when the user grants time-based access". [Google, web-server page]. In Testing it shows up as `604799`. [Community, open-health-sync #206]. The Google Health setup page's own example contains `"refresh_token_expires_in": 112154` (about 31 hours), with no explanation. [Google, setup page]. Pact should read and store it if present.
- **When a refresh token stops working:** revoked by the user, "not been used for six months", "The user account has exceeded a maximum number of granted (live) refresh tokens", time-based access expired, admin policy. "There is currently a limit of 100 refresh tokens per Google Account per OAuth 2.0 client ID. If the limit is reached, creating a new refresh token automatically invalidates the oldest refresh token without warning." [Google, https://developers.google.com/identity/protocols/oauth2#expiration]. The error is `invalid_grant`. [Google, web-server page]
- Google Health advises refreshing on demand, not in a batch cron: "Avoid refreshing tokens in batches (for example, using a scheduled `cron` job ...)". [Google, setup page]
- **Token endpoint errors** [Probe]: `POST https://oauth2.googleapis.com/token` with an unknown client gives `401 {"error": "invalid_client", "error_description": "The OAuth client was not found."}`.
- **Optional RISC.** Cross-Account Protection can tell Pact when a user revokes access. [Google, setup page]

## 2. Accounts and subscriptions

**A Google account is required.**
- "After May 19, 2026, you can no longer access Fitbit with your Fitbit account. To continue using your account, you'll need to move your Fitbit account to Google." "A Google Account is now required to sign up for the Google Health app and activate newly-released Fitbit and Pixel devices." [Google, https://support.google.com/fitbit/answer/14237024]
- Accounts not moved: "You can still download or delete your data any time before we begin processing data deletions on July 15, 2026. ... Some users may be able to migrate their accounts during this period." [Google, same page]. So by late 2026 any active Fitbit user is on a Google account, or has lost access.
- "You can't link your Google Health account to a Google Workspace account." [Google, same page]
- "On May 19, 2026, the Fitbit app became the Google Health app". [Google, https://support.google.com/googlehealth/answer/17068213]

**Linking must happen first.**
- "Before a user goes through the Google OAuth 2.0 consent flow in your app, they must sign in to the Google Health mobile app to link Google Health to their Google Account. Google OAuth 2.0 authenticates any valid Google Account and cannot check whether the account has an active Google Health profile during the consent screen." [Google, setup page]
- Unlinked: `400 {"error": {"code": 400, "message": "The account is not linked to Google Health.", "status": "FAILED_PRECONDITION", "details": [{"reason": "ACCOUNT_NOT_LINKED", "domain": "health.googleapis.com", "metadata": {"redirect_uri": "https://fitbit.google.com/auth/signup"}}]}}`. Google says to call `GET https://health.googleapis.com/v4/users/me/identity` right after the code exchange and not mark the account connected if it fails. [Google, https://developers.google.com/health/troubleshooting]
- A legacy Fitbit login that somehow completes consent gives `403 "The caller does not have permission." ... "Could not mint UberMint from GaiaMint."` [Google, troubleshooting page]

**Premium.**
- No API page mentions Premium or any subscription. Sleep stages depend on the device: "Fitbit devices that track heart rate (except Charge HR and Surge) also track sleep stages." [Google, https://support.google.com/googlehealth/answer/14236407]
- The same help page says, under "What sleep information Google Health tracks": "This feature may require a Google Health Premium subscription." It is in a generic box with "Availability varies by region or country and device", so it's unclear what it covers.
- "Fitbit Premium is now Google Health Premium." Premium's sleep extras are coaching and insights. [Google, https://support.google.com/googlehealth/answer/17068213]
- I found no report of the API hiding sleep from non-Premium users. Pact only needs `interval` and `metadata`, not stages or score.

## 3. Sleep data shape

**Endpoint.** Google says to read sleep from `reconcile`, not `list`:
`GET https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile?filter=...&pageSize=25`
"When a user tracks sleep across multiple sources, such as a wearable tracker and Health Connect, `list` returns every overlapping record. ... The `reconcile` endpoint deduplicates overlapping logs into a single stream and identifies each day's primary sleep session by setting `sleep.metadata.mainSleep` to `true`." [Google, sleep guide]

**Example response** (Google's own, from the sleep guide):
```json
{
  "dataPoints": [
    {
      "dataPointName": "users/user-id/dataTypes/sleep/dataPoints/data-point-id",
      "sleep": {
        "interval": {
          "startTime": "2026-03-03T20:57:30Z",
          "startUtcOffset": "0s",
          "endTime": "2026-03-04T04:41:30Z",
          "endUtcOffset": "0s"
        },
        "type": "STAGES",
        "stages": [
          { "startTime": "2026-03-03T20:57:30Z", "startUtcOffset": "0s",
            "endTime": "2026-03-03T20:59:30Z", "endUtcOffset": "0s", "type": "AWAKE" }
        ],
        "metadata": { "stagesStatus": "SUCCEEDED", "processed": true, "mainSleep": true },
        "summary": { "minutesInSleepPeriod": "464", "minutesAsleep": "407", "minutesAwake": "57",
                     "minutesToFallAsleep": "0", "minutesAfterWakeUp": "0", "stagesSummary": [] }
      }
    }
  ],
  "nextPageToken": "Xm5h-6L0..."
}
```
A non-UTC example in the same guide: `"startTime": "2026-04-20T22:30:00Z", "startUtcOffset": "-14400s"`.

**Fields** [Google, https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints#Sleep and the discovery document]:
- `interval` (`SessionTimeInterval`), required: `startTime`, `endTime` ("generated output will always be Z-normalized"), `startUtcOffset`, `endUtcOffset` (a duration string like `"-14400s"`, "The offset of the user's local time at the start of the session relative to ... UTC"), and output-only `civilStartTime`, `civilEndTime` (`CivilDateTime` objects).
- `type`: `SLEEP_TYPE_UNSPECIFIED`, `CLASSIC` ("AWAKE, RESTLESS and ASLEEP"), `STAGES` ("AWAKE, LIGHT, REM and DEEP"). This is the stage method, **not** main sleep vs nap.
- `stages[]`: `startTime`, `startUtcOffset`, `endTime`, `endUtcOffset`, `type` (`AWAKE, LIGHT, DEEP, REM, ASLEEP, RESTLESS`), `createTime`, `updateTime`.
- `shortAwakenings[]`, `outOfBedSegments[]`.
- `metadata`: `stagesStatus` (e.g. `SUCCEEDED`, `REJECTED_NAP` "the sleep log is a nap (has < 3h duration)", `REJECTED_COVERAGE`, `TIMEOUT`), `processed` ("A `false` value means sleep period is detected but sleep stages is still processing"), `nap` ("Naps are sleeps without stages and relatively short durations"), `manuallyEdited`, `externalId`, `mainSleep` ("the longest sleep session with stages within one day. If no sleep session has stages, then the longest sleep is the `mainSleep`. If there are multiple days of sleep in the response, there is one `mainSleep` per day").
- `summary`: `minutesInSleepPeriod`, `minutesAsleep`, `minutesAwake`, `minutesToFallAsleep`, `minutesAfterWakeUp`, `stagesSummary[]`. Numbers come as strings.
- `createTime`, `updateTime` on the sleep.
- `reconcile` returns `dataPointName`; `list`/`get` return `name` and also `dataSource` (`recordingMethod`: `MANUAL`, `PASSIVELY_MEASURED`, ...; `platform`: `FITBIT`, `HEALTH_CONNECT`, `HEALTH_KIT`, ...). `ReconciledDataPoint` has no `dataSource`. [Google, reconcile reference]

**Main sleep vs nap.** Use `metadata.mainSleep` (from `reconcile`) and `metadata.nap`. Devices log naps "at least 20 minutes long". [Google, https://support.google.com/googlehealth/answer/14236407]. What "one day" means for `mainSleep` is not defined: the night's start, its end, or the civil date of the end. "If there are multiple days of sleep in the response" hints it is worked out per response.

**Civil times may be missing.** "Intervals carry no civil times, so the wake date is derived from endTime + endUtcOffset." [Community, https://github.com/creinbold/health-sync]. "A session without a civil end time gets its date from `endTime` plus `endUtcOffset`." [Community, https://github.com/jonathanhstock/workoutlogger/pull/13, 2026-10-05]. Google's example responses also omit them. Pact should compute local time from `startTime` + `startUtcOffset` and not depend on `civilStartTime`.

**Listing the sleeps for a night** [Google, sleep guide and https://developers.google.com/health/filters]:
- "Filter `sleep` queries only by the session's end time using `sleep.interval.end_time` (physical time in UTC) or `sleep.interval.civil_end_time` (local civil time). Combine lower and upper boundaries using the `>=` and `<` comparison operators with `AND`."
- "Filtering on `sleep.interval.start_time` or `sleep.interval.civil_start_time` returns a `400 Bad Request` (`INVALID_ARGUMENT`) error with reason `INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER`. Using `OR` returns ... `INVALID_DATA_POINT_FILTER_EXPRESSION_STRUCTURE`." (The `list` reference still says sleep end-time filters support "`AND`, `OR`". The guide is newer; don't use `OR`.)
- `>=` is inclusive, `<` exclusive. Other comparators return `400 ... INVALID_DATA_POINT_FILTER_RESTRICTION_COMPARATOR`.
- Civil literals are `YYYY-MM-DD[THH:mm:ss]`, e.g. `sleep.interval.civil_end_time >= "2026-03-04T05:00:00" AND sleep.interval.civil_end_time < "2026-03-04T12:00:00"`.
- "Both `list` and `reconcile` enforce a default and maximum `pageSize` of `25` for `sleep`." Follow `nextPageToken` "until the token is empty".
- `list` orders "by the interval start time in descending order". The order of `reconcile` isn't stated.
- `dataSourceFamily` is refused on `list` for sleep (`400 INVALID_ARGUMENT`), but works on `reconcile`: `users/me/dataSourceFamilies/google-wearables` "Includes data from Google and Fitbit tracker devices ... Excludes manually logged data." Default is `all-sources`, which includes Health Connect and Apple Health imports. [Google, filters page, reconcile reference]
- For Pact's night D (sleep starting between 18:00 on D and 18:00 on D+1, local): ask for `civil_end_time >= "D T18:00:00" AND civil_end_time < "D+2 T12:00:00"` (or the UTC equivalent), then keep sessions whose local start (`startTime` + `startUtcOffset`) falls in the night. Real-world: OpenFit's sleep stayed empty until it switched to `civil_end_time`, because "the doc's filter list excludes sleep from interval.civil_start_time". [Community, https://github.com/Raven-git-hub/OpenFit/pull/10, 2026-10-08]. workoutlogger saw empty sleep from `list` and moved to `reconcile`. [Community, workoutlogger #13]

**Can records change after they first appear?** Yes.
- "Never assume a data point's interval timestamps are permanently fixed." Records from Health Connect or partner apps "inherit updates from the originating source". [Google, https://developers.google.com/health/data-management]
- `metadata.processed` can be `false` first ("sleep period is detected but sleep stages is still processing"). [Google, reference]
- The owner can edit start and end, both ways: "Tap Edit, or Delete, and you can adjust your bedtime and wake up time." The owner can also add a sleep by hand ("tap Add ... Enter the day and your Bedtime and Wake up time"). [Google, https://support.google.com/googlehealth/answer/14236407]. "If you extend your time asleep, you may find gaps at the start or end of your sleep stages". [Google, https://support.google.com/googlehealth/answer/14236513]. Unlike Oura, an edit can make the bedtime **earlier**.
- After an edit, "the API recalculates the sleep efficiency score and adjusts stage partitions". [Google, sleep guide]
- Webhooks send `UPSERT` "for any data addition or modification" and `DELETE` when a user deletes data. [Google, webhooks page]
- Real-world: a Pixel Watch 4 user's "overnight sleep appeared initially as a nap. About 20 to 30 minutes later, the full coach evaluation was populated." [Community, https://android.gadgethacks.com/news/fitbit-public-preview-missing-data-delays-vs-blackouts-explained/, undated]. open-wearables merges Google sessions under 120 minutes apart and turns a nap into main sleep when it does. [Community, https://github.com/the-momentum/open-wearables/pull/1853, merged 2026-11-03]. HealthLog saw two overlapping sessions "tombstone and resurrect each other hourly" until they handled overlaps. [Community, HealthLog #1196]

**Data endpoint error shapes** [Probe, `GET https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile`]:
- No token: `401 {"error": {"code": 401, "message": "Request is missing required authentication credential. ...", "status": "UNAUTHENTICATED", "details": [{"reason": "CREDENTIALS_MISSING", "domain": "googleapis.com", "metadata": {"service": "health.googleapis.com", "method": "google.devicesandservices.health.v4.DataPointsService.ReconcileDataPoints"}}]}}`.
- Fake token: `401` with `www-authenticate: Bearer realm="https://accounts.google.com/", error="invalid_token"` and `{"error": {"code": 401, "message": "Request had invalid authentication credentials. ...", "status": "UNAUTHENTICATED"}}`.
- Google documents an expired token as `401 ... INVALID_AUTHENTICATOR: Token expired`. [Google, troubleshooting page]

**No sandbox.** "The Google Health API doesn't provide a separate sandbox or staging environment." "Google doesn't provide pre-populated sample or mock health data." Test data comes from wearing a device, logging by hand in the app, or writing through the API. [Google, setup page]

## 4. Latency

- "Updates to the user's data is only available after they sync their activity tracker or manually enter new data into the Google Health app. The Fitbit device and Google Health app can automatically sync every 15 minutes when the Google Health app is open on the mobile device and the two have an active data connection and are within Bluetooth range." [Google, https://developers.google.com/health/data-types]
- Same page, further down: "The device syncs data automatically throughout the day, whenever the Google Health app is open, or every 15 minutes if Bluetooth is active and the app is running in the background. Once this synchronization process is complete, the data is then available for third-party services through the Google Health API." [Google]
- Help centre: "For Fitbit devices, data automatically syncs to the Google Health app throughout the day. Each time you open the Google Health app, your device syncs automatically when it's nearby." [Google, https://support.google.com/googlehealth/answer/14236618]
- But: "Battery saver mode and Bedtime mode limit background data connectivity. Fitbit data may not sync if any of these modes are turned on, and data will only sync once they're turned off." [Google, same page]. My inference: a watch left in Bedtime mode may hold the night until the owner turns it off or touches the watch.
- Help centre still tells owners to "Sync your device each morning to review your sleep data". [Google, https://support.google.com/googlehealth/answer/14236407]. "When syncing your device, it may take a minute for your Sleep Score to appear." [Google, https://support.google.com/googlehealth/answer/14236513]
- So: unlike Oura, opening the app is not required if background sync works. It helps when it doesn't. Pact's "open the app" push is still a sensible fallback.
- Real-world: "Under normal conditions, sleep data arrives within two to three minutes of waking"; one report of 20 to 30 minutes. [Community, gadgethacks, undated]. Older Fitbit forum threads report sleep lagging hours behind other data. [Community, community.fitbit.com, various]
- Outages: a 2026-07-16 Google Health outage broke device sync for Fitbit and Pixel Watch users. [Community, https://9to5google.com/2026/07/16/google-health-outage-breaks-device-sync-for-all-fitbit-pixel-watch-users/]. Google runs a status page: https://status.healthapp.google.com/. [Google, release notes 2026-06-22]
- `users.pairedDevices.list` gives `lastSyncTime` per device, but needs a second scope, `googlehealth.settings.readonly`. [Google, https://developers.google.com/health/reference/rest/v4/users.pairedDevices/list]

## 5. Webhooks, polling, rate limits

**Webhooks exist for `sleep`** and Google prefers them: "Subscribe to webhooks and call the Google Health API when you receive a notification, rather than polling endpoints." [Google, webhooks page]

How they work [Google, https://developers.google.com/health/webhooks]:
- Register a subscriber per Cloud project: `POST https://health.googleapis.com/v4/projects/{project-number}/subscribers?subscriberId=...` with `endpointUri`, `subscriberConfigs` (`dataTypes: ["sleep"]`, `subscriptionCreatePolicy: "AUTOMATIC"` or `"MANUAL"`), and `endpointAuthorization.secret` (sent back verbatim in `Authorization`). The caller needs a Google Cloud IAM role ("Google Health API Read / Editor / Admin"), ideally on a service account. Use the project **number**, not the ID, or you get 400/403.
- `AUTOMATIC` subscribes every user who grants the scope, before or after the subscriber was made. "Notifications are not backfilled".
- Verification: two POSTs with `{"type": "verification"}` and User-Agent `Google-Health-API-Webhooks`. The one with the secret must get 200/201; the one without must get 401/403.
- Notifications are a JSON array of 1 to 99 objects: `{"data": {"version": "1", "healthUserId": "...", "operation": "UPSERT"|"DELETE", "dataType": "sleep", "intervals": [{"physicalTimeInterval": {...}, "civilIso8601TimeInterval": {...}}], "recordId": "9875412"}}`. Signed with ECDSA P-256 in `GOOGLE-HEALTH-API-SIGNATURE`, public keys at `https://www.gstatic.com/googlehealthapi/webhooks/webhooks_public_keyset.json`, rotated every 30 days.
- Map `healthUserId` to a Pact account with `users.getIdentity` at connect time. "This mapping doesn't change over time".
- Replies: under 400 acks; 408, 429, 5xx and timeouts are retried with backoff; any other 4xx "Permanently discards the notification batch". Queue retention: "up to 24 hours" on the webhooks page, "up to 7 days" in the 2026-05-26 release notes. They disagree.
- "The Google Health API delivers webhook notifications on a best-effort basis, which means some notifications might be delayed or dropped." Google says to keep querying directly when freshness matters.
- No webhook is sent when a user revokes access or deletes the account, though the token list includes `WEBHOOK_DATA_TYPE_USER_REVOKED_ACCESS`.
- Whether webhooks work for an unverified client is not stated.

**Rate limits** [Google, https://developers.google.com/health/rate-limits]:
- Per project: 86.4M requests/day, 120,000/minute. Per user: 300/minute. "Unverified applications: Max 250 QPS total (capped at 100 users @ 2.5 QPS per user)."
- Over the limit: `429 Too Many Requests` (`RESOURCE_EXHAUSTED`). Retry 429, 503 and 504 "with exponential backoff and random jitter".
- OAuth token grants are also rate-limited; "If you expect to exceed 10,000 user sign-ups or re-authentications within a 24-hour sliding window, request a higher quota". Over that, users see "Error 403: rate_limit_exceeded". [Google, setup page and https://support.google.com/cloud/answer/9028764]
- Real-world: a backfill running beside an hourly sync "pushed the account over Google's per-minute quota". [Community, HealthLog #1196]
- Pact's poll (one call per waiting account per minute, plus a refresh about once an hour) is far below 300 per user per minute and far below the project limits. With at most 100 users, polling is cheap. Webhooks would still cut the calls and the lag, at the cost of a public HTTPS route, signature checks, and an IAM-backed subscriber.

## 6. Gotchas from developers who migrated (Oct to Nov 2026)

- **Legacy shut-off.** Google: "September 30, 2026 (End of support)" and "November 2, 2026 (API turn-off) ... Requests to these endpoints fail and return an HTTP `410 Gone` status code." [Google, about page]. The help centre and the 410 body both say October 30. [Probe]: `POST https://api.fitbit.com/oauth2/token` now returns `410 {"errors":[{"errorType":"request","fieldName":"n/a","message":"The legacy Fitbit Web API and OAuth 2.0 endpoints were decommissioned on October 30, 2026. Please migrate your integration to the Google Health APIs: https://developers.google.com/health. ..."}],"success":false}`. The legacy sleep endpoint answers a fake token with `401 invalid_token`, so I couldn't see whether a real token gets 410 there. Home Assistant logged "410, message='Gone', url='https://api.fitbit.com/oauth2/token'" on 2026-11-03. [Community, https://github.com/home-assistant/core/issues/190247]
- **Re-consent.** "existing access and refresh tokens cannot be transferred, requiring users to re-consent". [Google, migration guide]. Not relevant to Pact, which has no Fitbit users yet.
- **Empty sleep.** From `list` instead of `reconcile` [Community, workoutlogger #13], and from filtering on `civil_start_time` [Community, OpenFit #10].
- **Missing civil times.** [Community, creinbold/health-sync, workoutlogger #13]
- **Hour-old tokens read as revoked.** A 401 after an hour was taken as a revoked grant; the fix: "Parking follows only a refused grant at the token endpoint". [Community, HealthLog #1196]
- **Overlapping sleep sessions** from re-syncs. [Community, HealthLog #1196, open-wearables #1853]
- **`ACCOUNT_NOT_LINKED`** handled explicitly. [Community, hhzks/sleep-visualisation #1]
- **Int64 fields are JSON strings** (`minutesAsleep: "407"`, `beatsPerMinute`). [Google, reference; Community, OpenFit #10]
- **New projects.** A project reported on 2026-10-22 that "Enabling the API on an existing Cloud project worked on 2026-10-09 despite the "not onboarding new projects at this time" note on Google's pages", and "We have not tried a project created from scratch". [Community, open-health-sync #206]. Sahha: "Even the Google Health API paused new project onboarding while it expanded access". [Community, https://sahha.ai/blog/health-api-shutdowns-lessons/]. I found no such note on Google's pages today (the about, setup and get-started pages). Unknown whether a brand-new project can enable the API.
- **Scope renames** (`.sleep` became `.sleep.writeonly`, 2026-05-26). [Google, release notes]
- I found no reports of a 410 from the new API, of sleep lacking `startUtcOffset`, or of a forced re-consent on the new API.

## 7. Policy that touches Pact

[Google, https://developers.google.com/health/policies/health-api-developer-user-data-policy, effective 2026-03-24]
- Approved use cases include apps "allowing users to directly journal, report, monitor, and/or analyze their ... sleep". Pact plausibly fits.
- "Only transfer user data to third parties: To provide or improve your appropriate use case or features that are clear from the requesting application's user interface and only with the user's consent". "Do not allow humans to read user data, unless: The user's explicit consent to read specific data is obtained". Pact shows reviewers Kept/Missed and the bedtime. The connect screen needs explicit consent to that.
- The in-app disclosure "Must be within the application itself if application-based or in a separate dialog window if web-based", "Cannot be placed only in a privacy policy", and "must accompany and immediately precede a request for user consent".
- A privacy policy is required, plus an affirmative Limited Use statement in the app or on its website, e.g. "The use of information received from Google Health API ... will adhere to the Google Health API Developer and User Data Policy, including the Limited Use requirements."
- "Keeping user data and credentials, specifically tokens such as OAuth access and refresh tokens, encrypted at rest." Pact already encrypts Oura tokens with a key from config (`src/server/config.ts`).
- "You must provide user help documentation that explains how users can manage and delete their data from your app."
- "Note: All apps that integrate with Google APIs are required to comply with Google's API Services User Data Policy regardless of whether they have been verified." [Google, https://support.google.com/cloud/answer/13464323]
- Terms: "your API Client storing data at the same level of granularity as it is collected (e.g., if you access step count on a per-minute basis, you should not aggregate and store it only as a daily total if the platform supports the finer increment)". [Google, https://developers.google.com/health/policies/health-api-developer-terms-and-conditions]. Pact stores one bedtime per night. Probably harmless, but a reviewer could ask.
- App naming: don't put Google product names in the app name. [Google, https://support.google.com/cloud/answer/10311615]

## 8. Separately: Fitbit sleep into Apple Health (Google Health iOS 5.05)

- Google's help page lists Sleep "Sleep session, Sleep stages" under "Data types that Google Health can write to Apple Health". Needs iOS 16.4 or later and an adult Google account. Set up under Connections, Apps and services, Apple Health. [Google, https://support.google.com/googlehealth/answer/17037331]
- Version and date: "Version 5.05 of the Google Health app", 2026-08-03; "some data such as HRV doesn't transfer over". [Community, https://www.macrumors.com/2026/08/03/fitbit-apple-health-syncing/]
- Start/end times: an Apple Health sleep sample always has a start and end, and stages are written as stage samples. So start, end and stages should arrive. I found no first-hand report checking what the written samples look like (in-bed vs asleep, source name, time zone).
- Background: not documented. Google says the Fitbit syncs in the background every 15 minutes while the app runs (section 4). A third-party guide's only advice is to turn on Background App Refresh for Google Health. [Community, https://biomon.io/guides/google-health-not-syncing-to-apple-health/, updated 2026-11-08]. Whether the iOS app writes to HealthKit from the background, or only when opened, is unknown. iOS background refresh is best effort, so expect delays.

## What this means for Pact's code

Pact has no Fitbit code yet. Against the current Oura-shaped core:

1. `OuraSleepPeriod` in `src/core/ports.ts` carries `bedtime_start` as an ISO string with offset and a `type` of `long_sleep`. A Google adapter would build `bedtime_start` from `startTime` + `startUtcOffset` (`"-14400s"` to `-04:00`), and map `metadata.mainSleep === true && !metadata.nap` to the role `long_sleep` plays.
2. `OuraDateRange` is a pair of dates on bedtime start. Google filters on end time only. The adapter must widen the window by the longest plausible sleep, page by 25, and filter on start locally.
3. `judgeNights` in `src/core/bedtime.ts` keeps the first `long_sleep` that starts in the night. That suits Google too, since the first-seen bedtime can't be moved by a later edit. But a manual entry or an edit made **before** Pact first sees the night could set any bedtime. Use `dataSourceFamily=google-wearables` on `reconcile` and treat `metadata.manuallyEdited` as not counting (or as Missed).
4. `mainSleep` may only be set by `reconcile`, and its "day" isn't defined. A short main sleep (under 3 hours) has `stagesStatus: REJECTED_NAP` and maybe `nap: true`. Decide what a night with only a short sleep counts as.
5. Error mapping: `401` is an expired access token (refresh once, then retry). Only `invalid_grant` from the token endpoint means "reconnect". `400 FAILED_PRECONDITION ACCOUNT_NOT_LINKED` means "open the Google Health app and sign in", not "reconnect". `429/503/504` mean back off.
6. Connect flow: request only `googlehealth.sleep.readonly` with `access_type=offline` (and `prompt=consent` on reconnect, to get a fresh refresh token). After the exchange, call `GET /v4/users/me/identity` and store `healthUserId`. Check that `scope` in the token response contains the sleep scope.
7. Disconnect should revoke the Google token (`POST https://oauth2.googleapis.com/revoke`). [Google, web-server page] It won't free a user-cap slot, since the cap is lifetime, but it is still good practice.
8. Use a separate Cloud project for development, since dev and test accounts eat into the production project's 100 lifetime users. Google recommends separate projects anyway. [Google, setup page]

## Still unknown: needs a real account

- Whether a brand-new Cloud project can enable `health.googleapis.com` today.
- Whether a project published "In production" while unverified keeps working beyond one user and beyond a few weeks. Whether Google ever flags or blocks such a Google Health project.
- Exactly what the unverified warning looks like for a restricted health scope, and whether every user can click through (Advanced Protection or child accounts may be blocked).
- How the 100-user cap counts: per Google account that ever consented, including revoked ones (Google says lifetime, can't reset).
- The real `expires_in`, and whether `refresh_token_expires_in` ever appears for a published client.
- A real sleep record: whether `civilStartTime` is present, how `mainSleep` and `nap` look on a normal night and on a nap, and how often `processed` is false at first sight.
- How soon after waking a sleep appears through the API, with the app in the background, on Fitbit and on Pixel Watch (Bedtime mode).
- How often a sleep changes after first appearing (start time, `mainSleep`, merges, deletes), and whether `dataPointName` survives a change.
- Whether any sleep fields are withheld from non-Premium users (none documented).
- Whether webhooks work for an unverified client, and which retention (24 hours or 7 days) is true.
- What the iOS app writes to Apple Health for a night, and whether it writes in the background.
