# The scheduler's tick, the pact query and the test suite are slower than they need to be

Status: done
Blocked by: none

## Problem

Measured on a simulated 90-day database (10 accounts, 38 pacts): an idle scheduler tick takes about 96 ms, and the core's `pact(id)` query 17–23 ms (median). `npx vitest run` takes about 65 s, 57 s of it in `src/core/vacations.test.ts`, and its slowest test takes 4.25 s against Vitest's 5 s timeout.

A CPU profile of the tick puts `offsetMs` at 47% of its own time and `localDateOf` at 19% (`src/core/calendar.ts`). Both make a new `Intl.DateTimeFormat` on every call, and they run for every occurrence on every tick. A scratch experiment that kept one formatter per timezone cut the idle tick from 96 to 19 ms, `pact(id)` from 17 to 8 ms and the suite from 65 to 29 s.

Two smaller costs show in the same profile. `billsOf` (`src/core/money.ts`) reads `SELECT ... FROM penalty WHERE bill_id = ?` once per bill, 144 times in an idle tick's `remindOverdue` at day 90, and each read scans the whole `penalty` table, which only grows: its one index is `penalty_ledger` (owner, recipient). And `ctx.one` and `ctx.all` (`src/core/context.ts`) prepare their statement on every call: 683 prepares an idle tick, 11% of its own time, and the largest cost left once the formatters are kept.

The client refetches a tab's data on every visit, and shows nothing until it arrives: each tab switch or Back unmounts one screen and mounts another, whose `useLoad` starts blank. The server answers in 1–9 ms, so the blank is the network round trip, about 50–200 ms on a phone. The Review badge also fetched the queue on every tab change, twice on the Review tab.

## What to build

- Keep one `Intl.DateTimeFormat` per timezone in `src/core/calendar.ts` for `offsetMs` and `localDateOf`. Behaviour doesn't change and no test changes.
- Add an index on `penalty (bill_id)` in a new migration.
- Try reusing a prepared statement per SQL string in `ctx.one` and `ctx.all`. Keep it only if it cuts the suite by at least 3 s, or `vacations.test.ts` by at least 15%, measured twice each after the formatter cache; otherwise revert it and record what was measured. `CODING_STANDARDS.md` says statements are cached only when profiling says so.
- The client remembers what each read-only screen last loaded, by API path (`src/client/last-loaded.ts`); `useLoad(load, key)` starts from it and still loads afresh. Forms and pickers pass no key. Any command the user sends, and signing out, forgets everything; the app's own checks, push subscriptions and previews don't. The shell loads the other tabs once when it opens, and the badge shares the Review tab's load.

## Acceptance criteria

- [x] `offsetMs` and `localDateOf` reuse one formatter per timezone; every existing test passes unchanged.
- [x] `SELECT ... FROM penalty WHERE bill_id = ?` uses an index (`EXPLAIN QUERY PLAN`).
- [x] The statement cache is kept or reverted on the measured numbers, recorded below.
- [x] The client tab cache.
- [x] `npm run check` passes.

## Comments

2026-11-12: The server side is done; the client tab cache and `npm run check` for the whole ticket are left for the next agent.

- Formatter cache (`src/core/calendar.ts`): `offsetMs` and `localDateOf` each keep one formatter per zone in a module-level `Map`. `partsIn` (`src/shared/format.ts`) and `canonicalTimezone` (`accounts.ts`) still make one per call: they run when a notification's text is written or a timezone is set, not per occurrence on every tick, and weren't in the profile.
- Penalty index: migration 35 adds `penalty_bill` on `penalty (bill_id)`. `EXPLAIN QUERY PLAN` for `billsOf`'s read went from `SCAN penalty` to `SEARCH penalty USING INDEX penalty_bill (bill_id=?)`.
- Statement cache (`src/core/context.ts`): kept. `ctx.one` and `ctx.all` keep one prepared statement per SQL text; every SQL text they get is built from constants, so the map stays small. The context is made after `openDatabase` runs migrations, and nothing in the core changes the schema or calls `.iterate()`. Measured twice each against the formatter cache alone: the suite took 32.0 and 33.3 s without it and 26.4 and 27.5 s with it; `vacations.test.ts` 20.4 and 20.8 s without, 10.5 and 11.8 s with. `CODING_STANDARDS.md`'s settled decision says so.

