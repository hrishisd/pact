# Anki: what Pact keeps on disk, and how it reads AnkiWeb

A brainstorm, 2026-11-21. Nothing here is built or decided. It answers the owner's question: why keep the whole collection on disk, and could Pact do better?

Sources: `ankitects/anki` at tag `26.09.4` (paths below are under `rslib/src/`), the pinned `anki==26.09.4` wheel, and local experiments. The experiments ran against Anki's own sync server (`python -m anki.syncserver`) on localhost, never AnkiWeb. AnkiWeb's server is closed source, so wherever this says "the server does X", that is the reference server. AnkiWeb probably shares most of the code, but it is known to differ in places (`sync/http_server/mod.rs:149`: "This is not what AnkiWeb does").

## Terms

- **Collection:** one SQLite file holding everything: `notes` (the card text, in fields), `cards` (one row per card with its scheduling state: deck `did`, `queue`, `type`, `due`, interval), `revlog`, `decks`, `deck_config` (daily limits), `notetypes`, `config` (rollover hour, `localOffset`), `graves`, and one `col` row with the stamps below. Media (images, audio) live outside it, and Pact already skips them.
- **revlog:** the review log, one row per answer, kept forever. Pact reads only today's rows (`last_answer_today`).
- **mod / scm / usn / ls:** in the `col` row. `mod` is when the collection last changed. `scm` is the schema stamp, and changing it forces a full sync. `usn` (update sequence number) is the server's change counter. Every object stores the usn at which it last changed, and `-1` means "changed locally, not yet sent". `ls` is the time of the last sync.
- **Graves:** a table of ids of deleted cards, notes and decks, so a sync can tell other devices to delete them too.
- **Full sync** replaces the whole file (upload or download). **Normal (incremental) sync** swaps only objects whose usn is at or after the other side's last-sync usn.
- **Deck tree:** Anki's deck list with New/Learn/Due counts, daily limits applied (`decks/tree.rs:252`). **Learn-ahead:** learning cards due within 20 minutes count as due now.
- **Bury:** hides a card until the next Anki day. Anki "unburies" when it notices the day has rolled over.

## Why the copy exists today, and what it costs

Counting needs `cards`, `decks`, `deck_config` and `config`, plus today's `revlog` for the "as of the last answer" rule. The change check (`sync_status`) needs a local collection whose `col` row it can compare with the server's `meta` reply. `meta.rs:60-90`: the result is "no changes" if and only if `mod` is equal on both sides. Keeping the copy lets an unchanged check skip the download. Counting does not need `notes` or old `revlog`, but those are probably most of the file.

Costs that aren't obvious from the code:

1. **Pact's own downloads make more downloads.** The server's download handler bumps the server's usn and `mod` before sending the file (`sync/collection/download.rs:56`; `transact_no_undo` sets `mod`, `collection/transact.rs:22`). So the owner's next sync on any device, even an empty one such as opening AnkiMobile, becomes a real normal sync. That sync changes `mod` again, so Pact's next check downloads the whole collection again. Measured locally: after a Pact download the phone's `sync_status` is `NORMAL_SYNC`. Without the download it is `NO_CHANGES`. In practice Pact does about one full download per time the owner opens or closes a synced Anki app while a day is open.
2. **Memory.** The client reads the whole download into memory before writing it (`sync/http_client/io_monitor.rs:138`; `download.rs:32-38`). Peak memory use is about the collection's size, on a 512 MB machine.
3. **Leftover temporary files (possible).** A download goes to a `.tmpXXXXXX` file beside the copy and is then renamed (`download.rs:37-44`, `io/src/lib.rs:241`). The adapter's timeout kills the script with SIGTERM (`anki.ts`, `execFile` with `timeout`). Python dies without running destructors, so a download killed mid-way leaves its temporary file behind in `/data/anki/`. This is unconfirmed, but it could explain part of the 9.5%.
4. **Each `meta` call aborts a sync already in progress** on the reference server: `meta` runs through `with_col`, which calls `abort_stateful_sync_if_active` (`sync/http_server/handlers.rs:61-70`, `user.rs:26-34`). Polling every 10 minutes all day makes the owner's phone fail a sync now and then (it retries). A download does the same.
5. **Your note text sits on Pact's volume.** Spec story 3 says "keep only what it needs".

## Measurements on a synthetic collection

