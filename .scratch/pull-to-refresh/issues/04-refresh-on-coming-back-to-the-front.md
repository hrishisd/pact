# 04 Refresh when the installed app comes back to the front

Status: needs-triage
Blocked by: none

From an outside audit of the code (finding F3, parts a and b), checked against the code on 2026-11-22. Parts c (the header's date format) and d (noticing notifications turned off in Settings) are fixed.

## In plain words

On the iPhone, iOS often keeps Pact in memory while you use other apps. When you switch back, hours later or the next morning, Pact shows exactly what it showed when you left: yesterday's To do card with "0h 0m" left, no sign of a decision that came in meanwhile, an old Review badge count, and Today's header still on yesterday's date. A pull to refresh fixes the screen, and so does tapping another tab and back, but nothing does it by itself. When iOS has closed Pact in the background, reopening it starts afresh and loads everything, so this only happens when iOS kept it.

Whether Pact should reload by itself, and when, is a design decision: the pull to refresh spec chose a manual pull for this staleness and says nothing either way about reloading on coming back.

## Evidence

- `useLoad` (`src/client/ui.tsx`) loads on mount and on `reload()` only. Neither it nor `Shell` (`src/client/App.tsx`) listens for `visibilitychange`. A temporary test rendered `<App/>` on Today with no Oura or Anki card and fired hidden then visible: today, pacts, reviewQueue, waitingOnReply and ledgers were each still called once.
- The only handlers for coming back are Today's `useCheckNow` (`src/client/Today.tsx`; checks Oura or AnkiWeb and reloads Today, and only while a No Oura data or Anki To do card shows) and `usePush` (`src/client/push.ts`).
- Tabs not shown are not stale: a tab remounts when tapped and loads afresh. What stays stale is the screen shown, the Review badge and the header.
- The Review badge (`useReviewCount`, `App.tsx`) loads only when the tab changes, and through Review's `onQueue`. The background reload after a command fills the remembered loads but doesn't set the badge (seen in the browser: the queue came back with one item and the badge stayed empty until a tab change).
- The header's date is worked out when `Shell` renders, from `new Date()`. Nothing re-renders `Shell` over time: a temporary test at Sat 23:59:58 New York, moved to Sun 00:01, still read Saturday after Today's one-second tick and after hidden then visible, until a tab change.
- Fixing only the header would be worse than now: Today's cards come from the loaded data ("Yesterday · Fri Nov 20"), so the header would show Sunday above Saturday's cards. The date and the reload belong together.

## Risks to weigh

- Reloading on every `visibilitychange` sends five GETs each time (today plus the four tab loads), and Today twice, because `useCheckNow` reloads it on the same event. Reloading the tab loads is pointless: visiting a tab reloads it.
- Right after an iPhone wakes, the network is often not ready. A failed reload shows "Today couldn't load. Check your connection and reopen Pact." above the cards (`Loaded`, `ui.tsx`), so reloading on every return would flash that line for no reason. Decide whether a reload on coming back shows it or stays quiet, and whether Today's checks then show "Couldn't reach …" (today only a pull's checks do).
- `visibilitychange` also fires when the user leaves for the camera and comes back, mid-task. Forms keep their state through a reload (`useLoad` keeps what is shown), but content can change under the finger.
- A shared in-flight map for loads (audit finding F11) was considered and rejected: it saves about 1 KB and 3 ms a command and makes it easy for a reload after a write to show data from before it. Don't fold it into this.

## A direction, if wanted

- Coming back after more than about 10 minutes, or on a new local day in the profile's timezone, runs what a pull runs on the shown tab (`useRefreshOnPull`'s registered refresh) and reloads the Review badge. A short trip away does nothing.
- `Shell` keeps the local day as state, updated on coming back and by a timer to the next local midnight; a new day updates the header and reloads the shown tab.
- Coordinate with `useCheckNow`, so Today loads once, not twice.
- For the badge alone, `useReviewCount` can register the reviewQueue reload with `reloadWhenForgotten` so that it also sets the count (about 3 lines).

## Acceptance criteria

- [ ] The human has decided whether, and when, Pact reloads on coming back to the front, and what a failure then shows.
- [ ] Coming back after a short gap reloads nothing; after a long gap or on a new day, the shown tab reloads once, and the badge.
- [ ] Today's header shows the new day after midnight, together with the reloaded cards.
- [ ] `docs/behaviour.md` says what coming back to the front does.
