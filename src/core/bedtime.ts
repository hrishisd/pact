// Bedtime pacts: judging each night from the sleep its source reports, the
// push when a night has no sleep data, and Oura as a source: checking it, and
// the clock its timestamps carry. Apple Health, the other source, is in
// apple-health.ts.

import { APP_PATHS } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import { isBedtimeKind } from "../shared/evidence-kinds.ts";
import { formatDate } from "../shared/format.ts";
import {
  BEDTIME_KINDS,
  type AccountId,
  type BedtimeKind,
  type CheckNowResult,
  type LocalDate,
} from "../shared/types.ts";
import { earlierDate, laterDate, localDateOf } from "./calendar.ts";
import { errorText, markDisconnected, recentCheckNow, type ChecksNow } from "./connections.ts";
import type { Command, CoreContext } from "./context.ts";
import { coverOn, keepsToDo } from "./covers.ts";
import { endedBedtimePacts, isJudged, pactsToJudge, type PactToJudge } from "./occurrence-state.ts";
import { nightStartsAt, noSleepDataPushAt, utcOffsetMs, type NightOffset, type Occurrence } from "./occurrences.ts";
import { nightOf, utcOffsetOf, wallClock } from "./night-clock.ts";
import { OperatorAlerted, type OuraSleepPeriod, type OuraSleepResult, type OuraSource } from "./ports.ts";
import { connectionProblem, nightClockOf, occurrencesOf, ouraOffsetOf, type NightClock } from "./rows.ts";
import { settle } from "./settle.ts";

/** The core ignores a check of Oura now this soon after the account's last one. */
const OURA_CHECK_INTERVAL_MS = 15_000;

export async function checkOura(
  ctx: CoreContext,
  accountId: AccountId,
  ouraChecks: ChecksNow,
  ouraSource: OuraSource,
  command: Command,
): Promise<CheckNowResult> {
  const now = ctx.clock.now();
  const recent = recentCheckNow(ouraChecks, accountId, now, OURA_CHECK_INTERVAL_MS);
  if (recent) return recent;
  // Stored before Oura answers, so a check now while this one runs waits for what it finds.
  const result = askOura(ctx, accountId, ouraSource, command, now);
  ouraChecks.set(accountId, { at: now.getTime(), result });
  return result;
}

/** `checkOura`'s call to Oura, and judging what it reports. */
async function askOura(
  ctx: CoreContext,
  accountId: AccountId,
  ouraSource: OuraSource,
  command: Command,
  now: Date,
): Promise<CheckNowResult> {
  const fetched = await fetchOuraSleep(ctx, ouraSource, now, accountId);
  await command(() => {
    for (const account of fetched.disconnected) markDisconnected(ctx, "oura", account, fetched.askedAt);
    noteOuraClock(ctx, fetched.sleep, now);
    judgeNights(ctx, "oura", now, ouraSessions(fetched.sleep), accountId);
  });
  return fetched.unreached.includes(accountId) ? { ok: false, reason: "unreachable" } : { ok: true };
}

/**
 * Keeps, for each account in `sleep`, the latest bedtime_start Oura has
 * reported with a UTC offset, by when it happened: Oura's clock where the
 * owner is now, for `ouraClockOf`. Deleted periods don't count. When that
 * moves the clock nights close on, a night that has opened by `at` keeps
 * the clock it opened on (`keepEarlierClock`).
 */
export function noteOuraClock(ctx: CoreContext, sleep: Map<AccountId, OuraSleepPeriod[]>, at: Date): void {
  for (const [account, periods] of sleep) {
    const row = ctx.one<{ oura_latest_bedtime_start: string | null; timezone: string | null }>(
      `SELECT oura_latest_bedtime_start, timezone FROM account WHERE id = ?`,
      account,
    );
    const before = row?.oura_latest_bedtime_start ?? null;
    let latest = before;
    for (const { type, bedtime_start: start } of periods) {
      if (type === "deleted" || utcOffsetOf(start) === null) continue;
      if (latest === null || Date.parse(start) > Date.parse(latest)) latest = start;
    }
    if (latest === null || latest === before) continue;
    if (row?.timezone) keepEarlierClock(ctx, account, row.timezone, before, latest, at);
    ctx.db.prepare(`UPDATE account SET oura_latest_bedtime_start = ? WHERE id = ?`).run(latest, account);
  }
}