There's no real collection here, so `scratchpad/exp/build.py` built a heavy-user one: 20,000 notes ("Basic (and reversed)", so 40,000 cards, about 600 characters of fields each) and 400,000 revlog rows over 5 years. Real proportions will differ. The per-row costs are the useful part.

| Part | Size | Per row |
|---|---|---|
| revlog | 27.1 MB | ~68 B per answer, with indexes |
| notes | 21.7 MB | ~1.1 KB per note (scales with field HTML) |
| cards | 4.8 MB | ~120 B per card |
| everything else | < 0.1 MB | |
| **file** | **53.7 MB** | zstd-3 21.5 MB, zstd-19 17.3 MB, gzip 21.4 MB |

The pruned variants were counted with Anki's own deck tree at one fixed timestamp and compared with the original:

| Variant | File | zstd-3 | Deck tree counts | Last answer today |
|---|---|---|---|---|
| vacuum only | 51.6 MB | 19.5 MB | same | same |
| note fields blanked (`flds`, `sfld`, `csum`) | 32.1 MB | 14.8 MB | same | same |
| notes deleted | 30.1 MB | 14.3 MB | same | same |
| revlog older than 2 days deleted | 26.0 MB | 6.0 MB | same | same |
| **fields blanked + old revlog deleted** | **6.5 MB** | **1.3 MB** | **same** | **same** |
| the above + only one deck tree's cards | 2.9 MB | 0.6 MB | other decks show 0/0/0 | same |

Other timings: pruning through Anki's own connection plus `VACUUM` (`col.optimize()`) took 0.9 s. `pragma integrity_check` was ok afterwards and `col.mod` was unchanged, so the next `sync_status` still says "no changes". Opening the collection takes 0.07 s and `deck_tree` 0.01 s. zstd-3 of the 54 MB file takes 0.32 s to compress and 0.12 s to decompress.

## Options

### A. Prune the copy after each download (keep cards, decks, config, recent revlog)

**How:** in `fresh_copy`, after `reopen(after_full_sync=True)`, run three steps through Anki's connection: `update notes set flds='', sfld='', csum=0` and `delete from revlog where id < <start of the previous Anki day>`, then `col.optimize()`. Then check `mod` against its value from before pruning, and put it back with plain `sqlite3` if it changed. Don't prune or `VACUUM` with plain `sqlite3`: the indexes on decks, tags and notetypes use Anki's `unicase` collation, and an imitation could rebuild them in the wrong order.

**Saves:** most of the disk (54 → 6.5 MB in the sample). The owner's card text is no longer on Pact's volume. It saves no bandwidth or AnkiWeb requests, and doesn't help peak memory or peak disk, since the full download still lands first.

**Correctness:**
- The 0/0/0 rule and "as of the last answer": counts and the last answer were identical in every variant. The v3 deck tree reads `cards` with SQL, and reads limits and "studied today" from the deck objects, not from `revlog` or `notes` (`decks/tree.rs:252-290`).
- Renames, moves, subdecks, limits and rollover: unaffected, because every server change still triggers a fresh full download, which is then pruned again.
- Keep all cards. Dropping cards outside the pact's deck tree saves little (cards are about 120 B each), breaks the deck picker's counts, and breaks other pacts on other decks.

**Risks:**
- Low. The copy is never uploaded, so a pruned file can't reach AnkiWeb.
- It depends on Anki internals: a future `anki` version could read `notes` in `deck_tree` (none does today). The bump procedure in `anki-requirements.txt` should then compare counts before and after pruning.
- A later "detect gaming" feature (spec, Research) only needs today's revlog.

**Verdict: feasible, small (about 15 lines in `anki_check.py`), low risk.**

### B. Keep only derived metadata, and download when the counts must be recomputed

**How:** after a download, compute and store the counts (and the last answer), then replace the copy with a stub. The stub is an empty collection whose `col` row has the downloaded `mod`/`scm`/`usn`/`ls`. `sync_status` only compares `mod` and `scm` (`meta.rs:66-77`), and it skips the network if `mod != ls` (`backend/sync.rs:316-320`), so the stub needs `ls = mod`. Download again when the server changes, at the first check of each new Anki day, and, on a day with no answers yet, whenever a learning card could come due. To avoid that last case, Pact could precompute `deck_tree(now=t)` for each 10-minute tick left in the day. Future timestamps are accurate within the same day, but not across a rollover, because buried cards aren't unburied for future stamps (`decks/tree.rs:248-250`).

