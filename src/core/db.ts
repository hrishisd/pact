// Opening the core's SQLite database. Production and tests both open it here,
// so tests run on the same pragmas and schema as production.

import Database from "better-sqlite3";
import { migrations } from "./migrations.ts";

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  const db = openWithPragmas(path);
  migrate(db);
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

function migrate(db: Db): void {
  const applied = db.pragma("user_version", { simple: true }) as number;
  if (applied > migrations.length) {
    throw new Error(
      `database is at schema version ${applied}, newer than this code knows (${migrations.length})`,
    );
  }
  for (let version = applied + 1; version <= migrations.length; version++) {
    db.transaction(() => {
      db.exec(migrations[version - 1]!);
      db.pragma(`user_version = ${version}`);
    })();
  }
}
