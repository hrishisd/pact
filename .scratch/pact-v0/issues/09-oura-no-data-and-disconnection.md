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
- At 15:00 on D+1, a night still not judged sends the owner one push (data-source problem kind).

### Disconnection
- A "disconnected" result (token revoked or expired, membership lapsed / 403) marks the connection **Needs reconnecting** once, with one alert in the app and on the pact, plus one notification. The connection isn't polled again until the owner reconnects.
- The night stays not judged until 18:00 on D+1, so reconnecting in time still lets the data count.
- **Profile → Connections:** status and a **Reconnect** button when needed.
- **Disconnect:** warns how many Active pacts use the connection before disconnecting; their nights count as Missed until reconnected.

## Acceptance criteria (core scenarios)

- [ ] Wed 09:00, Tue night not judged → Today shows the No Oura data card first, with the 18:00 cutoff.
- [ ] Two check-now calls 10 s apart → one Oura call; 16 s apart → two.
- [ ] Still no data at 15:00 → exactly one data-source push, also across a restart; data arrives at 14:00 instead → no push.
- [ ] Disconnected at 08:00 → one alert and one notification, no further calls; reconnect at 12:00 and data arrives → night judged from the data.
- [ ] Disconnected and never reconnected → Missed at 18:00.
- [ ] Excuse filed for the night from the card → card leaves the No Oura data section and shows under Waiting for approval.
- [ ] Disconnect query reports the number of Active pacts using Oura.
