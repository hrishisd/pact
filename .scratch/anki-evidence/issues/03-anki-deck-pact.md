# 03 Anki deck pact: connect, create and judge

Status: ready-for-agent

Built in af6f053 on `claude/anki-ticket-03`, waiting for review. It becomes done once it's on `main`.
Blocked by: 01, 02

Spec: `../spec.md` stories 1 to 9, 11 and 15, and the Terms, Judging, Checking AnkiWeb, Connection and Adapter sections. The screens follow ticket 02's prototype.

## What to build

The happy path end to end: an owner connects AnkiWeb, creates an Anki pact on a deck, finishes the deck, and sees the day Satisfied. A day not finished by its due time is Missed.

### Core
- **Evidence kind Anki:** Fixed days only, a deck id term, and an optional due-by time no later than the connection's rollover hour.
- **`AnkiSource` port** and a fake for tests that serves decks and counts by account and deck, and can answer "disconnected" or "deck-missing".
- **An `anki_check` record** for each check: account, deck, new, learn and review counts, `ankiDate`, `asOf`, and `checkedAt`.
- **Judging:**
  - Occurrence D is Satisfied at the first check with `ankiDate` = D, `asOf` before D's due time, and 0/0/0.
  - At the due time without one, it's Missed. The miss records the last check's remaining count and time, or "not reached" when there was no check that Anki day.
- **Polling** on the scheduler tick: every 10 minutes per account while it has an Anki day open and not judged, from the rollover hour until the due time. **Check Anki now** has the 15-second floor per account. AnkiWeb calls run before the write transaction.

### Adapter
- `scripts/anki_check.py`, or wherever the Python lives (decide, and note it under Comments). It takes JSON on stdin and writes JSON to stdout, and supports three operations:
  - `login` (email, password, giving the host key and endpoint)
  - `decks`
  - `counts`
- It follows the spec's rules: `server=True`, a fresh `sync_status` on each run, a download without media only on change, `deck_tree(now=as_of)`, and never `sync_collection` or upload.
- **Node wrapper:** async `execFile` with a timeout and an `AbortSignal`. Run one check at a time per account, using a promise map like the Oura adapter's refresh map. Host keys are stored encrypted in an `anki_connection` table that only the adapter touches. Each account's collection copy lives under the data volume and is deleted on disconnect.
- **Dev stand-in:** like `devOura`, the dev stand-in reads decks and counts from a JSON file in the dev data directory, so the app runs locally without AnkiWeb. Document it in `docs/agents/local-dev.md`.
- **Dockerfile:** Python 3 and a pinned `anki` wheel in the runtime image. Put the version in one place and note in Comments how to bump it.
- **Config:** an Anki token key secret, checked like the Oura secrets (`check-fly-secrets`). Without it in production, Anki is unavailable and its Source tile is off, as Oura's is.

### Client
- The Source tile, the Connect AnkiWeb step, the deck picker on the Goal step, the Reviewers and Reminders text, and the Today card, all per the prototype.
- Today sends check Anki now when it opens or comes back to the foreground while it shows an Anki card that isn't judged.

### Docs
- Add **Anki** to the glossary's Evidence kind entry and AnkiWeb to Connection. Update `.scratch/pact-v0/spec.md`'s scope line about evidence kinds to point at `../anki-evidence/spec.md`.

## Acceptance criteria (core scenarios)

- [x] Rollover 4am, due midnight. A check on Tue 21:10 shows 0/0/0 with `ankiDate` Tue, so Tue is Satisfied at once. A check at 22:30 showing Learn 1 doesn't change it.
- [x] Tue checks show 12 left at 23:50 and nothing finished, so Tue is Missed at midnight with "12 cards left at 11:50pm".
- [x] A 0/0/0 check at Wed 02:00 with `ankiDate` Tue doesn't satisfy Wed.
- [x] A check whose `asOf` is after the due time doesn't satisfy the day.
- [x] No check reached AnkiWeb on Tue, so Tue is Missed with "AnkiWeb not reached".
- [x] No answers yet on Tue, and the deck has nothing due, so Tue is Satisfied at the first check.
- [x] Polling: an account with an Anki day waiting gets one check per 10 minutes. Once the day is judged, it gets none until the next Anki day opens. An account with no Anki pact gets none.
- [x] Check now 10 seconds apart makes one call, and 16 seconds apart makes two.
- [x] Two Anki pacts on one account share one check per tick.
- [x] A failed check (the adapter throws) is logged, judges nothing, and is retried on the next tick.
- [x] The edit window rejects changing the evidence kind, and accepts a due-by time up to the rollover hour while rejecting one later.
- [x] Server routes: connect with good and bad credentials, deck list, and check now (`src/server/app.test.ts`).

