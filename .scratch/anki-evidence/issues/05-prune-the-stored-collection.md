# 05 Stop storing the owner's card text

Status: done
Blocked by: none

Spec: `../spec.md` story 3 and the Adapter section. Background and experiments: `../storage-brainstorm.md`, option A.

## What to build

`anki_check.py` keeps a full copy of each owner's collection on the production volume (`fresh_copy`). Counting (the deck tree, the last answer, rollover, deck names) never reads note content. After each full download, blank the notes' content so the stored copy holds no card text and is much smaller.

- Prune right after every full download, before counting, through Anki's own connection: `update notes set flds = '', sfld = '', csum = 0`, then `col.optimize()` (vacuum).
- Keep the review log: daily limits read today's answers, and pruning it saved only 4 MB more on the real collection.
- Pruning must leave the change stamp (`col.mod`, `usn`, `ls`) as downloaded, or every check downloads again. Check it, and never let a change pass silently.
- A pruned copy must never be uploaded: it would wipe the owner's notes on AnkiWeb and every device.
- Copies downloaded before this are pruned at their next download; no migration.

## Acceptance criteria

- [x] A download is followed by the prune; a copy reused because nothing changed isn't pruned (`anki-check.test.ts`).
- [x] A prune that changes the change stamp fails the check as a protocol error (`anki-check.test.ts`).
- [x] The script has one full sync, `download`, and it only downloads (`anki-check.test.ts`).
- [x] Counts on a pruned copy match an unpruned one, checked with the pinned anki package (see Comments).
- [x] `docs/behaviour.md`, the spec's Adapter section and the script's docstring say what the copy holds.

Production checks are in `../manual-checks.md`, "After ticket 05".

## Comments

### 2026-11-21: measured on the owner's collection

On a copy of the owner's real 88.6 MB collection, on the production machine, with the pinned package: blanking the notes and vacuuming took it to 24.9 MB in about 14 s. Deck-tree counts for all 51 decks were identical to the unpruned copy at now, +3h, +12h, +1d and +3d; the last answer and rollover were identical; `pragma integrity_check` was ok; the `col` row (mod, usn, ls, scm) was unchanged after Anki's close.

### 2026-11-21: built

- `fresh_copy` calls `download` then `prune` (`anki_check.py`). `download` is the script's only call to `full_upload_or_download`, with `upload=False`, and says why it must stay so.
- **A changed stamp fails loudly.** `prune` reads `mod, usn, ls` before and after, and raises if they differ, which the adapter reports as an AnkiWeb protocol error (logged, and emailed to the operator once per account). It isn't put right with plain sqlite3 after close, as the brainstorm's experiment did: the package is pinned, so a change can only follow a deliberate bump, whose other assumptions (that counting never reads notes) then need checking too, and a hand-written stamp would hide that. The bump procedure's manual checks now include pruning.
- **Checked with the pinned anki package** against Anki's own local sync server (never AnkiWeb), with the brainstorm's synthetic collection (20,000 notes, 400,000 revlog rows): the real script's first `counts` downloaded and pruned it from 51.5 MB to 32.0 MB in 1.8 s; `integrity_check` ok; no note kept content; every revlog row kept. Deck-tree counts for its 7 decks matched an unpruned download at the last answer, now, +3h, +12h, +1d and +3d, as did the last answer, rollover and the script's own counts. The pruned copy's `sync_status` was "no changes", and the next run reused it (0.3 s).
