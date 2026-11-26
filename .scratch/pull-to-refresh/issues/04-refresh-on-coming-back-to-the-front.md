# 04 Refresh when the installed app comes back to the front

Status: done
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

## Decisions

Settled with the owner on 2026-11-26 in a grilling session. No prototype: the only thing seen is the existing pull bar.

1. **When.** Pact reloads the shown screen when it comes back to the front (`visibilitychange` to visible) if the shown screen last loaded more than 10 minutes ago (a named constant), or if the local day, in the profile's timezone, differs from the day of that last load. "Last loaded" counts any refresh of the shown screen: opening it, a pull, or an automatic reload. Reason: what matters is how old the data is, not how long the app was away. The day rule catches a short gap across midnight and keeps the header and cards on the same day whatever the threshold.
2. **Midnight while open.** While the app is on screen, a timer to the next local midnight (profile timezone) runs the same reload. The header's date and the cards change together.
3. **What reloads.** What a pull runs on the shown tab (on Today, checking Oura and AnkiWeb, then reloading Today), and the Review badge. On a view page (pact, ledger, excuse, evidence, payment, change request) that page reloads. Form pages (New pact, Edit, Request change, Plan a vacation, Notifications) never reload by themselves.
4. **What it shows.** The pull bar under the header moves while the reload runs, as for a pull, on tabs and view pages alike.
5. **Failure.** A reload on coming back stays quiet if it fails: it tries once more after about 3 seconds, or as soon as the browser reports it is online, whichever comes first. Only if that second try fails does the screen show its usual "couldn't load" line. Oura and AnkiWeb checks in this reload never show "Couldn't reach Oura/AnkiWeb"; only a pull's checks do.
6. **A sheet is open.** While any sheet is open, the reload waits, and runs when the last sheet closes (if it is still due).
7. **Short trips.** Today's existing check of Oura and AnkiWeb on every return, while a No Oura data or Anki To do card shows, stays. When the long-gap reload also runs, Today checks each service once, not twice.
8. **A pull during the reload** waits for the running reload and shows the same bar; it doesn't start another.

## Acceptance criteria

- [x] The human has decided whether, and when, Pact reloads on coming back to the front, and what a failure then shows.
- [x] Coming back after a short gap reloads nothing; after more than 10 minutes or on a new day, the shown tab or view page reloads once, and the badge.
- [x] Form pages never reload by themselves.
- [x] The pull bar moves during the reload.
- [x] A failed reload stays quiet, retries once (after about 3 s or on `online`), and shows "couldn't load" only if the retry fails. No "Couldn't reach" line from this reload.
- [x] While a sheet is open, the reload waits until the last sheet closes.
- [x] Today checks Oura and AnkiWeb once, not twice, on a long-gap return.
- [x] A pull during the reload doesn't start another.
- [x] Today's header shows the new day after midnight, together with the reloaded cards, both on return and while open.
- [x] `docs/behaviour.md` says what coming back to the front does.
- [x] Phone checks added to `../manual-checks.md`.
- [x] `npm run check` passes.

## Comments

Built on 2026-11-26. Where the decisions left a choice, or met the code:

- **When "last loaded" is (1).** A screen counts as loaded when it opens, and when a try of its refresh that loaded settles, stamped with when that try started; a failed refresh, pulled or by itself, doesn't count, so the next return tries again. A refresh by itself that comes due while another runs (midnight during a pull) runs once that one settles, if still due. Today's header shows the date Today's response is for (`date`, decided by the core), so it is always the cards' day; until Today first loads, or if that load fails, it shows the clock's day in the profile's timezone, as before.
- **The badge (3).** The Review badge has its own due check by the same rule, since it shows on every page: it reloads on coming back and at midnight on forms too, once a return, and on pages opened over the Review tab, where only the Review tab itself, when shown, loads the queue instead.
- **The wait before the second try (5).** The bar keeps moving through the 3 seconds, since the refresh hasn't finished; a pull meanwhile is ignored. On Today the second try checks Oura and AnkiWeb again before reloading (the network may be back), still without "Couldn't reach".
- **A sheet open on Today (6 and 7).** On a return when Today is due a refresh, Today's own per-return check doesn't run, with or without a sheet: the refresh checks each service once, after the sheet closes if one is open.
- `useRefreshOnPull` is now `useRefresh`, since view pages register one but can't be pulled.
