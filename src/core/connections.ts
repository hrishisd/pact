// Connections: the core's record of each account's Oura and AnkiWeb
// connections, the profile that lists them, and marking one Needs
// reconnecting. The adapters keep the tokens; src/server/connections.ts
// orders the two.

import { APP_PATHS } from "../shared/api.ts";
import {
  RECONNECT_TEXT,
  type AccountId,
  type Connection,
  type ConnectionService,
  type Profile,
} from "../shared/types.ts";
import type { CoreContext } from "./context.ts";
import { accountRow } from "./rows.ts";

/** The push when a connection needs reconnecting, by service. */
const RECONNECT_PUSH: Record<ConnectionService, { title: string; body: string }> = {
  oura: { title: "Oura needs reconnecting", body: RECONNECT_TEXT.oura },
  anki: { title: "AnkiWeb needs reconnecting", body: RECONNECT_TEXT.anki },
};

export function profile(ctx: CoreContext, accountId: AccountId): Profile {
  const { email, name, timezone } = accountRow(ctx, accountId);
  const connections = ctx
    .all<{ service: ConnectionService; status: Connection["status"]; connected_at: string }>(
      `SELECT service, status, connected_at FROM connection WHERE account_id = ? ORDER BY service`,
      accountId,
    )
    .map((row): Connection => ({
      service: row.service,
      status: row.status,
      connectedAt: new Date(row.connected_at),
      activePacts: activePactsUsing(ctx, accountId, row.service),
    }));
  return { email, name, timezone, connections };
}

export function connectOura(ctx: CoreContext, accountId: AccountId): void {
  connect(ctx, accountId, "oura");
}

export function disconnectOura(ctx: CoreContext, accountId: AccountId): void {
  disconnect(ctx, accountId, "oura");
}

export function connectAnki(ctx: CoreContext, accountId: AccountId, ankiPolls: Map<AccountId, number>): void {
  // A new login: the next tick checks at once, whenever the last check was.
  ankiPolls.delete(accountId);
  connect(ctx, accountId, "anki");
}

export function disconnectAnki(ctx: CoreContext, accountId: AccountId): void {
  disconnect(ctx, accountId, "anki");
}

/** How many of the account's Active pacts are judged from `service`. */
export function activePactsUsing(ctx: CoreContext, accountId: AccountId, service: ConnectionService): number {
  // Each service supplies the evidence kind of the same name (SERVICE_OF_KIND).
  const row = ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM pact WHERE owner_account_id = ? AND stage = 'active' AND evidence_kind = ?`)
    .get(accountId, service) as { n: number };
  return row.n;
}

/** Connects the account to `service`, or marks a connection that needs reconnecting connected again. */
function connect(ctx: CoreContext, accountId: AccountId, service: ConnectionService): void {
  ctx.db
    .prepare(
      `INSERT INTO connection (account_id, service, status, connected_at) VALUES (?, ?, 'connected', ?)
       ON CONFLICT (account_id, service) DO UPDATE SET status = 'connected', connected_at = excluded.connected_at`,
    )
    .run(accountId, service, ctx.clock.now().toISOString());
}

function disconnect(ctx: CoreContext, accountId: AccountId, service: ConnectionService): void {
  ctx.db.prepare(`DELETE FROM connection WHERE account_id = ? AND service = ?`).run(accountId, service);
}

/**
 * Marks the account's connection to `service` Needs reconnecting after the
 * service refused it (Oura its tokens, AnkiWeb its login), once: the owner
 * gets one push, and the Today and pact alerts show until they reconnect.
 * Until then no call is made. A connection made again since the service
 * was asked (`askedAt`) is left alone: its new tokens weren't the ones refused.
 */
export function markDisconnected(
  ctx: CoreContext,
  service: ConnectionService,
  account: AccountId,
  askedAt: Date,
): void {
  const marked = ctx.db
    .prepare(
      `UPDATE connection SET status = 'needs-reconnecting'
       WHERE account_id = ? AND service = ? AND status = 'connected' AND connected_at <= ?`,
    )
    .run(account, service, askedAt.toISOString());
  if (marked.changes === 0) return;
  ctx.enqueue({
    recipient: account,
    kind: "connection-problem",
    payload: { ...RECONNECT_PUSH[service], url: APP_PATHS.today },
  });
}

/**
 * An error for the log: its name and message. A SyntaxError's message quotes
 * the response it couldn't parse, which could hold a token, so it's left out.
 */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  return error.name === "SyntaxError" ? error.name : `${error.name}: ${error.message}`;
}

/** Whether `accountId` checked a service within `intervalMs` before `now`, as `checks` records. */
export function checkedWithin(
  checks: ReadonlyMap<AccountId, number>,
  accountId: AccountId,
  now: Date,
  intervalMs: number,
): boolean {
  const last = checks.get(accountId);
  return last !== undefined && now.getTime() - last < intervalMs;
}