/**
 * Keeps the clock of the sleep that started at `before` for the account's
 * nights that have opened by `at`, when the one that started at `latest`
 * gives nights another clock in `timezone` or in a timezone the owner moved
 * from: as a timezone change does (design review tickets 39 and 45), so a
 * night open or judged keeps its close. The nights kept are those dated up to the latest whose window
 * (from 18:00) has started on either clock, or up to the last day open in
 * a timezone the owner moved from. A second change before the next night
 * opens keeps the first clock; a change to the same clock keeps nothing.
 */
function keepEarlierClock(
  ctx: CoreContext,
  account: AccountId,
  timezone: string,
  before: string | null,
  latest: string,
  at: Date,
): void {
  const movedFrom = ctx.all<{ until: LocalDate; timezone: string }>(
    `SELECT until, timezone FROM pact_earlier_timezone
       WHERE pact_id IN (SELECT id FROM pact WHERE owner_account_id = ?)`,
    account,
  );
  // A night is worked out in the timezone it opened in, so the clock may change in any of them.
  const zones = [timezone, ...movedFrom.map((zone) => zone.timezone)];
  if (zones.every((zone) => ouraOffsetOf(before, zone) === ouraOffsetOf(latest, zone))) return;
  const [old, changed] = [ouraOffsetOf(before, timezone), ouraOffsetOf(latest, timezone)];
  let opened = laterDate(lastNightStarted(at, timezone, old), lastNightStarted(at, timezone, changed));
  for (const zone of movedFrom) opened = laterDate(opened, addDays(zone.until, -1));
  const until = addDays(opened, 1);
  const kept = ctx.one<{ until: LocalDate | null }>(
    `SELECT MAX(until) AS until FROM oura_earlier_clock WHERE account_id = ?`,
    account,
  )?.until;
  if (kept && until <= kept) return;
  ctx.db
    .prepare(`INSERT INTO oura_earlier_clock (account_id, until, bedtime_start) VALUES (?, ?, ?)`)
    .run(account, until, before);
}

/** The latest night whose window (from 18:00) has started by `at`, on the clock `offset` (in `timezone` with none). */
function lastNightStarted(at: Date, timezone: string, offset: NightOffset): LocalDate {
  const today =
    offset === null
      ? localDateOf(at, timezone)
      : new Date(at.getTime() + utcOffsetMs(offset)).toISOString().slice(0, 10);
  return nightStartsAt(today, timezone, offset).getTime() <= at.getTime() ? today : addDays(today, -1);
}

/**
 * One sleep as a source reports it, for judging bedtime nights
 * (`judgeNights`). Oura's sleep periods are one source (`ouraSessions`),
 * Apple Health's samples merged into sessions another (`appleHealthSessions`,
 * apple-health.ts).
 */
export interface SleepSession {
  /** ISO 8601, with a UTC offset where the source gives one; judging reads it on the night's clock (`NightClock`). */
  start: string;
  /** ISO 8601. */
  end: string;
  /** Whether it can decide a night: Oura's long_sleep, or an Apple Health session of 3 hours or more. Any other, such as a nap, never does. */
  isMain: boolean;
  /** The app the sleep came from, as Apple Health names it ("Oura"); null for Oura's own, and when Apple Health gives none. */
  source: string | null;
}

/**
 * Each account's sleep sessions for `judgeNights`: as a map, or asked for
 * once per account with a night waiting, with `from` its earliest such
 * night's date, so a source that keeps every sleep reads only what judging needs.
 */
