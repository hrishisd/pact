// What the core's parts share: the database, the one clock, ids, the log and
// the outbox. `Core` makes one and hands it to each part.

import type { Db } from "./db.ts";
import type { Clock, NotificationKind, NotificationOf } from "./ports.ts";

export interface CoreContext {
  readonly db: Db;
  /** The core's only clock: every part reads time from it. */
  readonly clock: Clock;
  newId(): string;
  log(line: string): void;
  /** Queues a notification in the current command's transaction. */
  enqueue<K extends NotificationKind>(notification: NotificationOf<K>): void;
  /** The first row `sql` reads with `params`, or undefined when there's none. */
  one<T>(sql: string, ...params: unknown[]): T | undefined;
  /** Every row `sql` reads with `params`. */
  all<T>(sql: string, ...params: unknown[]): T[];
}

export function createContext(parts: Pick<CoreContext, "db" | "clock" | "newId" | "log" | "enqueue">): CoreContext {
  const { db } = parts;
  return {
    ...parts,
    one: <T>(sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as T | undefined,
    all: <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[],
  };
}

/** Runs `change` as one command: one transaction, then the outbox is delivered. */
export type Command = <T>(change: () => T) => Promise<T>;
