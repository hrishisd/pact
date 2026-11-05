# 09 No Oura data card, check now, 3pm push and disconnection

Status: ready-for-agent
Blocked by: 05, 07, 08

Spec stories: 37, 38, 41, 93 (Reconnect), 94. Rules: Judging bedtime pacts (disconnected, 15:00 push), Oura polling (check now).

## What to build

Make the gap between waking up and Oura syncing visible and cheap to fix, and handle a broken connection without judging the night early.

### No Oura data card
- At the very top of Today (after alerts), in orange: last night's bedtime while Oura hasn't reported it, e.g. "Tue night hasn't synced. Open the Oura app." and "Counts as missed at 6pm · 5h 20m".
- Tonight's deadline rides on this card instead of a separate Automatic card.
- **File excuse** button on the card; an excuse filed for that night moves it to Waiting for approval.
- No "Open Oura" button until a working link to the Oura iOS app is found (check while here; record under Comments).

### Check now
- Today sends **check Oura now** when it opens or returns to the foreground while it shows a No Oura data card, then every 30 seconds while the card is on screen. The card shows "Checking Oura…" while a check runs.
- The core ignores a check less than 15 seconds after the last one for that account.

### 3pm push
- At 15:00 on D+1, a night still not judged sends the owner one push (Connection problem kind).

### Disconnection
- A "disconnected" result (token revoked or expired, membership lapsed / 403) marks the connection **Needs reconnecting** once, with one alert in the app and on the pact, plus one notification. The connection isn't polled again until the owner reconnects.
- The night stays not judged until 18:00 on D+1, so reconnecting in time still lets the data count.
- **Profile → Connections:** status and a **Reconnect** button when needed.
- **Disconnect:** warns how many Active pacts use the connection before disconnecting; their nights count as Missed until reconnected.

## Acceptance criteria (core scenarios)

- [x] Wed 09:00, Tue night not judged → Today shows the No Oura data card first, with the 18:00 cutoff.
- [x] Two check-now calls 10 s apart → one Oura call; 16 s apart → two.
- [x] Still no data at 15:00 → exactly one data-source push, also across a restart; data arrives at 14:00 instead → no push.
- [x] Disconnected at 08:00 → one alert and one notification, no further calls; reconnect at 12:00 and data arrives → night judged from the data.
- [x] Disconnected and never reconnected → Missed at 18:00.
- [x] Excuse filed for the night from the card → card leaves the No Oura data section and shows under Waiting for approval.
- [x] Disconnect query reports the number of Active pacts using Oura.

## Comments

**Built on `claude/unblocked-tickets-prototypes-361pre` (2026-11-04).** Every acceptance criterion has a scenario in `src/core/oura-no-data.test.ts`; the routes are covered in `src/server/app.test.ts` ("connecting Oura"). Screens follow the v0 flows prototype's round 9 (`38d88ea`): the orange No Oura data card, "Checking…", the "Oura needs reconnecting." / "Oura is disconnected." alert with Reconnect Oura, and Profile's Disconnect warning.

**Open Oura link: found a candidate, not verified on a phone, so no button yet.** `https://cloud.ouraring.com/.well-known/apple-app-site-association` (fetched 2026-11-04) claims `/app/*` for the iOS app `CC7T4AQ3E5.com.ouraring.oura`, commented "General deep link routing, equivalent to the oura:// scheme". So `https://cloud.ouraring.com/app/` (or `oura://`) should open the app where it's installed; which path lands on the home screen, and what happens without the app, are unknown. Oura documents neither. To finish: on an iPhone with the Oura app, tap `https://cloud.ouraring.com/app/` from a Pact page (a link typed in Safari's address bar doesn't trigger universal links), and if it opens the app, add the button to the No Oura data card.

**Decided while building:**
- **Disconnected vs a transient error:** the adapter already answers "disconnected" only for no stored tokens, a refresh token Oura refuses (400/401), a 401 after one refresh, or a 403 (lapsed membership). A timeout, a 5xx or a broken page throws, which the core logs as no data this tick and retries next tick; it never marks the connection.
- A "disconnected" answer marks the connection Needs reconnecting only if it hasn't been reconnected since the call was asked, so a reconnect racing a tick isn't undone.
- **Check now** is rate-limited in memory per account (15 s, set before the call so two at once make one). A restart forgets it, costing at most one extra call. It only asks Oura for the account's nights waiting, only with a working connection, and judges only that account's nights.
- **The No Oura data card** shows from the night's in-bed-by time until it's judged or closes at 18:00, and not for a night with an excuse filed (waiting or approved). It sorts first, after alerts. Today stops checking while the connection is broken, and the card then says "Reconnect Oura to count it." instead of "Open the Oura app."
- **The 15:00 push** is one per owner and night (two bedtime pacts on the same night send one), kept in `no_oura_data_push_sent` so a restart doesn't repeat it. A night with an excuse filed gets none, and a scheduler that comes back after 18:00 judges the night first, so it sends none. With a broken connection it says "Reconnect Oura" instead of "Sync your ring". Both pushes are the new Connection problem notification setting.
- **Disconnect** deletes the connection row (it exists only once connected) and the adapter's stored tokens. While the owner has an Active bedtime pact and Oura isn't connected (Needs reconnecting, or disconnected), Today and the pact page show the alert with Reconnect Oura, so a deliberate disconnect still has a way back. Profile shows the Active pact count only in the Disconnect warning; its row keeps main's "Connected Tue Nov 3".
- **Reconnect** starts at `/api/oura/connect?then=today` and Oura's callback returns to Today (`/?oura=…`), where a failed or unavailable reconnect shows under the alert.
- The tonight line on the card uses the Automatic card's wording ("Tonight, in bed by 12:00am · 3h 12m"), not the prototype's "Tonight: in bed by".

**Fixed 2026-11-05:** the File excuse sheet opened from the card used to label the night "Not judged yet". It now says "No Oura data", as the spec's Occurrence labels and the heat map do.

- 2026-11-04: Built on branch claude/unblocked-tickets-prototypes-361pre. Pending human review and a real-ring check together with ticket 08, so Status stays ready-for-agent. Core scenarios are in src/core/oura-no-data.test.ts.

- 2026-11-04: The real-ring and Open Oura link checks are in `.scratch/pact-v0/manual-checks.md` (Oura Ring section).

- 2026-11-05: `DayChip` and `dayNote` take an `oura` flag, so a bedtime night past its in-bed-by time with no excuse reads "No Oura data" in the File excuse sheet (day card, Which day? rows, covered-day lists). The heat map uses the same chip instead of its own special case.