**Downloads in practice:** today's count (one per server change, inflated by the feedback loop above) plus one per account per Anki day. Under the "as of last answer" rule, counts after the owner's first answer depend only on the collection, so with no server change they never need recomputing that day.

**Saves:** all disk but ~100 KB. **Costs:** more AnkiWeb traffic, the opposite of the goal. The stub is also a hand-forged `col` row, more fragile than option A's real-but-pruned file.

**Verdict: feasible but not worth it.** Option A gets nearly the same disk saving without extra downloads.

### C. Delete the copy once the account's Anki days are judged

**How:** after the last open day is Satisfied or Missed, delete the copy. The next day's first check downloads.

**Saves:** disk only between judging and the next rollover. A day Satisfied at 9pm with a 4am rollover keeps the copy for about 17 hours a day anyway. **Costs:** one extra full download per account per day. It does keep less of the owner's data at rest, but option A already removes the sensitive part.

**Verdict: feasible, weak.** Not recommended on its own, and pointless after A.

### D. Compress the copy at rest

**How:** keep `copy.anki2.zst` and decompress to a temporary file for each check (SQLite can't read zstd). Recompress only after a download.

**Saves:** about 60% of a full copy (54 → 21.5 MB), or 6.5 → 1.3 MB after pruning. It costs ~0.1-0.3 s of CPU per check. Peak disk during a check is unchanged, because the decompressed file exists while counting. A crash also leaves another kind of temporary file to clean up.

**Verdict: feasible, low value.** Worth it only if A is rejected.

### E. Read-only incremental sync (pull the server's changes, never push)

This is the most interesting option and the riskiest.

**What a normal sync sends** (`sync/collection/normal.rs:121-143`), in order. The server keeps one session per user, and starting a session aborts any other (`user.rs:75-79`).

1. **`meta`:** read-only. It returns `mod`, `scm`, `usn` and the server time, and refuses if the clocks are more than 5 minutes apart (`status.rs:56-60`).
2. **`start {minUsn, lnewer, graves:null}`:** the server opens a transaction (`savepoint rust`), runs `unbury_if_day_rolled_over` inside it, and returns the server's **graves** with usn ≥ `minUsn` (`collection/start.rs:88-112`).
3. **`applyGraves`:** the client's deletions. A client sends it only if it has local graves (`start.rs:55-64`).
4. **`applyChanges {changes}`:** the client sends its changed notetypes, decks, deck config and tags. The server applies them and returns its own changes since `minUsn`, plus all of its config when the client isn't newer (`collection/changes.rs:315-325`). An empty `changes` writes nothing except `clear_config_usns`, inside the open transaction (`changes.rs:216-221`).
5. **`chunk` (repeated until `done`):** the server's cards, notes and revlog with usn ≥ `minUsn`, 250 objects per chunk. Read-only on the server: with `server=true` it doesn't touch usns (`chunks.rs:265-273, 402-407`).
6. **`applyChunk`:** the client's changed cards, notes and revlog. This is the write path.
7. **`sanityCheck2`:** the client sends its row counts and the server compares. Read-only. A mismatch drops the server's open collection, which rolls the session back.
8. **`finish`:** the server commits the transaction, increments its usn and sets `mod`/`ls` to now (`finish.rs:31-38`). This is the only step that makes the session permanent.
9. **`abort`:** the server drops its open collection, so SQLite rolls the transaction back (`user.rs:67-73`).

So a client that sends `meta`, `start` (with `lnewer: false` and no graves), `applyChanges` with empty changes, `chunk` until done, and then `abort` instead of `finish` receives every server change since its last pull and commits nothing on the reference server. It is also more read-only than today: a full download bumps the server's usn and `mod` (`download.rs:56`), and this pull bumps neither.

**How Pact could do it with Anki's own client code.** The `anki` package only exposes whole-sync calls (`SyncCollection`, `FullUploadOrDownload`, `SyncStatus`; `proto/anki/sync.proto:16-26`), not the individual steps. Rather than reimplement the client (applying notetype and deck JSON, graves and chunks into Anki's schema), Pact can run the unmodified client, `col.sync_collection(auth, sync_media=False)`, against a **deny-by-default proxy** on 127.0.0.1 inside the script:

