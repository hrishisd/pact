# 03 Anki deck pact: connect, create and judge

Status: ready-for-agent
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

- [ ] Rollover 4am, due midnight. A check on Tue 21:10 shows 0/0/0 with `ankiDate` Tue, so Tue is Satisfied at once. A check at 22:30 showing Learn 1 doesn't change it.
- [ ] Tue checks show 12 left at 23:50 and nothing finished, so Tue is Missed at midnight with "12 cards left at 11:50pm".
- [ ] A 0/0/0 check at Wed 02:00 with `ankiDate` Tue doesn't satisfy Wed.
- [ ] A check whose `asOf` is after the due time doesn't satisfy the day.
- [ ] No check reached AnkiWeb on Tue, so Tue is Missed with "AnkiWeb not reached".
- [ ] No answers yet on Tue, and the deck has nothing due, so Tue is Satisfied at the first check.
- [ ] Polling: an account with an Anki day waiting gets one check per 10 minutes. Once the day is judged, it gets none until the next Anki day opens. An account with no Anki pact gets none.
- [ ] Check now 10 seconds apart makes one call, and 16 seconds apart makes two.
- [ ] Two Anki pacts on one account share one check per tick.
- [ ] A failed check (the adapter throws) is logged, judges nothing, and is retried on the next tick.
- [ ] The edit window rejects changing the evidence kind, and accepts a due-by time up to the rollover hour while rejecting one later.
- [ ] Server routes: connect with good and bad credentials, deck list, and check now (`src/server/app.test.ts`).

## Manual checks

Add to `../manual-checks.md`:
- the first real login
- a real deck list
- finishing on the iPhone, syncing and seeing Satisfied within 10 minutes
- the owner's devices still syncing normally afterwards

## Comments
