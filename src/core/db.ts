// Opening the core's SQLite database. Production and tests both open it here,
// so tests run on the same pragmas and schema as production.

import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { migrations as appMigrations } from "./migrations.ts";

export type Db = Database.Database;

/** `migrations` is for tests; the app always runs its own. */
export function openDatabase(path: string, migrations: readonly string[] = appMigrations): Db {
  const db = openWithPragmas(path);
  try {
    migrate(db, migrations);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/** Opens a connection with the production pragmas but runs no migrations. */
export function openWithPragmas(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

// `user_version` counts the migrations applied. `schema_migration` holds a
// fingerprint of each one's text as applied, so a migration edited after a
// database ran it refuses to open rather than failing later on a missing
// column. db.ts owns this table, not a numbered migration, because it guards
// the migrations themselves.
function migrate(db: Db, migrations: readonly string[]): void {
  const applied = db.pragma("user_version", { simple: true }) as number;
  if (applied > migrations.length) {
    throw new Error(`database is at schema version ${applied}, newer than this code knows (${migrations.length})`);
  }

  const recorded = readFingerprints(db);
  if (recorded.size === 0) {
    // Adoption: a database migrated before fingerprints existed (production
    // was at version 3 with no table) has none recorded. Trust that what it
    // applied is this code's text and record it, in one transaction with
    // creating the table, so a crash can't leave only some of them recorded.
    db.transaction(() => {
      db.exec("CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL)");
      for (let version = 1; version <= applied; version++) {
        recordFingerprint(db, version, migrations[version - 1]!);
      }
    })();
  } else {
    for (let version = 1; version <= applied; version++) {
      if (recorded.get(version) !== fingerprint(migrations[version - 1]!)) {
        throw new Error(
          `migration ${version} has changed since this database applied it. ` +
            `In development, reset the dev database (docs/agents/local-dev.md). ` +
            `In production, a shipped migration was edited: restore its old text and add a new migration instead.`,
        );
      }
    }
  }

  // Foreign keys are off while migrations run, so one can rebuild a table
  // others reference (SQLite's 12-step procedure: dropping the old table would
  // otherwise fail). PRAGMA foreign_keys does nothing inside a transaction, so
  // it's set around them, and each migration checks every reference before it
  // commits.
  const foreignKeys = db.pragma("foreign_keys", { simple: true }) as number;
  db.pragma("foreign_keys = OFF");
  try {
    for (let version = applied + 1; version <= migrations.length; version++) {
      db.transaction(() => {
        db.exec(migrations[version - 1]!);
        const dangling = db.pragma("foreign_key_check") as unknown[];
        if (dangling.length > 0) {
          throw new Error(`migration ${version} leaves foreign keys dangling: ${JSON.stringify(dangling.slice(0, 5))}`);
        }
        recordFingerprint(db, version, migrations[version - 1]!);
        db.pragma(`user_version = ${version}`);
      })();
    }
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys === 1 ? "ON" : "OFF"}`);
  }
}

/** Fingerprints by version; empty when the table doesn't exist yet. */
function readFingerprints(db: Db): Map<number, string> {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migration'").get();
  if (!exists) return new Map();
  const rows = db.prepare("SELECT version, fingerprint FROM schema_migration").all() as {
    version: number;
    fingerprint: string;
  }[];
  return new Map(rows.map((row) => [row.version, row.fingerprint]));
}

function recordFingerprint(db: Db, version: number, sql: string): void {
  db.prepare("INSERT INTO schema_migration (version, fingerprint) VALUES (?, ?)").run(version, fingerprint(sql));
}

function fingerprint(sql: string): string {
  return createHash("sha256").update(sql.trim()).digest("hex");
}