export type SleepSessions = Map<AccountId, SleepSession[]> | ((account: AccountId, from: LocalDate) => SleepSession[]);

/** Oura's sleep periods, by account, as sleep sessions: a long_sleep is a main sleep. */
export function ouraSessions(sleep: Map<AccountId, OuraSleepPeriod[]>): Map<AccountId, SleepSession[]> {
  const sessions = new Map<AccountId, SleepSession[]>();
  for (const [account, periods] of sleep) {
    sessions.set(
      account,
      periods.map((period) => ({
        start: period.bedtime_start,
        end: period.bedtime_end,
        isMain: period.type === "long_sleep",
        source: null,
      })),
    );
  }
  return sessions;
}

/** A bedtime night waiting to be judged: its pact and evidence kind, the timezone it's worked out in and its pact's night clock. */
interface WaitingNight {
  pact: PactToJudge;
  kind: BedtimeKind;
  night: Occurrence;
  zone: string;
  clock: NightClock;
}

/**
 * Each night of a bedtime pact (of `only.kind`, and owned by `only.owner`,
 * when given) that hasn't been judged, from where judging got to, whose
 * window (18:00 that day to 18:00 the next) has started by `t`. An Ended
 * pact still has the nights that fell due before it Ended.
 */
function nightsWaiting(
  ctx: CoreContext,
  t: Date,
  only: { kind?: BedtimeKind; owner?: AccountId } = {},
): WaitingNight[] {
  const waiting: WaitingNight[] = [];
  for (const pact of [...pactsToJudge(ctx), ...endedBedtimePacts(ctx)]) {
    const kind = pact.evidence_kind;
    if (!isBedtimeKind(kind) || (only.kind !== undefined && kind !== only.kind)) continue;
    if (only.owner !== undefined && pact.owner_account_id !== only.owner) continue;
    const { timezone } = pact;
    const endedAt = pact.ended_at === null ? null : new Date(pact.ended_at);
    const until = endedAt !== null && endedAt.getTime() < t.getTime() ? endedAt : t;
    const from = pact.judged_through === null ? pact.first_occurrence : addDays(pact.judged_through, 1);
    const nights = occurrencesOf(ctx, pact.id, timezone);
    const clock = nightClockOf(ctx, kind, pact.owner_account_id);
    // After a move west, a night open in the timezone moved from may be dated tomorrow here.
    for (const night of nights.between(from, addDays(localDateOf(until, timezone), 1))) {
      // The window is on the clock the night closes on, where it opened.
      const zone = nights.timezoneOn(night.date);
      if (nightStartsAt(night.date, zone, clock.offsets(night.date, zone)).getTime() > t.getTime()) {
        continue;
      }
      if (endedAt !== null && night.dueAt.getTime() > endedAt.getTime()) break;
      if (!isJudged(ctx, pact.id, night.date)) waiting.push({ pact, kind, night, zone, clock });
    }
  }
  return waiting;
}

/** One account's sleep periods call: what it answered, or what it threw. */
type SleepFetched = { account: AccountId } & ({ result: OuraSleepResult } | { error: unknown });

/**
 * The sleep periods of each account (or just `owner`) with an Oura Ring night
 * waiting on Oura and a working connection, for the days those nights
 * could fall on. Accounts with nothing waiting, and connections that need
 * reconnecting, cause no calls. A "disconnected" result is no data, and
 * the account is listed for `markDisconnected`. A call that fails (a
 * timeout, Oura erroring) is no data too, but never disconnected: it's
 * logged, and the next tick tries again. Every account's call runs at once,
 * so a slow Oura delays the tick by its own call only, never by the sum of
 * everyone's.
 */
