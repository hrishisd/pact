// Apple Health: the upload key that connects an account, the uploads its
// Pact Health Shortcut posts, and the sleep sessions they give bedtime
// nights (`judgeNights`, bedtime.ts). Mindful samples are kept and counted,
// but judge nothing yet.

import { createHash, randomBytes } from "node:crypto";
import { API_PATHS } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import type {
  AccountId,
  AppleHealthKey,
  AppleHealthLastUpload,
  AppleHealthStatus,
  AppleHealthUpload,
  AppleHealthUploadResult,
  LocalDate,
} from "../shared/types.ts";
import { judgeNights, type SleepSession } from "./bedtime.ts";
import { localDateOf } from "./calendar.ts";
import { connect, disconnect } from "./connections.ts";
import type { CoreContext } from "./context.ts";
import { nightStartsAt } from "./occurrences.ts";
import { hasConnection } from "./rows.ts";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** An upload keeps samples that end at most this long before it. */
const SAMPLES_KEPT_FOR_MS = 14 * DAY_MS;

/** Counted sleep samples this close, or overlapping, are one sleep session. */
const SESSION_GAP_MS = 60 * MINUTE_MS;

/** A sleep session at least this long is a main sleep: it can decide a night. */
const MAIN_SLEEP_MS = 3 * 60 * MINUTE_MS;

/**
 * Makes the account a new upload key, which connects Apple Health, or
 * replaces its key, so the old one stops working at once. Only the key's
 * hash is kept: the key is in the upload URL returned, this once.
 */
export function makeUploadKey(ctx: CoreContext, accountId: AccountId, appUrl: string): AppleHealthKey {
  const key = randomBytes(24).toString("base64url");
  ctx.db
    .prepare(
      `INSERT INTO apple_health_key (account_id, key_hash, made_at) VALUES (?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET key_hash = excluded.key_hash, made_at = excluded.made_at`,
    )
    .run(accountId, hashOf(key), ctx.clock.now().toISOString());
  connect(ctx, accountId, "apple_health");
  return { uploadUrl: `${new URL(API_PATHS.appleHealthSamples, appUrl).toString()}?key=${key}` };
}

/** Deletes the account's upload key, which disconnects Apple Health. Its samples stay: they're the evidence for nights judged. */
export function disconnectAppleHealth(ctx: CoreContext, accountId: AccountId): void {
  ctx.db.prepare(`DELETE FROM apple_health_key WHERE account_id = ?`).run(accountId);
  disconnect(ctx, accountId, "apple_health");
}

/** The account whose upload key `key` is, or null for a key no account has now. */
export function accountIdForUploadKey(ctx: CoreContext, key: string): AccountId | null {
  if (key === "") return null;
  return (
    ctx.one<{ account_id: AccountId }>(`SELECT account_id FROM apple_health_key WHERE key_hash = ?`, hashOf(key))
      ?.account_id ?? null
  );
}

export function appleHealthStatus(ctx: CoreContext, accountId: AccountId): AppleHealthStatus {
  return { connected: hasConnection(ctx, accountId, "apple_health"), lastUpload: lastUpload(ctx, accountId) };
}

/** The account's last upload from its Pact Health Shortcut, or null before the first. */
export function lastUpload(ctx: CoreContext, accountId: AccountId): AppleHealthLastUpload | null {
  const row = ctx.one<{
    apple_health_uploaded_at: string | null;
    apple_health_sleep_samples: number | null;
    apple_health_mindful_sessions: number | null;
  }>(
    `SELECT apple_health_uploaded_at, apple_health_sleep_samples, apple_health_mindful_sessions
       FROM account WHERE id = ?`,
    accountId,
  );
  if (!row?.apple_health_uploaded_at) return null;
  return {
    at: new Date(row.apple_health_uploaded_at),
    sleepSamples: row.apple_health_sleep_samples ?? 0,
    mindfulSessions: row.apple_health_mindful_sessions ?? 0,
  };
}

/**
 * Keeps an upload's sleep and mindful samples, each once, records the
 * upload, and judges the account's Apple Health nights waiting for sleep.
 * A sample of another type is skipped and not counted; one whose dates
 * don't read as ISO 8601 with a UTC offset, or that ends before it starts,
 * is skipped and counted with the lines the server couldn't read. One that
 * ends more than 14 days before now, or starts after now, is left out.
 */
