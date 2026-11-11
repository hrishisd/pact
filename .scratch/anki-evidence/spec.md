# Anki evidence kind

Current rules: `docs/behaviour.md`. This spec records the design as it was decided.

Settled in a grilling session on 2026-11-05. It replaces the "Anki evidence kind" entry in `.scratch/pact-v0/spec.md`'s Future Ideas.

## Problem statement

I study Anki every day on my iPhone (AnkiMobile) and sometimes on my Mac, and both sync to AnkiWeb. I want a pact that costs me money on any day I don't finish my deck. Finishing should be detected automatically from AnkiWeb, with nothing to submit and no Mac running, the way Oura Ring pacts detect bedtimes.

## Solution

A third evidence kind, **Anki**. The owner connects their AnkiWeb account once and picks one deck per pact. A scheduled day is Satisfied the first time Pact sees that deck at New 0, Learn 0, Due 0 (Anki's "Congratulations! You have finished this deck for now") before the day's due time, and Missed otherwise. Pact's server reads the deck's counts by downloading the owner's collection from AnkiWeb with Anki's own `anki` Python package and asking it for the deck list counts.

AnkiWeb's terms of service only allow Anki's own clients to sync, and AnkiWeb may suspend accounts at its discretion. The owner accepted that risk for their own account. The connect step states it in one line, so anyone else who connects knows the risk too.

This spec uses **Satisfied** for what v0 calls Kept. Ticket 01 renames it everywhere first.

## User stories

1. As an owner, I want to pick Anki as a pact's evidence kind, so that finishing my deck each day is checked automatically.
2. As an owner, I want picking Anki to take me to connecting AnkiWeb when I haven't yet, with my username and password, and a plain line saying AnkiWeb doesn't officially allow other apps and could suspend my account, so that I decide knowing the risk.
3. As an owner, I want Pact to keep only what it needs to check my decks, never my password, so that a leak of Pact's database doesn't leak my AnkiWeb password.
4. As an owner, I want to pick the deck by name from my own deck tree, with subdecks counted in their parent, so that one pact covers a whole subject.
5. As an owner, I want renaming or moving the deck in Anki not to break the pact, so that I can tidy my decks freely.
6. As an owner, I want an Anki pact on Fixed days, with an optional due-by time that defaults to midnight and can't be later than my Anki day's rollover hour, so that "Tuesday" means Tuesday's Anki reviews.
7. As an owner, I want a day Satisfied as soon as Pact sees my deck finished before the due time, and it stays Satisfied even when a learning card comes back later that evening, so that I see the result right after I sync.
8. As an owner, I want the Today card to show how many cards are left as of the last check and when that check was, plus the due countdown, so that I know whether Pact has seen my latest sync.
9. As an owner, I want opening Today to check AnkiWeb straight away, so that a deck I've just finished and synced clears without waiting.
10. As an owner, I want my reminders for an Anki pact to fire while the deck isn't finished, and to say how many cards are left, so that a reminder tells me how much work remains.
11. As an owner, I want a day whose deck isn't finished by the due time counted as Missed, with the reason ("12 cards left at 11:50pm"), so that not syncing in time isn't a loophole.
12. As an owner, I want an alert in the app and on the pact, plus one notification, when AnkiWeb stops accepting Pact's login, and a Reconnect button on Profile, so that I can fix it before a day counts as Missed.
13. As an owner, I want an alert on the pact if its deck is deleted in Anki, so that I know why its days are being Missed.
14. As a reviewer, I want a change to an Anki pact's deck to come to me as a change request, so that the owner can't swap in an easier deck.
15. As a reviewer, I want Anki days judged automatically, with excuses and change requests still coming to me, as on Oura Ring pacts.

## Implementation decisions

### Terms

- **Deck:** one deck per pact, stored by Anki's deck id, shown by its current name. Subdecks count in their parent, which is how Anki's deck list counts them.
- **Schedule:** Fixed days only.
- **Due-by time:** optional, default midnight. Allowed values run from noon through the collection's rollover hour (Anki's "next day starts at", default 4am). A time up to the rollover hour is the morning after, counted as the evening's day. See Screens for the exact rule.
- **Finished:** New, Learn and Due are all 0, as Anki's deck list shows them for the deck, with the deck's daily limits applied.
- A later version can add "at most X cards left today", with X = 0 being v1's rule. Pact records all three counts on every check, so X will be a new term, not a data migration.
- Changing the deck after the edit window always needs a change request, because Pact can't tell whether another deck is stricter. An earlier due-by time is a stricter change and applies at once, as on Camera pacts.