The core scenarios are in `src/core/anki-days.test.ts`. The server routes are under "connecting AnkiWeb" in `src/server/app.test.ts`, and the adapter is tested in `src/core/anki.test.ts`.

## Manual checks

In `../manual-checks.md` (After ticket 03), including:
- the first real login
- a real deck list
- finishing on the iPhone, syncing and seeing Satisfied within 10 minutes
- the owner's devices still syncing normally afterwards

## Comments

### 2026-11-05: built

- **Where the Python lives.** `src/core/anki_check.py`, run by `src/core/anki.ts` with `python -I`. It reads one JSON request on stdin and writes one JSON answer to stdout. The operations are `login`, `decks` and `counts`.
- **Errors.** An auth error is "disconnected" (or a wrong login, when connecting). A network or sync error is a failed check. Anything else is a protocol error, which is also a failed check and logs an `OPERATOR_ALERT`.
- **Pinned version.** `anki` and its dependencies are pinned in `src/core/anki-requirements.txt` (`anki==26.9.4`, from `pip freeze`). To bump it, change anki's version, install it in a fresh venv, replace the other lines with that venv's `pip freeze`, and run the manual checks. The Dockerfile installs it into `/opt/anki` and sets `ANKI_PYTHON`. The image build wasn't tried, because the session had no Docker daemon. It's in `../manual-checks.md`.
- **A port change from the spec.** `AnkiSource.deckCounts(account, deckIds[])` takes several decks and returns `{ ankiDate, asOf, decks: { id: counts | null } }`, so two pacts on one account share one check. A null is a deck that's gone. `decks(account)` returns each deck with its counts, which the Goal step shows.
- **Deck list and rollover hour.** The deck list is cached in `anki_deck_list`, and a new pact's deck must be in it. Each pact stores the rollover hour it was made with (`anki_rollover_hour`). Anki days are computed in the owner's Pact timezone, while `ankiDate` comes from Anki itself.
- **Due-by rule.** A due-by time is allowed from noon through the rollover hour. A time before noon is the morning after, and 00:00 is midnight, the default. A time after the rollover hour and before noon is refused. `../spec.md` (Screens) records it.
- **Missed reason.** It uses the last check's `checked_at`, as in "12 cards left at 11:50pm". The occurrence stores it as `anki_cards_left` and `anki_checked_at`.
- **Polling memory.** The last poll per account is kept in memory, so a restart costs one extra call. A check that throws is forgotten, so the next tick tries again. A "disconnected" answer is ignored for now; marking the connection Needs reconnecting is ticket 04.
- **Done early from ticket 04.** Reminders fire while the day isn't judged, with "42 cards left, due at midnight", or "Due at 2:00am. Not checked yet." before the first check. Profile shows an AnkiWeb row with Disconnect; Reconnect is still ticket 04. The change form shows the deck as fixed, since deck changes are ticket 04.
- **Shared encryption.** The encryption Oura used moved to `src/core/secret-box.ts`, and the Anki adapter uses it too.
- **Checked by hand** against Anki's own sync server (`python -m anki.syncserver`) in the session:
  - a wrong login is refused
  - the deck tree comes back with its subdecks, and with counts
  - the copy is reused when nothing changed, and downloaded again after the "phone" synced
  - the phone's next sync needed no full sync
- **Dev stand-in.** Documented in `docs/agents/local-dev.md`.