export function uploadAppleHealth(
  ctx: CoreContext,
  accountId: AccountId,
  upload: AppleHealthUpload,
): AppleHealthUploadResult {
  const now = ctx.clock.now();
  const counted = { sleep: 0, mindful: 0 };
  let skippedLines = upload.unreadableLines;
  const keep = ctx.db.prepare(
    `INSERT INTO apple_health_sample (account_id, type, start_at, end_at, value, source, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  );
  for (const sample of upload.samples) {
    const type = sample.type.trim().toLowerCase();
    if (type !== "sleep" && type !== "mindful") continue;
    const [start, end] = [instantOf(sample.start), instantOf(sample.end)];
    if (start === null || end === null || end.getTime() < start.getTime()) {
      skippedLines++;
      continue;
    }
    if (end.getTime() < now.getTime() - SAMPLES_KEPT_FOR_MS || start.getTime() > now.getTime()) continue;
    keep.run(
      accountId,
      type,
      start.toISOString(),
      end.toISOString(),
      sample.value.trim(),
      sample.source.trim(),
      now.toISOString(),
    );
    counted[type]++;
  }
  ctx.db
    .prepare(
      `UPDATE account SET apple_health_uploaded_at = ?, apple_health_sleep_samples = ?,
                          apple_health_mindful_sessions = ?
       WHERE id = ?`,
    )
    .run(now.toISOString(), counted.sleep, counted.mindful, accountId);
  judgeNights(ctx, "apple_health", now, (account, from) => appleHealthSessions(ctx, account, from), accountId);
  return { sleepSamples: counted.sleep, mindfulSessions: counted.mindful, skippedLines };
}

/**
 * The account's sleep sessions from its stored sleep samples that end on or
 * after the day before `from` (UTC), enough for the nights from `from` on:
 * the samples that count (any whose value doesn't contain "awake", In Bed
 * included) merged where they overlap or the gap between them is at most 60
 * minutes, unless a night starts in the gap (18:00 in the account's
 * timezone), so a nap just before 18:00 never moves the night's sleep into
 * the night before. A session runs from its earliest start to its latest
 * end, is a main sleep at 3 hours or more, and its source is its earliest sample's.
 */
export function appleHealthSessions(ctx: CoreContext, account: AccountId, from: LocalDate): SleepSession[] {
  const timezone = ctx.one<{ timezone: string | null }>(`SELECT timezone FROM account WHERE id = ?`, account)?.timezone;
  const samples = ctx.all<{ start_at: string; end_at: string; source: string }>(
    `SELECT start_at, end_at, source FROM apple_health_sample
       WHERE account_id = ? AND type = 'sleep' AND end_at >= ? AND lower(value) NOT LIKE '%awake%'
       ORDER BY start_at, end_at, source`,
    account,
    addDays(from, -1),
  );
  const sessions: { start: number; end: number; source: string }[] = [];
  for (const sample of samples) {
    const [start, end] = [Date.parse(sample.start_at), Date.parse(sample.end_at)];
    const last = sessions.at(-1);
    const merges =
      last !== undefined &&
      start - last.end <= SESSION_GAP_MS &&
      !(timezone && nightStartsBetween(last.end, start, timezone));
    if (merges) last.end = Math.max(last.end, end);
    else sessions.push({ start, end, source: sample.source });
  }
  return sessions.map((session) => ({
    start: new Date(session.start).toISOString(),
    end: new Date(session.end).toISOString(),
    isMain: session.end - session.start >= MAIN_SLEEP_MS,
    source: session.source === "" ? null : session.source,
  }));
}

/** Whether a night starts (18:00 in `timezone`) from `end` to `start`, both included: never when they overlap. */
function nightStartsBetween(end: number, start: number, timezone: string): boolean {
  const date = localDateOf(new Date(end), timezone);
  let nightStart = nightStartsAt(date, timezone).getTime();
  if (nightStart < end) nightStart = nightStartsAt(addDays(date, 1), timezone).getTime();
  return nightStart <= start;
}

/** ISO 8601 with a time and a UTC offset or "Z", as Shortcuts writes a date: "2026-11-25T23:41:09-05:00". */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** The instant `text` names, or null when it isn't ISO 8601 with a UTC offset. */
function instantOf(text: string): Date | null {
  const trimmed = text.trim();
  if (!ISO_INSTANT.test(trimmed)) return null;
  // "+0500" as "+05:00", which every engine reads.
  const ms = Date.parse(trimmed.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(ms) ? null : new Date(ms);
}

function hashOf(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
