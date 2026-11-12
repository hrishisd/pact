// What the core's parts share: the database, the one clock, ids, the log,
// the outbox and the checks of AnkiWeb still running. `Core` makes one and hands it to each part.

import type { Statement } from "better-sqlite3";
import type { Db } from "./db.ts";
import type { AnkiChecksRunning } from "./judging.ts";
import type { Clock, NotificationKind, NotificationOf } from "./ports.ts";

export interface CoreContext {
  readonly db: Db;
  /** The core's only clock: every part reads time from it. */
  readonly clock: Clock;
  newId(): string;
  log(line: string): void;
  /** Queues a notification in the current command's transaction. */
  enqueue<K extends NotificationKind>(notification: NotificationOf<K>): void;
  /**
   * The checks of AnkiWeb still running, as they are now: `Core`'s own map,
   * which only it changes. Judging reads it here (`occurrenceFacts`).
   */
  readonly ankiChecksRunning: AnkiChecksRunning;
  /** The first row `sql` reads with `params`, or undefined when there's none. */
  one<T>(sql: string, ...params: unknown[]): T | undefined;
  /** Every row `sql` reads with `params`. */
  all<T>(sql: string, ...params: unknown[]): T[];
}

export function createContext(
  parts: Pick<CoreContext, "db" | "clock" | "newId" | "log" | "enqueue" | "ankiChecksRunning">,
): CoreContext {
  const { db } = parts;
  // One statement per SQL text. Safe because migrations run before the context exists.
  const statements = new Map<string, Statement>();
  const prepared = (sql: string): Statement => {
    let statement = statements.get(sql);
    if (statement === undefined) statements.set(sql, (statement = db.prepare(sql)));
    return statement;
  };
  return {
    ...parts,
    one: <T>(sql: string, ...params: unknown[]) => prepared(sql).get(...params) as T | undefined,
    all: <T>(sql: string, ...params: unknown[]) => prepared(sql).all(...params) as T[],
  };
}

/** Runs `change` as one command: one transaction, then the outbox is delivered. */
export type Command = <T>(change: () => T) => Promise<T>;
