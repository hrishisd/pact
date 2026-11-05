# 01 Rename Kept to Satisfied

Status: ready-for-agent
Blocked by: none

Decided in the Anki grilling session on 2026-11-05 (see `../spec.md`). The outcomes become **Satisfied / Missed / Excused**. "Kept" read oddly as a bare chip label. "Done" collides with the sheets' Done button and "Approved" with reviewers' decisions, so both were rejected.

## What to build

Rename the outcome everywhere, so the codebase has one name for it.

- **`GLOSSARY.md`:** the entry becomes **Satisfied / Missed / Excused**, with the definition "the owner met the pact for that occurrence". Add Kept, Done and Approved to its _Avoid_ line, after the ones already there (Passed, failed, success, failure, pending). An occurrence is Satisfied, never a pact; a pact still ends as Ended.
- **`.scratch/pact-v0/spec.md`:** every domain use of Kept, including stories, rules, screens and the Future Ideas entries. Closed tickets under `.scratch/pact-v0/issues/` are history and stay as written.
- **Types and core:** `{ kind: "kept" }`, `ExcuseSkipReason` `"kept"`, outcome unions, and function and variable names built on "kept".
- **Database:** a new migration rebuilds `occurrence` with `CHECK (outcome IN ('satisfied', 'missed', 'excused'))` and maps existing `'kept'` rows to `'satisfied'`. SQLite can't alter a CHECK constraint, so the migration creates the new table, copies the rows, drops the old one and renames, keeping every index, foreign key and trigger the old table had. Look for any other table or JSON column that stores the word.
- **Client:** the chips, history legend, CSS class `c-kept`, and the copy, such as "Your reviewers see only Kept or Missed" in `CreatePact.tsx`.
- **Tests:** scenario names and expectations.

Leave plain-English uses of "kept" alone, such as "an offset is kept" or "Kept in week order" in comments.

## Acceptance criteria

- [x] `grep -rniw kept src GLOSSARY.md .scratch/pact-v0/spec.md` finds only plain-English uses.
- [x] A migration test opens a database at the previous schema version with `'kept'`, `'missed'` and `'excused'` rows, and after migrating finds `'satisfied'`, `'missed'` and `'excused'` with every other column unchanged.
- [x] Inserting `'kept'` after the migration fails the CHECK constraint.
- [x] The full test suite, typecheck and lint pass.
- [x] The Today, pact page, history heat map and File excuse sheet show "Satisfied" (screenshot at 390×844).

## Comments

### 2026-11-05: built

- **Migration 25** rebuilds `occurrence` by SQLite's 12-step procedure: create `occurrence_new` with the new CHECK, copy the rows mapping `'kept'` to `'satisfied'`, drop `occurrence`, rename. At version 24 the table had only its primary key's index, its foreign key to `pact`, and its two CHECKs; no other index, trigger or view. `evidence` and `penalty` reference it by name, so they carry over untouched (the test compares every other table's schema text before and after).
- **Foreign keys during migrations.** Migrations ran inside a transaction with `foreign_keys = ON`, where `PRAGMA foreign_keys` does nothing, so `DROP TABLE occurrence` failed on the rows `evidence` and `penalty` hold. `db.ts` now turns foreign keys off around the pending migrations, runs `PRAGMA foreign_key_check` inside each migration's transaction (a dangling reference refuses the migration, naming it, and rolls it back), and turns them back on after. Tested in `db.test.ts`.
- **Nothing else stored `'kept'`.** Outbox payloads hold only title, body and url text (none said Kept); `ExcuseSkipReason` is worked out per request, never stored; notification kinds and settings never had it.
- **Lint.** Kept, Done and Approved are on the glossary's _Avoid_ line, and also in `check-conventions.ts`'s `EVERYDAY_WORDS`, like Passed and failed: "approved" evidence, the Done button and plain-English "kept" are right everywhere else, so checking them would flag correct code. The grep in the first criterion is the check for Kept.
- **What the grep still finds besides plain English:** migration 4's old CHECK (shipped, can't change), and migration 25 and its test, which have to name the old value.
- **CSS:** `c-kept` is now `c-satisfied`, and `--kept`/`--kept-bg` are `--satisfied`/`--satisfied-bg`. It's the green used for other chips too (Active, Connected, Approved by).
- **Spec:** user story 29 said "prove I kept the pact"; it now says "met the pact", the glossary's definition, since an occurrence is Satisfied, never a pact. Stories 49 and the closing note use "kept" in plain English and stay.
- **Screens:** checked at 390×844 on a seeded dev database: Today's Yesterday row, the pact page's history legend, and the File excuse sheet's skipped day all say Satisfied.

- 2026-11-05: Code review fixes. Foreign keys are now off only for a migration that opts in with `{ sql, foreignKeysOff: true }` (migration 25), and it's refused only for references it leaves dangling, not ones already broken. The shared green is `c-ok` / `--ok`, because Active, Connected and "Approved by" aren't outcomes. `scripts/check-conventions.ts` flags Kept as a value, class or label outside `migrations.ts`, so the Avoid entry is enforced. A tab still running the old client after the deploy shows blank labels for satisfied days until it reloads; the service worker caches nothing, so reopening the app fixes it.