Timings from `npx vitest run`, wall time on this machine:

| | Suite | `vacations.test.ts` |
| --- | --- | --- |
| Before | 67.7 s | 59.8 s |
| Formatter cache | 30.2 s | 20.2 s |
| And the statement cache | 26.4–27.5 s | 10.5–11.8 s |

The slowest test in `vacations.test.ts` was 4.25 s; it is now 0.51 s, and none is over 2 s.

On the simulated 90-day database, with the formatter cache (the scratch experiment's numbers, not measured again): an idle tick 96 ms to 19 ms, `pact(id)` 17 ms to 8 ms (median).

`docs/behaviour.md` needs no change: nothing a user sees changes.

2026-11-12: The client side is built.

- `src/client/last-loaded.ts` keeps what read-only screens last loaded, keyed by API path: `lastLoaded(key)`, `loadAndRemember(key, load)` (doesn't remember a load that began before the latest forgetting) and `forgetLoaded()`.
- `useLoad(load, key?)` starts from what was last loaded under `key` and loads afresh on mount and `reload()`; a failed reload keeps it shown with "couldn't load" above. Keys on Today, Pacts, Review's two loads, Ledgers, LedgerPage, the evidence, excuse, payment and change request pages, the Vacation and Friends sections and the Profile sheet's last vacation. No key for forms and pickers (EditPact, ChangePact, PlanVacation, the deck and reviewer pickers, NotificationsSection): they copy the data into what the user edits once. No key for PactPage either, because its at-once changes (name, reviewers, reminders) send the pact's whole terms back, and remembered terms could undo a change approved since (found in review; ticket 36 covers the same with a page left open).
- `api.ts`: `post` and `postForm` (the user's commands, `deletePact` included) forget everything once the answer comes back, refused, failed or not; `signOut` too. `postQuietly` forgets nothing: `checkOura`, `checkAnki`, `firstOccurrence`, `changePreview`, `vacationPreview`, `savePushSubscription`, `removePushSubscription`.
- The shell loads the tabs it isn't showing once when it opens, ignoring failures; the Review badge loads through `loadAndRemember` under the queue's path on each change to another tab, and not on the Review tab, which reports its queue through `onQueue`.
- Tests: `last-loaded.test.tsx` (a screen opened again, a failed reload, no key, after forgetting, a load that began before forgetting), `api.test.ts` (commands forget, refused or not; loads, checks and previews don't; signing out does). `npm run check` and `npm run test:e2e` pass.

In Chromium against a production build, signed in through the dev route, clicking Pacts, Review, Ledgers, Today twice, opening a pact and pressing Back: opening the app on Today loaded Today, the review queue, Pacts, waiting on reply and Ledgers once each. On every tab visit, both rounds, the screen's content was in the DOM right after the click (only microtasks between), the same length as after its reload landed; Back from the pact page likewise, right after `popstate`. (This run had PactPage keyed; it now loads afresh.) Each visit still sent its own GET (Pacts, Ledgers, Today: their own plus one review queue GET for the badge; Review: one queue and one waiting-on-reply GET, no second queue GET; before this change Review sent the queue twice). After submitting evidence on Today, Pacts opened blank and loaded afresh, and Today showed the day Waiting for approval, not To do. A development build (as `npm run test:e2e` leaves in `dist/`) shows every load twice: that is React's StrictMode, not this change.

2026-11-12: After review, PactPage loads afresh again (no key), with a test that a pact page opened again starts blank (`PactPage.test.tsx`). The Ledgers tab's Record a payment sheet now takes its ledger from the current data by recipient id, so `payableCents` follows the reload; the amount field is still seeded once. LedgerPage already passed the current summary on each render. No other keyed screen sends loaded data back in a command: the change request, excuse, evidence and payment pages, the Vacation section and Today's alerts and cards send only ids, and ExcuseSheet loads its pact itself, without a key.
