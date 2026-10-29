// Opening the database checks that every migration it has applied still has
// the text this code has: an edited migration refuses to open instead of
// serving SQL errors later.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openDatabase, openWithPragmas } from "./db.ts";

const one = "CREATE TABLE one (x INTEGER);";
const two = "CREATE TABLE two (y INTEGER);";
const three = "CREATE TABLE three (z INTEGER);";

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pact-db-"));
  path = join(dir, "pact.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function open(migrations: readonly string[]): void {
  openDatabase(path, migrations).close();
}

describe("a fresh database", () => {
  test("applies every migration and reopens with the same code", () => {
    open([one, two]);
    open([one, two]);
    const db = openWithPragmas(path);
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    expect(tables(db)).toEqual(expect.arrayContaining(["one", "two"]));
    db.close();
  });

  test("refuses to reopen once an applied migration's text changed, naming it", () => {
    open([one, two]);
    expect(() => open([one, "CREATE TABLE two (y INTEGER, w TEXT);"])).toThrow(/migration 2\b/);
  });
});

test("a refused open changes nothing", () => {
  open([one, two]);
  const before = snapshot();
  expect(() => open(["CREATE TABLE one (x TEXT);", two, three])).toThrow(/migration 1\b/);
  expect(snapshot()).toEqual(before);
});

test("the refusal says how to recover in development and in production", () => {
  open([one]);
  expect(() => open(["CREATE TABLE one (x TEXT);"])).toThrow(/docs\/agents\/local-dev\.md[\s\S]*new migration/);
});

test("whitespace around a migration's text doesn't count as a change", () => {
  open([one, two]);
  open([`\n  ${one}\n  `, two]);
});

test("an appended migration is applied, and then checked like the others", () => {
  open([one]);
  open([one, two]);
  expect(() => open([one, "CREATE TABLE two (y TEXT);"])).toThrow(/migration 2\b/);
});

describe("a database migrated before fingerprints existed", () => {
  // Production was at user_version 3 with no record of migration text.
  function migrateWithoutFingerprints(migrations: readonly string[]): void {
    const db = openWithPragmas(path);
    migrations.forEach((sql, i) => {
      db.exec(sql);
      db.pragma(`user_version = ${i + 1}`);
    });
    db.close();
  }

  test("opens, keeping its data and applying newer migrations", () => {
    migrateWithoutFingerprints([one, two]);
    const db = openWithPragmas(path);
    db.prepare("INSERT INTO one (x) VALUES (7)").run();
    db.close();

    open([one, two, three]);

    const after = openWithPragmas(path);
    expect(after.pragma("user_version", { simple: true })).toBe(3);
    expect(after.prepare("SELECT x FROM one").all()).toEqual([{ x: 7 }]);
    expect(tables(after)).toContain("three");
    after.close();
  });

  test("trusts the code's text for what it applied, then checks it from then on", () => {
    migrateWithoutFingerprints([one, two]);
    open([one, two]);
    expect(() => open([one, "CREATE TABLE two (y TEXT);"])).toThrow(/migration 2\b/);
  });
});

test("a database newer than the code still refuses to open", () => {
  open([one, two]);
  expect(() => open([one])).toThrow("database is at schema version 2, newer than this code knows (1)");
});

function tables(db: ReturnType<typeof openWithPragmas>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
    (r) => r.name,
  );
}

function snapshot(): unknown {
  const db = openWithPragmas(path);
  const result = {
    version: db.pragma("user_version", { simple: true }),
    schema: db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all(),
    fingerprints: tables(db).includes("schema_migration")
      ? db.prepare("SELECT * FROM schema_migration ORDER BY version").all()
      : null,
  };
  db.close();
  return result;
}