### Judging

- An Anki day **D** runs from the rollover hour on D to the rollover hour on D+1, in the collection's timezone (Anki's stored `localOffset`).
- A check counts for occurrence D when its counts are for Anki day D and were evaluated before D's due time.
- Counts are evaluated **as of the owner's last answer** on Anki day D. Evaluating them at download time would show learning cards that came due after the owner stopped. With no answers on D yet, they're evaluated at the check time.
- The occurrence is **Satisfied** at the first such check that shows 0/0/0. A deck with nothing due that day is Satisfied at the first check.
- At the due time, an occurrence with no 0/0/0 check is **Missed**. There's no grace period for a late sync. That includes days when Pact couldn't reach AnkiWeb or the connection was broken. The 48-hour excuse window covers those.
- **Honor system.** Pact doesn't look for burying, suspending, "Set due date", lowered limits or moved cards. The research below lists the traces each one leaves, if a later version wants to.

### Checking AnkiWeb

- Pact checks while an account has an Anki day that's open and not judged: every 10 minutes, from the rollover hour until the due time. It stops once every such day is judged. An account with no Anki day waiting causes no calls.
- Opening Today, or bringing it back to the foreground, sends **check Anki now** while it shows an Anki card that isn't judged. The core ignores a check less than 15 seconds after the last one for that account, as for Oura.
- Each check first asks AnkiWeb whether the collection changed since the last download (`sync_status`, one small request). It downloads the collection, without media, only when that check says something changed. Otherwise it recomputes counts from the copy it already has.
- One check per account at a time. Several Anki pacts on one account share one check.
- AnkiWeb calls happen before the core's write transaction, never inside it, as for Oura.
- A rejected login (AnkiWeb answers with an auth error) marks the connection **Needs reconnecting** once, with one alert and one push (the Connection problem notification setting). Pact doesn't check again until the owner reconnects.
- A timeout, a 429, a 5xx or a protocol error is a failed check. It's logged and retried on the next tick, and never marks the connection. A protocol error also logs an `OPERATOR_ALERT`, because it usually means AnkiWeb changed its sync protocol and the pinned `anki` package needs updating.
- A deck that no longer exists in the collection shows an alert on the pact. Its days are judged Missed at their due times and can be excused.

### Connection

- The **Connect AnkiWeb** step asks for the AnkiWeb email and password and shows the terms-of-service line. Pact trades them for AnkiWeb's host key with `sync_login`, then discards the password.
- Pact stores the host key and AnkiWeb's sync endpoint, encrypted with a key from the server's config, as Oura tokens are. The host key can write to the owner's collection, so the adapter only ever calls the change check and the download, never upload or sync.
- It keeps the last downloaded collection per account on the volume, outside `pact.db`, and deletes it on disconnect.
- Profile lists the connection with its status and a Reconnect button. Disconnect warns how many Active pacts use it, as for Oura.

### Adapter

- A new `AnkiSource` port in the core:
  - `decks(account)` returns `{ id, name, parentId }[]` plus the collection's rollover hour, or "disconnected".
  - `deckCounts(account, deckId)` returns `{ new, learn, review, ankiDate, asOf }`, or "disconnected", or "deck-missing". `ankiDate` is the calendar date the Anki day started on, and `asOf` is the moment the counts were evaluated at.
  - As built, `deckCounts` takes several decks at once and `decks` returns each deck's counts. Ticket 03's Comments say why.
- The production adapter runs a small Python script with Node's async `execFile`, with a timeout and an `AbortSignal`. It sends JSON on stdin and reads JSON from stdout.
- The script uses the `anki` package and follows these rules:
  - Open the collection with `server=True`. Otherwise Anki writes the server's UTC offset into the collection's config.
  - Run `sync_status` on a fresh backend each time (it caches answers for 5 minutes per backend). Follow `new_endpoint` when AnkiWeb redirects.
  - Download with `full_upload_or_download(upload=False, server_usn=None)`, which skips media.
  - Compute counts with `col._backend.deck_tree(now=as_of)` and `find_deck_in_tree`. `as_of` is the last revlog entry on the Anki day, or the check time.
  - Never call `sync_collection`. It unburies cards and pushes local changes back to AnkiWeb.
- The Docker image gains Python 3 (bookworm ships 3.11) and a pinned `anki` wheel. The wheel needs glibc 2.35 or later, and bookworm has 2.36.
- The core's tests use a fake `AnkiSource`. The real adapter is checked by hand against a real AnkiWeb account (`manual-checks.md`).

### Screens