export async function fetchOuraSleep(
  ctx: CoreContext,
  ouraSource: OuraSource,
  t: Date,
  owner?: AccountId,
): Promise<FetchedSleep> {
  const askedAt = ctx.clock.now();
  const ranges = new Map<AccountId, { startDate: LocalDate; endDate: LocalDate }>();
  for (const { pact, night } of nightsWaiting(ctx, t, { kind: "oura", owner })) {
    if (connectionProblem(ctx, pact.owner_account_id, "oura") !== null) continue;
    // Oura files a night's sleep under the day it ends, usually the day after;
    // a day more covers a sleep that ends late, whether Oura's end_date is inclusive or not.
    const range = ranges.get(pact.owner_account_id);
    const endDate = addDays(night.date, 2);
    ranges.set(pact.owner_account_id, {
      startDate: range ? earlierDate(range.startDate, night.date) : night.date,
      endDate: range ? laterDate(range.endDate, endDate) : endDate,
    });
  }
  const sleep = new Map<AccountId, OuraSleepPeriod[]>();
  const disconnected: AccountId[] = [];
  const unreached: AccountId[] = [];
  // Results are folded in the order the accounts were asked, so the lists and
  // log lines keep a fixed order whichever call answers first.
  const fetched = await Promise.all(
    [...ranges].map(async ([account, range]): Promise<SleepFetched> => {
      try {
        return { account, result: await ouraSource.sleepPeriods(account, range) };
      } catch (error) {
        return { account, error };
      }
    }),
  );
  for (const outcome of fetched) {
    const { account } = outcome;
    if ("result" in outcome) {
      if (outcome.result.ok) sleep.set(account, outcome.result.periods);
      else disconnected.push(account);
    } else {
      ctx.log(`Oura sleep for account ${account} failed, no data this tick: ${errorText(outcome.error)}`);
      if (!(outcome.error instanceof OperatorAlerted)) unreached.push(account);
    }
  }
  return { sleep, disconnected, unreached, askedAt };
}

/**
 * At 15:00 the day after, a bedtime night still not judged sends its owner
 * one push, unless an excuse was filed for it or an approved vacation covers
 * it (a vacation waiting for approval keeps it, as it keeps reminders). One per owner and night, so
 * two pacts waiting on the same night send one, telling the owner how to
 * sync each kind waiting that night. A night already closed by the time the
 * scheduler gets here was just judged, so it sends none.
 */
export function pushNoSleepData(ctx: CoreContext, t: Date): void {
  const unsynced = new Map<string, { owner: AccountId; date: LocalDate; kinds: Set<BedtimeKind>; due: boolean }>();
  for (const { pact, kind, night, zone, clock } of nightsWaiting(ctx, t)) {
    if (t.getTime() >= night.closesAt.getTime() || isJudged(ctx, pact.id, night.date)) continue;
    if (!keepsToDo(coverOn(ctx, pact.id, night.date))) continue;
    const key = `${pact.owner_account_id} ${night.date}`;
    const entry = unsynced.get(key) ?? { owner: pact.owner_account_id, date: night.date, kinds: new Set(), due: false };
    entry.kinds.add(kind);
    // Each kind's night is on its own clock, so one may reach 15:00 before another.
    entry.due ||= t.getTime() >= noSleepDataPushAt(night.date, zone, clock.offsets(night.date, zone)).getTime();
    unsynced.set(key, entry);
  }
  for (const { owner, date, kinds, due } of unsynced.values()) {
    if (!due) continue;
    const sent = ctx.db
      .prepare(`INSERT INTO no_oura_data_push_sent (account_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(owner, date);
    if (sent.changes === 0) continue;
    const fixes = BEDTIME_KINDS.filter((kind) => kinds.has(kind)).map((kind, i) => {
      const fix = syncText(ctx, kind, owner);
      return i === 0 ? fix : fix[0]!.toLowerCase() + fix.slice(1);
    });
    ctx.enqueue({
      recipient: owner,
      kind: "connection-problem",
      payload: {
        occurrenceDate: date,
        title: `${formatDate(date).split(" ")[0]} night hasn't synced`,
        body: `${fixes.join(", and ")} before 6pm, or the night is missed.`,
        url: APP_PATHS.today,
      },
    });
  }
}

