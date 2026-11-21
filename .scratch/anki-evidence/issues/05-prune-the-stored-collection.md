# 05 Stop storing the owner's note content

Status: done
Blocked by: none

Spec: `../spec.md` story 3 and the Adapter section. Background and experiments: `../storage-brainstorm.md`, option A.

## What to build

`anki_check.py` keeps a full copy of each owner's collection on the production volume (`fresh_copy`). Counting (the deck tree, the last answer, rollover, deck names) never reads note fields. After each full download, blank the note fields so the stored copy holds no note content and is much smaller. Note rows (ids, tags), cards, notetypes, decks with their descriptions, deck options, config and the review log stay.

- Prune right after every full download, before counting, through Anki's own connection: `update notes set flds = '', sfld = '', csum = 0`, then `col.optimize()` (vacuum).
- Keep the review log: the script's own `last_answer_today` (the counts' `as_of`, and so `anki_date`) reads today's answers, and pruning older ones saved only 4 MB more on the real collection. (In 26.9.4 daily limits come from the decks' studied-today counters, not the review log.)
- The change stamp (`mod`, `scm`, `usn`, `ls`; sync_status compares `mod`, `scm` and `ls`) must stay as downloaded, or every check downloads again. Check it on disk after Anki closes the copy, put it back if it moved, and tell the operator.
- A pruned copy must never be uploaded: it would wipe the owner's notes on AnkiWeb and every device.
- Copies downloaded before this are pruned at their next download; no migration.

## Acceptance criteria

- [x] A download is followed by the prune; a copy reused because nothing changed isn't pruned (`anki-check.test.ts`).
- [x] A stamp moved by the prune, or only by Anki's close, is put back; the check succeeds with a warning (`anki-check.test.ts`).
- [x] The adapter raises the warning as an operator alert, emailed once per account, and still returns the counts (`anki.test.ts`).
- [x] A prune that fails closes the collection (`anki-check.test.ts`).
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

### 2026-11-21: review, the stamp is put back instead

A review found failing loudly worse than the problem: with a prune that commits, as a future package might, the raise left `mod` past `ls` on disk, so the next `sync_status` said NormalSync and every check downloaded, pruned and failed again, Missing the owner's days. A moved stamp doesn't make the counts wrong; it only decides whether the next check downloads. This replaces the "fails loudly" point above.

- `fresh_copy` records the `col` row (`mod`, `scm`, `usn`, `ls`) right after `download`, prunes, closes the copy, and compares the row on disk (`restore_stamp`). If it moved, it is rewritten with plain sqlite3 (the col table has no index on Anki's own collation), and the copy is reopened. The answer carries a `warning`, which the adapter raises as an "Anki check warning" operator alert (`#alertWarning`, `anki.ts`): logged every time, emailed once per account while the server runs. A failed download or prune now closes the collection.
- The stamp includes `scm`: sync_status compares `mod`, `scm` and `ls` (`get_collection_timestamps`, `compared_to_remote`); usn isn't compared but is kept too.
- The review log is kept for `last_answer_today`, not for daily limits (those come from the decks' studied-today counters in 26.9.4).
- **Checked with the pinned package** against Anki's local sync server: the normal path again matched an unpruned download at all six times, with no warning, and the next run reused the copy. With `optimize` made to commit (moving `mod`), `fresh_copy` put the stamp back with a warning, the reopened copy counted, and the next `sync_status` said "no changes".