These are settled by the prototype in ticket 02, published as the private artifact "Pact Anki Prototype". The fixed points are:
- **Source:** a third tile, Anki.
- **Connect AnkiWeb step:** after Source when there's no connection.
- **Goal step:** a deck picker that shows deck names only, with the pact's name filled in from the deck until the owner changes it.
- **Reviewers and Reminders text:** an Anki pact has nothing to review, and its reminders fire while the deck isn't finished.
- **Today:** an Anki card showing cards left, when Pact last checked, the due countdown, and "Checking AnkiWeb…" while a check runs.
- **Missed reason:** for example "Tue Nov 3 · 12 cards left at 11:50pm" or "· AnkiWeb not reached".

The human picked these from the prototype:
- **Deck picker:** an indented tree with every deck visible, not drilling down one level at a time.
- **Today counts:** one total ("42 cards left"), not Anki's New, Learn and Due columns.
- **Finished day:** it leaves Today at once, as a Camera card does once its evidence is in. The next day it shows under Yesterday.
- **Chip:** the open Anki card's chip is "To do", not "Automatic".

The due-by rule was decided while building ticket 03:
- A due-by time is due after the Anki day opens and no later than it ends: after max(noon, the rollover hour) on D, or by the rollover hour on D+1. 00:00 is midnight, the default.
- A time from noon and after the rollover hour is on D. A time up to the rollover hour is the morning after, D+1.
- Any other time is refused, such as 9am with a 4am rollover. With a rollover after noon, such as 2pm, no time is refused: 1pm is 1pm on D+1.
- A reminder before the rollover hour goes off the morning after. One from the rollover hour on goes off on D, so a 9am reminder with a 4am rollover goes off at 9am on D.

## Testing decisions

The same seam as v0: core scenarios with a fake `AnkiSource` and the fake clock. Ticket 03 lists the scenarios. The Python script and the real AnkiWeb path aren't tested in CI. They're thin adapters, checked by hand.

## Out of scope

- Grace for a late sync, judged from answers made before the due time.
- Detecting gaming (bury, suspend, reschedule, lowered limits, moved cards).
- Weekly count and One-time schedules for Anki.
- "At most X cards left" goals.
- Several decks per pact (pick the parent deck instead).
- Running Anki's own sync server in Pact instead of reading AnkiWeb.

## Research

Two research passes on 2026-11-05 read `ankitects/anki` at `d88ae6e` and installed `anki` from PyPI. The second also ran Anki's own sync server locally to test downloads. Neither touched the real AnkiWeb, whose server is closed source, so its behaviour is inferred from the reference server.

- **AnkiWeb has no public API.** Its terms (https://ankiweb.net/account/terms) say only approved clients (Anki, AnkiMobile, AnkiDroid, AnkiUniversal) may sync, and that it "does not currently allow access from browser extensions or other third-party clients". Anki's developer said in 2023 that programmatic access "is not currently supported" (https://forums.ankiweb.net/t/accessing-ankiweb-w-py-requests/32166), and in 2024 helped debug `sync_login` from a script (https://forums.ankiweb.net/t/unable-to-sync-login-via-anki-python-pkg-to-ankiweb/43092). The research found no public case of a suspension.
- **Login:** `POST /sync/hostKey` with the real username and password returns a host key (`rslib/src/sync/login.rs`). There's no scoped token. Desktop Anki keeps the key until AnkiWeb rejects it. When AnkiWeb's keys expire is unconfirmed, though a password change probably invalidates them.
- **Side effects of a download** (reference server): it aborts any sync in progress, so a phone syncing at that moment fails once. It also bumps the server's usn and `mod`, so the owner's devices do one extra small incremental sync. It doesn't force a full sync.
- **Other routes considered:**
  - AnkiConnect and desktop add-ons only run on desktop.
  - AnkiMobile has no URL scheme or Shortcuts action that returns counts.
  - AnkiDroid's ContentProvider exposes counts only to Android apps.
  - AnkiWeb's own web app fetches deck counts from `/svc/decks/deck-list-info` with a session cookie. That's undocumented, under the same terms problem, and has no review log.
  - Anki's sync server, self-hosted by Pact, is legitimate, but the owner would give up AnkiWeb.
- **Traces of gaming, should a later version check them:**
  - Bury and suspend change the card's queue to -1, -2 or -3 and leave no review log entry.
  - "Set due date" and Forget add a review log entry of type 4.
  - Moving cards changes their deck (`did`), or sets `odid` for a filtered deck.
  - Lowering limits changes the deck config's `mtime_secs`.
  - A negative custom-study limit shows up as "studied today" counters higher than the review log for that day.
