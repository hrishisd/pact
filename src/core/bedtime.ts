// Bedtime pacts: checking Oura, judging each night from the sleep it
// reports, and the push when a night has no Oura data.

import { APP_PATHS } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import { formatDate } from "../shared/format.ts";
import type { AccountId, LocalDate } from "../shared/types.ts";
import { earlierDate, laterDate, localDateOf } from "./calendar.ts";
import { checkedWithin, errorText, markDisconnected } from "./connections.ts";
import type { Command, CoreContext } from "./context.ts";
import { coverOn, keepsToDo } from "./covers.ts";
import { enqueueMissed, judge } from "./judging.ts";
import { endedBedtimePacts, isJudged, pactsToJudge, type PactToJudge } from "./occurrence-state.ts";
import { nightStartsAt, noOuraDataPushAt, type Occurrence } from "./occurrences.ts";
import { deadlineWallClock, nightOf, utcOffsetOf, wallClock } from "./oura-clock.ts";
import type { OuraSleepPeriod, OuraSource } from "./ports.ts";
import { accountRow, connectionProblem, occurrencesOf, ouraOffset, ownerZone, termsOn } from "./rows.ts";

/** The core ignores a check of Oura now this soon after the account's last one. */
const OURA_CHECK_INTERVAL_MS = 15_000;

export async function checkOura(
  ctx: CoreContext,
  accountId: AccountId,
  ouraChecks: Map<AccountId, number>,
  ouraSource: OuraSource,
  command: Command,
): Promise<void> {
  accountRow(ctx, accountId);
  const now = ctx.clock.now();
  if (checkedWithin(ouraChecks, accountId, now, OURA_CHECK_INTERVAL_MS)) return;
  ouraChecks.set(accountId, now.getTime());
  const fetched = await fetchSleep(ctx, ouraSource, now, accountId);
  await command(() => {
    for (const account of fetched.disconnected) markDisconnected(ctx, "oura", account, fetched.askedAt);
    noteOuraClock(ctx, fetched.sleep);
    judgeNights(ctx, now, fetched.sleep, accountId);
  });
}

/**
 * Keeps, for each account in `sleep`, the latest bedtime_start Oura has
 * reported with a UTC offset, by when it happened: Oura's clock where the
 * owner is now, for `ouraOffset`. Deleted periods don't count.
 */
export function noteOuraClock(ctx: CoreContext, sleep: Map<AccountId, OuraSleepPeriod[]>): void {
  for (const [account, periods] of sleep) {
    const row = ctx.one<{ oura_latest_bedtime_start: string | null }>(
      `SELECT oura_latest_bedtime_start FROM account WHERE id = ?`,
      account,
    );
    let latest = row?.oura_latest_bedtime_start ?? null;
    for (const { type, bedtime_start: start } of periods) {
      if (type === "deleted" || utcOffsetOf(start) === null) continue;
      if (latest === null || Date.parse(start) > Date.parse(latest)) latest = start;
    }
    if (latest === null || latest === row?.oura_latest_bedtime_start) continue;
    ctx.db.prepare(`UPDATE account SET oura_latest_bedtime_start = ? WHERE id = ?`).run(latest, account);
  }
}

/**
 * Each night of a bedtime pact that hasn't been judged, from where judging
 * got to, whose window (18:00 that day to 18:00 the next) has started by `t`.
 * An Ended pact still has the nights that fell due before it Ended.
 */