| Client sends | Proxy |
|---|---|
| `meta` | forwards; keeps the reply's `mod` and `usn` |
| `start` | forwards with `lnewer: false`, `graves: null` |
| `applyChanges` | forwards with the body replaced by empty changes |
| `chunk`, `abort` | forwards |
| `applyGraves`, `applyChunk` | answers `null` itself, never forwards |
| `sanityCheck2` | answers `ok` itself, or forwards (see Drift below) |
| `finish` | sends `abort` upstream; answers the client with the server's `mod` from `meta` |
| anything else (`upload`, `download`, `hostKey`, media) | 403 |

The wire format is simple. Each request is a `POST {endpoint}sync/{method}` with header `anki-sync: {"v":11,"k":hostKey,"c":clientVersion,"s":sessionKey}` and a zstd-compressed JSON body. The response is zstd JSON with an `anki-original-size` header (`http_client/mod.rs:62-80`, `request/header_and_stream.rs:118-129`, `response.rs:20-45`). After the sync, the script sets the copy's `usn` to the `meta` usn and `mod`/`ls` to the `meta` mod. That way the next `meta` compares equal, and the next pull's `minUsn` can't skip any change. Re-fetching an overlap is harmless: `revlog` merges are `INSERT OR IGNORE` (`storage/revlog/add.sql`), and cards and notes are replaced.

**Tested locally** (`scratchpad/exp/readonly_proxy.py`, `readonly_pull_test.py`). A "phone" collection studied 25 cards, renamed a subdeck, changed a deck's new-card limit and deleted a note, then synced. In a second round it deleted a deck. After each round Pact pulled through the proxy. The upstream requests were exactly meta, start, applyChanges(empty), chunk, abort. Results, with the copy opened both `server=True` and `server=False`:
- The server collection's contents were unchanged: `col` row and every table, compared logically. The file bytes do change, because closing the collection checkpoints SQLite's WAL.
- The phone's next `sync_status` was `NO_CHANGES`, against `NORMAL_SYNC` after a full download.
- The copy's cards, revlog and decks equalled a fresh full download's (usn aside), and the deck tree counts matched.

