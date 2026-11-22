# Pull to refresh

Current rules: `docs/behaviour.md`. This spec records the design as it was decided.

Settled in a grilling session on 2026-11-22. The indicator was chosen from a prototype: branch `prototype/pull-to-refresh`, file `src/client/prototype/pull-to-refresh.html` (three styles, A, B and C; B was chosen).

## Problem statement

Pact runs as an installed web app on my iPhone, which has no pull to refresh of its own. When I finish my Anki deck on my laptop, or a reviewer decides something, the screen I have open doesn't change. Today checks AnkiWeb and Oura only when it opens or when the app comes back to the front, so I close and reopen the app to make it look again. I want to pull down on a tab to get fresh data, as on Twitter or in Mail.

## What the server already does

These facts shaped the design:

- The server asks Oura for every night still waiting on data at each scheduler tick, once a minute. So Pact is rarely more than a minute behind Oura's servers. A night with no data is almost always waiting on the ring or the Oura phone app, which a pull in Pact can't speed up.
- The server checks AnkiWeb once an hour, and every 10 minutes in the last hour before the due time. A pull helps most here.
- The core ignores a check now from the same account less than 15 seconds after the last one, for Oura and AnkiWeb alike.

## Solution

Each of the four tabs (Today, Pacts, Review, Ledgers) has pull to refresh. Pulling down at the top of the tab and letting go past a threshold reloads the tab's data. On Today it first asks Oura and AnkiWeb for new data. A thin line under the header shows the work.

## User stories

1. As an owner, I want to pull down on Today to make Pact check AnkiWeb now, so that a deck I just finished on another device clears without closing the app.
2. As an owner, I want the same pull to check Oura for a night not judged yet, so that a night the Oura app just synced counts at once.
3. As an owner, I want to pull down on Pacts, Review and Ledgers to reload them, so that a reviewer's decision or a new item shows without leaving the tab.
4. As an owner, I want each card to show its own check ("Checking Oura…", "Checking AnkiWeb…"), so that I see which service Pact is asking.
5. As an owner, I want to hear when a check I asked for couldn't reach AnkiWeb or Oura, so that I don't mistake an outage for an unfinished deck.

## Decisions

### Where

- The four tabs only. Pages opened from a tab (a pact's page, a ledger, an evidence item) don't get it; they load afresh each time they open. A later change can add them with the same code.
- Touch only. Desktop gets no gesture and no refresh button: the browser's own reload does the same.
- A pull starts only when the tab is scrolled to the top. A pull while a refresh runs is ignored.

### What a pull does

- Every tab reloads its own data, as its `reload` does now: what was loaded stays on screen until the new data comes, and a failed reload shows the existing "couldn't load" line. A pull forgets nothing else loaded, like the app's other checks.
- Today first sends **check Oura now** and **check Anki now**, then reloads when both have answered. It sends them whatever cards it shows: the core already asks Oura only for nights not judged yet, and AnkiWeb only for days still to do. It skips a service whose connection needs reconnecting, as the automatic checks do.
- A pull within 15 seconds of the last check of a service: the core skips that check and says nothing. Today reloads as usual. The Anki card keeps the time of the last real check ("Checked 8:12am"), so it never claims a check that didn't happen. The answer doesn't report the skip, and Today shows no "Checked just now".
- A pull doesn't update the app to a new version.

### The indicator (prototype style B)

- While the finger pulls, the tab's content follows it with resistance, and a line under the header grows from the left in proportion to the pull. It is full width at the threshold.
- On letting go past the threshold, the content springs back at once, and the line becomes a moving bar under the header. The tab can be scrolled while it runs. The bar stays until the checks and the reload have finished, then goes.
- Letting go before the threshold springs the content back and does nothing.
- The bar moves whatever the phone's Reduce Motion setting says. This differs from the app's existing spinners, which stop under Reduce Motion; those keep their rule.
- No words in the indicator. "Up to date" would claim more than Pact knows when Oura's servers don't have last night yet.

### Feedback on the cards

- Today's cards show each check as they do now: the No Oura data card shows its "Checking…" chip and "Checking Oura…", and the Anki card shows "Checking AnkiWeb…" with its spinner.
- An Anki day the check finds finished leaves Today, as a Satisfied day does now. No extra confirmation.
- A night Oura still has no data for keeps its card and its line "Sat night hasn't synced yet. Open the Oura app to sync it."
- A night Oura now has is judged; its card leaves No Oura data, and tonight's night shows under Automatic.

### A check that can't reach the service

- When a check sent by a pull can't reach AnkiWeb or Oura (a timeout, a network failure, or the Anki check script failing), the card says so under its last check: "Couldn't reach AnkiWeb. Pact will try again." or "Couldn't reach Oura. Pact will try again." It stays until a check of that service succeeds.
- The check endpoints' answers report this failure. Today, `POST /api/oura/check` and `POST /api/anki/check` answer `{ ok: true }` whatever happened.
- Only checks sent by a pull show it. The automatic checks (on opening Today, on coming back to the front, and the scheduler's) stay silent, as now.
- A refused login and a protocol error keep their current handling and show no such line. A refused login marks the connection Needs reconnecting, and Today shows its alert. A protocol error (AnkiWeb answering in a way Pact doesn't understand) raises its operator alert.
- No operator email for unreachable services: a short outage is nobody's to fix.

## Out of scope

- Pull to refresh on pages opened from a tab.
- A refresh button for desktop or mouse users.
- Updating the app on a pull.
- Telling the owner a check was skipped by the 15-second limit.
- A confirmation when a pull finds the deck finished.
- Showing when Oura last had data.

## Testing decisions

- Core: the check commands report a failure to reach the service, and report none when the check is skipped or there is nothing to check. Tested in `oura.test.ts` and `anki-days.test.ts` with fake sources that throw.
- Client: a pull on Today sends both checks, then reloads; a pull on the other tabs only reloads; a pull while one runs is ignored; a failed check sent by a pull shows the line on its card until a check succeeds. Tested with the existing client test setup by firing touch events on the scroll area.
- The gesture's feel on a real iPhone, inside the installed app, is a manual check (`manual-checks.md`): the pull must not fight iOS's own bounce on the scroll area.