/** What the 15:00 push tells the owner of a `kind` night to do before it closes. */
function syncText(ctx: CoreContext, kind: BedtimeKind, owner: AccountId): string {
  switch (kind) {
    case "oura":
      return connectionProblem(ctx, owner, "oura") === null ? "Open the Oura app to sync it" : "Reconnect Oura";
    case "apple_health":
      // Pact can't reach the phone: the owner runs the Pact Health Shortcut, from Today's Sync now.
      return connectionProblem(ctx, owner, "apple_health") === null
        ? "Open Pact and tap Sync now"
        : "Set up Apple Health in Pact";
  }
}

/**
 * Settles the nights of bedtime pacts of evidence kind `kind` in order,
 * from where judging got to, as of `t`, given each account's `sessions`
 * from that kind's source. A night is decided by the first main sleep
 * starting in its window, read on the night's clock (`nightClockOf`),
 * which is kept on the night as it arrives, with its source (`verdictOf`
 * has the rules). A night with none by 18:00 the next day is judged then.
 * The first night still waiting stops the cursor.
 */
export function judgeNights(
  ctx: CoreContext,
  kind: BedtimeKind,
  t: Date,
  sessions: SleepSessions,
  owner?: AccountId,
): void {
  const waiting = nightsWaiting(ctx, t, { kind, owner });
  const sessionsOf = sessionsByAccount(waiting, sessions);
  const stopped = new Set<string>();
  for (const { pact, night, zone, clock } of waiting) {
    if (stopped.has(pact.id)) continue;
    const first = (sessionsOf.get(pact.owner_account_id) ?? [])
      .filter((session) => session.isMain)
      .map((session) => ({ start: clock.read(session.start, zone), source: session.source }))
      .filter((read) => nightOf(read.start) === night.date)
      .sort((a, b) => wallClock(a.start).localeCompare(wallClock(b.start), "en-US"))[0];
    if (first !== undefined) noteFirstSleep(ctx, pact.id, night.date, first, t);
    if (settle(ctx, pact.id, night.date, t) === null) {
      stopped.add(pact.id);
      continue;
    }
    ctx.db.prepare(`UPDATE pact SET judged_through = ? WHERE id = ?`).run(night.date, pact.id);
  }
}

/** `sessions` as a map of the accounts with a night in `waiting`, asking a source that's asked once per account. */
function sessionsByAccount(waiting: WaitingNight[], sessions: SleepSessions): Map<AccountId, SleepSession[]> {
  if (sessions instanceof Map) return sessions;
  const from = new Map<AccountId, LocalDate>();
  for (const { pact, night } of waiting) {
    const earliest = from.get(pact.owner_account_id);
    from.set(pact.owner_account_id, earliest === undefined ? night.date : earlierDate(earliest, night.date));
  }
  return new Map([...from].map(([account, date]) => [account, sessions(account, date)]));
}

/**
 * Keeps when the night's first main sleep started, on the night's clock,
 * where it came from and when it arrived, unless it already has one.
 */
function noteFirstSleep(
  ctx: CoreContext,
  pactId: string,
  date: LocalDate,
  sleep: { start: string; source: string | null },
  at: Date,
): void {
  ctx.db.prepare(`INSERT INTO occurrence (pact_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING`).run(pactId, date);
  ctx.db
    .prepare(
      `UPDATE occurrence SET bedtime_start = ?, bedtime_source = ?, bedtime_arrived_at = ?
         WHERE pact_id = ? AND date = ? AND bedtime_start IS NULL`,
    )
    .run(sleep.start, sleep.source, at.toISOString(), pactId, date);
}

/**
 * What `fetchOuraSleep` got from Oura: sleep by account, the accounts it answered
 * "disconnected" for, the accounts whose call failed (other than on a failure
 * already raised as an operator alert), and when it was asked.
 */
interface FetchedSleep {
  sleep: Map<AccountId, OuraSleepPeriod[]>;
  disconnected: AccountId[];
  unreached: AccountId[];
  askedAt: Date;
}