function nightsWaiting(
  ctx: CoreContext,
  t: Date,
  owner?: AccountId,
): { pact: PactToJudge & { timezone: string }; night: Occurrence }[] {
  const waiting = [];
  for (const pact of [...pactsToJudge(ctx), ...endedBedtimePacts(ctx)]) {
    if (pact.evidence_kind !== "oura") continue;
    if (owner !== undefined && pact.owner_account_id !== owner) continue;
    const timezone = ownerZone(pact.timezone, pact.owner_account_id);
    const endedAt = pact.ended_at === null ? null : new Date(pact.ended_at);
    const until = endedAt !== null && endedAt.getTime() < t.getTime() ? endedAt : t;
    const from = pact.judged_through === null ? pact.first_occurrence : addDays(pact.judged_through, 1);
    // The window is on the clock the night closes on.
    const offset = ouraOffset(ctx, pact.owner_account_id, timezone);
    for (const night of occurrencesOf(ctx, pact.id, timezone).between(from, localDateOf(until, timezone))) {
      if (nightStartsAt(night.date, timezone, offset).getTime() > t.getTime()) break;
      if (endedAt !== null && night.dueAt.getTime() > endedAt.getTime()) break;
      if (!isJudged(ctx, pact.id, night.date)) waiting.push({ pact: { ...pact, timezone }, night });
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
  for (const [account, range] of ranges) {
    try {
      const result = await ouraSource.sleepPeriods(account, range);
      if (result.ok) sleep.set(account, result.periods);
      else disconnected.push(account);
    } catch (error) {
      ctx.log(`Oura sleep for account ${account} failed, no data this tick: ${errorText(error)}`);
    }
  }
  return { sleep, disconnected, askedAt };
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
    const offset = ouraOffset(ctx, pact.owner_account_id, pact.timezone);
    if (t.getTime() < noOuraDataPushAt(night.date, pact.timezone, offset).getTime()) continue;
    if (t.getTime() >= night.closesAt.getTime() || isJudged(ctx, pact.id, night.date)) continue;
    if (!keepsToDo(coverOn(ctx, pact.id, night.date))) continue;
    const sent = ctx.db
      .prepare(`INSERT INTO no_oura_data_push_sent (account_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(pact.owner_account_id, night.date);
    if (sent.changes === 0) continue;
    const fix = connectionProblem(ctx, pact.owner_account_id, "oura") === null ? "Sync your ring" : "Reconnect Oura";
    ctx.enqueue({
      recipient: pact.owner_account_id,
      kind: "connection-problem",
      payload: {
        occurrenceDate: night.date,
        title: "No Oura data",
        body: `No Oura data for ${formatDate(night.date).split(" ")[0]} night yet. ${fix} before 6pm or it counts as missed.`,
        url: APP_PATHS.today,
      },
    });
  }
}

/**
 * Judges bedtime nights in order, from where judging got to. A night is
 * decided by the first long_sleep Oura reports starting in its window,
 * read on Oura's own clock: Satisfied if it starts before the in-bed-by time,
 * else Missed, as of `t`, when it arrived. With an approved excuse or
 * vacation, a late period makes it Excused instead, and so does no period by
 * 18:00 the next day, then. With neither by then, it's Missed then. The first night still
 * waiting stops the cursor.
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
    const inBedBy = termsOn(ctx, pact.id, night.date).in_bed_by!;
    const period = (sleep.get(pact.owner_account_id) ?? [])
      .filter((p) => p.type === "long_sleep" && nightOf(p.bedtime_start) === night.date)
      .sort((a, b) => wallClock(a.bedtime_start).localeCompare(wallClock(b.bedtime_start), "en-US"))[0];
    const cover = coverOn(ctx, pact.id, night.date);
    const satisfied = period !== undefined && wallClock(period.bedtime_start) < deadlineWallClock(night.date, inBedBy);
    // As for a photo: an on-time bedtime beats an approved excuse, and an approved excuse beats a late one.
    // So with no period yet, an approved excuse waits for one until the night closes.
    if (
      cover?.state === "approved" &&
      !satisfied &&
      (period !== undefined || night.closesAt.getTime() <= t.getTime())
    ) {
      judge(ctx, pact.id, night.date, "excused", period ? t : night.closesAt);
    } else if (period) {
      judge(ctx, pact.id, night.date, satisfied ? "satisfied" : "missed", t);
      ctx.db
        .prepare(`UPDATE occurrence SET bedtime_start = ? WHERE pact_id = ? AND date = ?`)
        .run(period.bedtime_start, pact.id, night.date);
      if (!satisfied && cover === null) enqueueMissed(ctx, pact.id, night.date);
    } else if (night.closesAt.getTime() <= t.getTime()) {
      judge(ctx, pact.id, night.date, "missed", night.closesAt);
      if (cover === null) enqueueMissed(ctx, pact.id, night.date);
    } else {
      stopped.add(pact.id);
      continue;
    }
    ctx.db.prepare(`UPDATE pact SET judged_through = ? WHERE id = ?`).run(night.date, pact.id);
  }
}

/** What `fetchSleep` got from Oura: sleep by account, the accounts it answered "disconnected" for, and when it was asked. */
interface FetchedSleep {
  sleep: Map<AccountId, OuraSleepPeriod[]>;
  disconnected: AccountId[];
  askedAt: Date;
}
