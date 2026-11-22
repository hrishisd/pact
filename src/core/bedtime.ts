// Bedtime pacts: checking Oura, judging each night from the sleep it
// reports, and the push when a night has no Oura data.

import { APP_PATHS } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import { formatDate } from "../shared/format.ts";
import type { AccountId, CheckNowResult, LocalDate } from "../shared/types.ts";
import { earlierDate, laterDate, localDateOf } from "./calendar.ts";
import { errorText, markDisconnected, recentCheckNow, type ChecksNow } from "./connections.ts";
import type { Command, CoreContext } from "./context.ts";
import { coverOn, keepsToDo } from "./covers.ts";
import { endedBedtimePacts, isJudged, pactsToJudge, type PactToJudge } from "./occurrence-state.ts";
import { nightStartsAt, noOuraDataPushAt, utcOffsetMs, type Occurrence, type OuraOffset } from "./occurrences.ts";
import { nightOf, utcOffsetOf, wallClock } from "./oura-clock.ts";
import { OperatorAlerted, type OuraSleepPeriod, type OuraSource } from "./ports.ts";
import { connectionProblem, occurrencesOf, ouraClockOf, ouraOffsetOf } from "./rows.ts";
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
  const fetched = await fetchSleep(ctx, ouraSource, now, accountId);
  await command(() => {
    for (const account of fetched.disconnected) markDisconnected(ctx, "oura", account, fetched.askedAt);
    noteOuraClock(ctx, fetched.sleep, now);
    judgeNights(ctx, now, fetched.sleep, accountId);
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
function lastNightStarted(at: Date, timezone: string, offset: OuraOffset): LocalDate {
  const today =
    offset === null
      ? localDateOf(at, timezone)
      : new Date(at.getTime() + utcOffsetMs(offset)).toISOString().slice(0, 10);
  return nightStartsAt(today, timezone, offset).getTime() <= at.getTime() ? today : addDays(today, -1);
}

/**
 * Each night of a bedtime pact that hasn't been judged, from where judging
 * got to, whose window (18:00 that day to 18:00 the next) has started by `t`.
 * An Ended pact still has the nights that fell due before it Ended.
 */
function nightsWaiting(ctx: CoreContext, t: Date, owner?: AccountId): { pact: PactToJudge; night: Occurrence }[] {
  const waiting = [];
  for (const pact of [...pactsToJudge(ctx), ...endedBedtimePacts(ctx)]) {
    if (pact.evidence_kind !== "oura") continue;
    if (owner !== undefined && pact.owner_account_id !== owner) continue;
    const { timezone } = pact;
    const endedAt = pact.ended_at === null ? null : new Date(pact.ended_at);
    const until = endedAt !== null && endedAt.getTime() < t.getTime() ? endedAt : t;
    const from = pact.judged_through === null ? pact.first_occurrence : addDays(pact.judged_through, 1);
    const nights = occurrencesOf(ctx, pact.id, timezone);
    const clock = ouraClockOf(ctx, pact.owner_account_id);
    // After a move west, a night open in the timezone moved from may be dated tomorrow here.
    for (const night of nights.between(from, addDays(localDateOf(until, timezone), 1))) {
      // The window is on the clock the night closes on, where it opened.
      const zone = nights.timezoneOn(night.date);
      if (nightStartsAt(night.date, zone, clock(night.date, zone)).getTime() > t.getTime()) {
        continue;
      }
      if (endedAt !== null && night.dueAt.getTime() > endedAt.getTime()) break;
      if (!isJudged(ctx, pact.id, night.date)) waiting.push({ pact, night });
    }
  }
  return waiting;
}

/**
 * The sleep periods of each account (or just `owner`) with a bedtime night
 * waiting on Oura and a working connection, for the days those nights
 * could fall on. Accounts with nothing waiting, and connections that need
 * reconnecting, cause no calls. A "disconnected" result is no data, and
 * the account is listed for `markDisconnected`. A call that fails (a
 * timeout, Oura erroring) is no data too, but never disconnected: it's
 * logged, the next tick tries again, and one account's Oura never holds up
 * anyone else's tick.
 */
export async function fetchSleep(
  ctx: CoreContext,
  ouraSource: OuraSource,
  t: Date,
  owner?: AccountId,
): Promise<FetchedSleep> {
  const askedAt = ctx.clock.now();
  const ranges = new Map<AccountId, { startDate: LocalDate; endDate: LocalDate }>();
  for (const { pact, night } of nightsWaiting(ctx, t, owner)) {
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
  for (const [account, range] of ranges) {
    try {
      const result = await ouraSource.sleepPeriods(account, range);
      if (result.ok) sleep.set(account, result.periods);
      else disconnected.push(account);
    } catch (error) {
      ctx.log(`Oura sleep for account ${account} failed, no data this tick: ${errorText(error)}`);
      if (!(error instanceof OperatorAlerted)) unreached.push(account);
    }
  }
  return { sleep, disconnected, unreached, askedAt };
}

/**
 * At 15:00 the day after, a bedtime night still not judged sends its owner
 * one push, unless an excuse was filed for it or an approved vacation covers
 * it (a vacation waiting for approval keeps it, as it keeps reminders). One per owner and night, so
 * two pacts waiting on the same night send one. A night already closed by
 * the time the scheduler gets here was just judged, so it sends none.
 */
export function pushNoOuraData(ctx: CoreContext, t: Date): void {
  for (const { pact, night } of nightsWaiting(ctx, t)) {
    const zone = occurrencesOf(ctx, pact.id, pact.timezone).timezoneOn(night.date);
    const offset = ouraClockOf(ctx, pact.owner_account_id)(night.date, zone);
    if (t.getTime() < noOuraDataPushAt(night.date, zone, offset).getTime()) continue;
    if (t.getTime() >= night.closesAt.getTime() || isJudged(ctx, pact.id, night.date)) continue;
    if (!keepsToDo(coverOn(ctx, pact.id, night.date))) continue;
    const sent = ctx.db
      .prepare(`INSERT INTO no_oura_data_push_sent (account_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(pact.owner_account_id, night.date);
    if (sent.changes === 0) continue;
    const fix =
      connectionProblem(ctx, pact.owner_account_id, "oura") === null
        ? "Open the Oura app to sync it"
        : "Reconnect Oura";
    ctx.enqueue({
      recipient: pact.owner_account_id,
      kind: "connection-problem",
      payload: {
        occurrenceDate: night.date,
        title: `${formatDate(night.date).split(" ")[0]} night hasn't synced`,
        body: `${fix} before 6pm, or the night is missed.`,
        url: APP_PATHS.today,
      },
    });
  }
}

/**
 * Settles bedtime nights in order, from where judging got to, as of `t`.
 * A night is decided by the first long_sleep Oura reports starting in its
 * window, read on Oura's own clock, which is kept on the night as it
 * arrives (`verdictOf` has the rules). A night with none by 18:00 the next
 * day is judged then. The first night still waiting stops the cursor.
 */
export function judgeNights(
  ctx: CoreContext,
  t: Date,
  sleep: Map<AccountId, OuraSleepPeriod[]>,
  owner?: AccountId,
): void {
  const stopped = new Set<string>();
  for (const { pact, night } of nightsWaiting(ctx, t, owner)) {
    if (stopped.has(pact.id)) continue;
    const period = (sleep.get(pact.owner_account_id) ?? [])
      .filter((p) => p.type === "long_sleep" && nightOf(p.bedtime_start) === night.date)
      .sort((a, b) => wallClock(a.bedtime_start).localeCompare(wallClock(b.bedtime_start), "en-US"))[0];
    if (period) noteFirstSleep(ctx, pact.id, night.date, period.bedtime_start, t);
    if (settle(ctx, pact.id, night.date, t) === null) {
      stopped.add(pact.id);
      continue;
    }
    ctx.db.prepare(`UPDATE pact SET judged_through = ? WHERE id = ?`).run(night.date, pact.id);
  }
}

/** Keeps the night's first sleep period, and when it arrived, unless it already has one. */
function noteFirstSleep(ctx: CoreContext, pactId: string, date: LocalDate, bedtimeStart: string, at: Date): void {
  ctx.db.prepare(`INSERT INTO occurrence (pact_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING`).run(pactId, date);
  ctx.db
    .prepare(
      `UPDATE occurrence SET bedtime_start = ?, bedtime_arrived_at = ?
         WHERE pact_id = ? AND date = ? AND bedtime_start IS NULL`,
    )
    .run(bedtimeStart, at.toISOString(), pactId, date);
}

/**
 * What `fetchSleep` got from Oura: sleep by account, the accounts it answered
 * "disconnected" for, the accounts whose call failed (other than on a failure
 * already raised as an operator alert), and when it was asked.
 */
interface FetchedSleep {
  sleep: Map<AccountId, OuraSleepPeriod[]>;
  disconnected: AccountId[];
  unreached: AccountId[];
  askedAt: Date;
}
