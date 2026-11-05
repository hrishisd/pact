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

- [ ] `grep -rniw kept src GLOSSARY.md .scratch/pact-v0/spec.md` finds only plain-English uses.
- [ ] A migration test opens a database at the previous schema version with `'kept'`, `'missed'` and `'excused'` rows, and after migrating finds `'satisfied'`, `'missed'` and `'excused'` with every other column unchanged.
- [ ] Inserting `'kept'` after the migration fails the CHECK constraint.
- [ ] The full test suite, typecheck and lint pass.
- [ ] The Today, pact page, history heat map and File excuse sheet show "Satisfied" (screenshot at 390×844).

## Comments