**Saves:**
- A changed check transfers only what changed (a study session's cards, revlog and decks, plus the config, KBs), not the whole file.
- It removes the feedback loop, so downloads happen only when the owner really changed something.
- It removes Pact's only write to the owner's AnkiWeb collection.
- Peak memory and peak disk drop to the size of the changes.
- It is compatible with option A's pruning, if the sanity check isn't forwarded.

It costs more requests per changed check: 5 (meta, start, applyChanges, chunk, abort) instead of 2 (meta, download). Unchanged checks still cost one `meta`.

**Risks:**
- **AnkiWeb isn't the reference server.** Whether AnkiWeb also keeps the whole session in one transaction until `finish` can't be checked without AnkiWeb. If it committed per request instead, the worst cases are `start`'s unbury (which the owner's own devices do at rollover anyway) and `clear_config_usns`. Neither changes cards or reviews. That still breaks the "never writes" guarantee the spec relies on.
- **A visible pattern.** Every session would end in `abort` and never in `sanityCheck2`/`finish`. AnkiWeb could notice that, as it could notice a "desktop" doing full downloads several times a day. Which pattern is more conspicuous is unknown. The pull is far cheaper for AnkiWeb.
- **ToS:** the same terms problem as now. The client logic is still Anki's own, but Pact's proxy writes the bytes on the wire. The proxy must not add a `python-requests` User-Agent (Anki's reqwest client sends none) and must use HTTP/1.1.
- **The proxy is security-critical.**
  - **Redirects:** if it passed AnkiWeb's 308 redirect on `meta` through, the client would switch to AnkiWeb's real endpoint (`meta.rs:95-117`) and send every later step, `applyChunk` and `finish` included, there directly. The proxy must follow redirects itself and record the new endpoint.
  - **A second guard:** run the script with `HTTPS_PROXY` pointing at a dead address and `NO_PROXY=127.0.0.1`, so a direct connection fails (reqwest honours these by default).
  - **Deny by default:** the method whitelist must be closed, not open.
- **Drift:** a bug or an unhandled case could leave the copy wrong, silently. Two guards:
  - Forward `sanityCheck2`. It's read-only, and on a mismatch the client marks the copy for a full sync, which Pact then does. That needs complete row counts, so blank note fields but keep `revlog` (about 30 MB instead of 6.5 MB in the sample).
  - Or prune fully and force a full download on a schedule, such as the first check of each Anki day.
  - Either way, `FULL_SYNC` from `meta` (schema changed) and any error fall back to today's full download.
- **Dependence on internals:** method names and JSON shapes (sync version 11). The JSON shapes date from the Python sync era, so they're old and stable. A protocol bump surfaces as a protocol error, as today.
- **Complexity:** about 150 lines of Python, one more moving part to check by hand.

**Verdict: feasible.** It works end-to-end against the reference server with Anki's own client. It is the only option that cuts AnkiWeb traffic and stops Pact writing to the owner's collection. Whether it is safe on AnkiWeb itself is unknown and can only be learned there, so the owner has to decide to try it, on a throwaway AnkiWeb account first.

### F. Other routes

- **AnkiWeb's web app (`/svc/decks/deck-list-info`)** returns counts directly, with no file at all. But it needs a web session from the password (Pact discards the password), it is undocumented and under the same terms, and it has no review log, so the "as of last answer" rule is lost. **Out.**
- **AnkiConnect, add-ons, AnkiDroid's ContentProvider:** need a running client on the owner's device (spec, Research). **Out.**
- **Pact hosting Anki's sync server:** legitimate, but the owner gives up AnkiWeb (spec, Out of scope). **Out.**
- **Poll less.** Unchanged checks cost one `meta` each, up to ~120 a day per account (every 10 minutes from rollover to due). Polling every 30 minutes until an hour before the due time, then every 10, plus the existing check when Today opens, would cut AnkiWeb requests (and chance 4 above) by about 2-3x. **Feasible, trivial,** but it trades away how fast the result shows up, which is a product call.
- **Grow the volume.** Disk alone is cheap: `fly volumes extend` while running, at cents per GB a month (ADR 0003). This is the zero-risk answer if only disk is the worry, but it keeps the note text and the feedback loop.
- **Clean up leftover temporary files.** If cost 3 is confirmed, delete `/data/anki/.tmp*` before each download, or run the script with a SIGTERM handler that exits cleanly. **Trivial.**

## Recommendation

1. **Do option A now.** Prune each download to cards, decks, config and two days of revlog, through Anki's connection, keeping `mod`. It is low risk and small, uses only Anki's own reading paths, and doesn't change the change-check logic. In the sample it cuts the file ~8x. It also means Pact stops keeping the owner's card text, which is a better answer to story 3 than anything about disk. Add the temporary-file cleanup alongside it.
2. **Consider option E as a separate, owner-approved step**, only if the measurements below show full downloads are frequent or large. It is the only option that reduces AnkiWeb traffic, and it stops Pact writing to the owner's collection at all. Its safety on AnkiWeb, as opposed to the reference server, is unproven. Try it first on a throwaway AnkiWeb account, and check afterwards that the account's devices sync normally (no full-sync prompt). Guard it with the deny-by-default proxy, redirect handling, the dead-proxy environment and a drift check.

Skip B, C and D: each trades AnkiWeb traffic or complexity for disk that A already saves.

## Measure first

1. **What's on the volume** (operator, `fly ssh`): `du -a /data | sort -n | tail`, and `ls -la /data/anki/`. Look for the copy's size, a `-wal` file, and `.tmp*` leftovers.
2. **What the copy is made of:** on the machine, with the copy idle, run `/opt/anki/bin/python3 -I -c` with a read-only `sqlite3` query: `select name, sum(pgsize) from dbstat group by name order by 2 desc limit 12`, plus `select count(*)` from `notes`, `cards` and `revlog`. This shows what option A would save on the real file.
3. **How often Pact downloads, and how big:** add one log line per check (downloaded or not, compressed bytes, seconds, peak RSS from `resource.getrusage`), and count a week of them against the owner's actual syncs. This tells whether option E is worth its risk, and confirms the feedback loop on AnkiWeb (the open manual check "a collection download only after the phone synced" will likely show one download per phone open).
4. **Before shipping A:** run `anki_check.py`'s `counts` on the real copy before and after pruning, at the same timestamp, and compare.

The experiment scripts are in the session scratchpad (`exp/build.py`, `exp/measure.py`, `exp/prune_in_anki.py`, `exp/readonly_proxy.py`, `exp/readonly_pull_test.py`). They aren't part of the repo.
