// The scenario harness's check that judging stored what `verdictOf` says.
// After every command and every tick a scenario runs, it reads every
// occurrence of every pact on its own connection to the scenario's database
// and compares the stored outcome, judging time and penalty with the verdict.
// A mismatch fails the test, unless it's a known one listed below with the
// ticket that fixes it.
//
// Two facts it watches for itself: which checks of AnkiWeb are still
// running, which the core keeps only in memory, and when each bedtime
// night's first main sleep reached the core. The core stores the latter
// (`judgeNights`); the check works it out instead from what Oura gave the
// core, or for an Apple Health night from the samples uploaded (merged into
// sessions here, by the spec's rules), so a wrong stored sleep shows as a
// mismatch too.

import { addDays } from "../../shared/calendar.ts";
import type { AccountId, AppleHealthUpload, EvidenceKind, LocalDate } from "../../shared/types.ts";
import { localDateOf, wallTime } from "../calendar.ts";
import { createContext, type CoreContext } from "../context.ts";
import { openWithPragmas, type Db } from "../db.ts";
import { inTimezone, nightOf, wallClock } from "../night-clock.ts";
import type { AnkiSource, Clock, OuraSleepPeriod, OuraSource } from "../ports.ts";
import { ANKI_CHECK_HOLDS_JUDGING_MS } from "../judging.ts";
import { occurrencesOf } from "../rows.ts";
import {
  dueJudgedFrom,
  occurrenceFacts,
  verdictOf,
  type AnkiCheckRun,
  type OccurrenceFacts,
  type Verdict,
} from "../verdict.ts";

/** What's stored for an occurrence: its outcome and judging time, and its penalties. */
interface Stored {
  outcome: "satisfied" | "missed" | "excused" | null;
  judgedAt: Date | null;
  penalties: { amountCents: number; recipientId: string }[];
}

export interface Mismatch {
  pactId: string;
  date: LocalDate;
  stored: Stored;
  verdict: Verdict;
  /** Null for a stored outcome on a date the pact has no occurrence. */
  facts: OccurrenceFacts | null;
}

/**
 * Mismatches the check skips: each a bug a ticket fixes. Remove an entry
 * with the fix.
 */
const KNOWN_MISMATCHES: { ticket: string; matches: (m: Mismatch) => boolean }[] = [];

/** The ticket that fixes a known mismatch, or null if it isn't one. */
function knownMismatchTicket(mismatch: Mismatch): string | null {
  return KNOWN_MISMATCHES.find((known) => known.matches(mismatch))?.ticket ?? null;
}

/**
 * A time the core judged Apple Health nights: a tick (every account's) or an
 * upload (its account's, with the sleep samples it kept), and each account's
 * timezone then, filled in by the check after it (`noteTimezones`).
 */
interface AppleHealthJudging {
  at: Date;
  /** The account that uploaded; null for a tick. */
  account: AccountId | null;
  sleep: { start: number; end: number }[];
  timezones: Map<AccountId, string | null> | null;
}

/** Watches what the core asks of Oura and AnkiWeb, what Apple Health uploads it gets, and when the scheduler ticks. */
export class SourceWatch {
  readonly #clock: Clock;
  /** By account: each time the core asked Oura for sleep, and what it got (none if the call failed). */
  readonly #ouraCalls = new Map<AccountId, { at: Date; periods: OuraSleepPeriod[] }[]>();
  /** By account: each check of AnkiWeb, and when it was answered (null while it runs). */
  readonly #ankiChecks = new Map<AccountId, AnkiCheckRun[]>();
  readonly #ticks: Date[] = [];
  /** In order: each tick and each Apple Health upload. */
  readonly #judgings: AppleHealthJudging[] = [];

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  oura(source: OuraSource): OuraSource {
    return new Proxy(source, {
      get: (target, prop) => {
        const value = Reflect.get(target, prop, target) as unknown;
        if (typeof value !== "function") return value;
        // The fakes keep private fields, so their other methods run on the fake itself.
        if (prop !== "sleepPeriods") return (value as (...args: unknown[]) => unknown).bind(target);
        const sleepPeriods = value as OuraSource["sleepPeriods"];
        return async (account: AccountId, range: Parameters<OuraSource["sleepPeriods"]>[1]) => {
          const call = { at: this.#clock.now(), periods: [] as OuraSleepPeriod[] };
          this.#ouraCalls.set(account, [...(this.#ouraCalls.get(account) ?? []), call]);
          const result = await sleepPeriods.call(target, account, range);
          if (result.ok) call.periods = result.periods;
          return result;
        };
      },
    });
  }

  anki(source: AnkiSource): AnkiSource {
    return new Proxy(source, {
      get: (target, prop) => {
        const value = Reflect.get(target, prop, target) as unknown;
        if (typeof value !== "function") return value;
        // The fakes keep private fields, so their other methods run on the fake itself.
        if (prop !== "deckCounts") return (value as (...args: unknown[]) => unknown).bind(target);
        const deckCounts = value as AnkiSource["deckCounts"];
        return async (account: AccountId, deckIds: readonly string[]) => {
          const check: AnkiCheckRun = { startedAt: this.#clock.now(), finishedAt: null };
          this.#ankiChecks.set(account, [...(this.#ankiChecks.get(account) ?? []), check]);
          try {
            return await deckCounts.call(target, account, deckIds);
          } finally {
            check.finishedAt = this.#clock.now();
          }
        };
      },
    });
  }

  /**
   * Changes whenever what it says may change: a sleep period seen for the
   * first time, or a check of AnkiWeb started or answered. Calls to Oura that
   * bring nothing new, and ticks after every call, change nothing it says.
   */
  version(): string {
    const firstSeen = [...this.#ouraCalls].map(([account, calls]) => {
      const seen = new Map<string, number>();
      for (const call of calls) for (const p of call.periods) if (!seen.has(p.id)) seen.set(p.id, call.at.getTime());
      return [account, [...seen]];
    });
    const uploads = this.#judgings.filter((judging) => judging.account !== null).length;
    return JSON.stringify([firstSeen, [...this.#ankiChecks], uploads]);
  }

  tick(at: Date): void {
    this.#ticks.push(at);
    this.#judgings.push({ at, account: null, sleep: [], timezones: null });
  }

  /** An upload the core took from `account` at `at`: the sleep samples it keeps and judges by. */
  appleHealthUpload(account: AccountId, at: Date, upload: AppleHealthUpload): void {
    this.#judgings.push({ at, account, sleep: countedSleep(upload, at), timezones: null });
  }

  /** Gives each tick and upload since the last call the accounts' timezones now, which they had then. */
  noteTimezones(timezones: () => Map<AccountId, string | null>): void {
    const unnoted = this.#judgings.filter((judging) => judging.timezones === null);
    if (unnoted.length === 0) return;
    const now = timezones();
    for (const judging of unnoted) judging.timezones = now;
  }

  /** How many ticks and uploads there have been: a pact first seen now was made after them. */
  judgingCount(): number {
    return this.#judgings.length;
  }

  ankiChecks(account: AccountId): AnkiCheckRun[] {
    return (this.#ankiChecks.get(account) ?? []).map((check) => ({ ...check }));
  }

  /**
   * The first long_sleep period the core got for the account's night on
   * `date`, and when, as judging takes it: if a tick or a call to Oura came
   * after the night closed and before the period arrived, the night was
   * judged without it, so it has none.
   */
  firstSleep(account: AccountId, date: LocalDate, closesAt: Date): { start: string; arrivedAt: Date } | null {
    const calls = this.#ouraCalls.get(account) ?? [];
    for (const call of calls) {
      const periods = call.periods
        .filter((p) => p.type === "long_sleep" && nightOf(p.bedtime_start) === date)
        .sort((a, b) => wallClock(a.bedtime_start).localeCompare(wallClock(b.bedtime_start), "en-US"));
      if (periods.length === 0) continue;
      const judgedWithout = [...calls.map((c) => c.at), ...this.#ticks].some(
        (t) => t.getTime() >= closesAt.getTime() && t.getTime() < call.at.getTime(),
      );
      return judgedWithout ? null : { start: periods[0]!.bedtime_start, arrivedAt: call.at };
    }
    return null;
  }

  /**
   * The first main sleep the core had for the account's Apple Health night
   * on `date`, read on `zone`'s clock, and when: at the first tick or upload
   * of the account's, from the `after`th on (the pact's making), whose
   * samples so far show one; none if one at or after `closesAt` came first,
   * which judged the night without it.
   */
  appleHealthFirstSleep(
    account: AccountId,
    date: LocalDate,
    zone: string,
    closesAt: Date,
    after: number,
  ): { start: string; arrivedAt: Date } | null {
    const sleep: { start: number; end: number }[] = [];
    for (const [i, judging] of this.#judgings.entries()) {
      if (judging.account !== null && judging.account !== account) continue;
      sleep.push(...judging.sleep);
      if (i < after) continue;
      const start = firstMainSleep(sleep, judging.timezones?.get(account) ?? null, date, zone);
      if (start !== null) return { start, arrivedAt: judging.at };
      if (judging.at.getTime() >= closesAt.getTime()) return null;
    }
    return null;
  }
}

const MINUTE_MS = 60 * 1000;

/**
 * The spec's rules for an upload's sleep samples, worked out apart from the
 * core's: type "sleep" in any case, ISO 8601 dates with an offset, not ending
 * before they start, more than 14 days old or starting after the upload,
 * and no "awake" in the value.
 */
function countedSleep(upload: AppleHealthUpload, at: Date): { start: number; end: number }[] {
  const counted: { start: number; end: number }[] = [];
  for (const sample of upload.samples) {
    const [start, end] = [instantMs(sample.start), instantMs(sample.end)];
    if (sample.type.trim().toLowerCase() !== "sleep" || start === null || end === null || end < start) continue;
    if (end < at.getTime() - 14 * 24 * 60 * MINUTE_MS || start > at.getTime()) continue;
    if (!sample.value.toLowerCase().includes("awake")) counted.push({ start, end });
  }
  return counted;
}

function instantMs(text: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|([+-]\d{2}):?(\d{2}))$/.exec(text.trim());
  if (!match) return null;
  const ms = Date.parse(match[1]! + (match[2] === "Z" ? "Z" : `${match[3]}:${match[4]}`));
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The start, on `zone`'s clock, of the first main sleep (3 hours or more)
 * of the night of `date` in `sleep`, merged into sessions where samples
 * overlap or are at most an hour apart with no 18:00 in `timezone` (the
 * account's) from one to the next; null if there's none.
 */
function firstMainSleep(
  sleep: { start: number; end: number }[],
  timezone: string | null,
  date: LocalDate,
  zone: string,
): string | null {
  const sorted = [...sleep].sort((a, b) => a.start - b.start || a.end - b.end);
  const sessions: { start: number; end: number }[] = [];
  for (const sample of sorted) {
    const last = sessions.at(-1);
    if (
      last &&
      sample.start - last.end <= 60 * MINUTE_MS &&
      !(timezone && sixPmFrom(last.end, sample.start, timezone))
    ) {
      last.end = Math.max(last.end, sample.end);
    } else sessions.push({ ...sample });
  }
  const starts = sessions
    .filter((session) => session.end - session.start >= 3 * 60 * MINUTE_MS)
    .map((session) => inTimezone(new Date(session.start).toISOString(), zone))
    .filter((start) => nightOf(start) === date)
    .sort((a, b) => wallClock(a).localeCompare(wallClock(b), "en-US"));
  return starts[0] ?? null;
}

/** Whether 18:00 in `timezone` falls from `from` to `to`, both included. */
function sixPmFrom(from: number, to: number, timezone: string): boolean {
  const day = localDateOf(new Date(from), timezone);
  return [day, addDays(day, 1)].some((d) => {
    const sixPm = wallTime(d, 18, 0, timezone).getTime();
    return sixPm >= from && sixPm <= to;
  });
}

/** Checks a scenario's database after each command and tick; see the top of this file. */
export class VerdictCheck {
  readonly #dbPath: string;
  readonly #clock: Clock;
  readonly #watch: SourceWatch;
  #db: Db | null = null;
  /**
   * The last full check: what it read, when, the instants after which time
   * alone could change a verdict, and whether it let any occurrence wait for
   * a tick. A check with the same facts and none of those instants passed
   * would find the same, so it's skipped: a scenario ticking hourly for weeks
   * stays quick.
   */
  #last: { readAt: string; now: Date; instants: number[]; tickedThrough: string | null } | null = null;
  /** By pact: how many ticks and uploads the watch had seen when a check first saw the pact (just after it was made). */
  readonly #pactSeenAfter = new Map<string, number>();

  constructor(dbPath: string, clock: Clock, watch: SourceWatch) {
    this.#dbPath = dbPath;
    this.#clock = clock;
    this.#watch = watch;
  }

  /** Throws listing every mismatch not known. */
  check(): void {
    const ctx = this.#context();
    this.#noteJudgings(ctx);
    const now = this.#clock.now();
    const readAt = factsFingerprint(ctx) + this.#watch.version();
    const tickedThrough = lastTickOf(ctx);
    const last = this.#last;
    if (
      last !== null &&
      last.readAt === readAt &&
      now.getTime() >= last.now.getTime() &&
      (last.tickedThrough === null || last.tickedThrough === tickedThrough) &&
      !last.instants.some((t) => t > last.now.getTime() && t <= now.getTime())
    ) {
      return;
    }
    const instants: number[] = [];
    let waitsForTick = false;
    const mismatches = this.mismatches(instants, () => (waitsForTick = true)).filter(
      (m) => knownMismatchTicket(m) === null,
    );
    this.#last = { readAt, now, instants, tickedThrough: waitsForTick ? tickedThrough : null };
    if (mismatches.length === 0) return;
    throw new Error(
      `stored outcomes differ from verdictOf at ${this.#clock.now().toISOString()}:\n` +
        mismatches
          .map(
            (m) =>
              `  pact ${m.pactId} ${m.date}: stored ${JSON.stringify(m.stored)}, verdict ${JSON.stringify(m.verdict)}`,
          )
          .join("\n"),
    );
  }

  /**
   * Every occurrence whose stored outcome isn't its verdict. Adds to
   * `instants` each time at which an occurrence opens, falls due, closes or
   * stops being held, and calls `waitsForTick` when one is let wait for a tick.
   */
  mismatches(instants: number[] = [], waitsForTick: () => void = () => {}): Mismatch[] {
    const ctx = this.#context();
    this.#noteJudgings(ctx);
    const now = this.#clock.now();
    const lastTick = lastTickOf(ctx);
    const tickedThrough = lastTick === null ? null : new Date(lastTick);
    const pacts = ctx.all<{
      id: string;
      timezone: string;
      first_occurrence: LocalDate;
      owner: AccountId;
      evidence_kind: EvidenceKind;
    }>(
      `SELECT pact.id, account.timezone, pact.first_occurrence, pact.owner_account_id AS owner, pact.evidence_kind
         FROM pact JOIN account ON account.id = pact.owner_account_id ORDER BY pact.id`,
    );
    // Occurrences are listed only a week ahead, so a jump past that checks again.
    instants.push(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const found: Mismatch[] = [];
    for (const pact of pacts) {
      const occurrences = occurrencesOf(ctx, pact.id, pact.timezone);
      const upToTomorrow = occurrences.between(pact.first_occurrence, addDays(localDateOf(now, pact.timezone), 1));
      // A week ahead too, for an occurrence opening before the next check.
      for (const o of occurrences.between(pact.first_occurrence, addDays(localDateOf(now, pact.timezone), 8))) {
        instants.push(o.opensAt.getTime(), o.dueAt.getTime(), o.closesAt.getTime());
      }
      for (const check of this.#watch.ankiChecks(pact.owner)) {
        instants.push(check.startedAt.getTime() + ANKI_CHECK_HOLDS_JUDGING_MS);
      }
      const opened = upToTomorrow
        .filter((occurrence) => occurrence.opensAt.getTime() <= now.getTime())
        .map((occurrence) => occurrence.date);
      const storedDates = ctx
        .all<{ date: LocalDate }>(`SELECT date FROM occurrence WHERE pact_id = ?`, pact.id)
        .map((row) => row.date);
      for (const date of new Set([...opened, ...storedDates])) {
        const stored = storedOf(ctx, pact.id, date);
        const checks = this.#watch.ankiChecks(pact.owner);
        const facts = occurrenceFacts(ctx, pact.id, date, { occurrences });
        if (facts === null) {
          if (stored.outcome !== null || stored.penalties.length > 0) {
            found.push({ pactId: pact.id, date, stored, verdict: { kind: "not-the-pacts" }, facts: null });
          }
          continue;
        }
        // A bedtime night's sleep as Oura gave it to the core, or as uploaded from Apple Health.
        if (facts.automatic?.kind === "bedtime") {
          const { closesAt } = facts.occurrence;
          const sleep =
            pact.evidence_kind === "oura"
              ? this.#watch.firstSleep(pact.owner, date, closesAt)
              : this.#watch.appleHealthFirstSleep(
                  pact.owner,
                  date,
                  occurrences.timezoneOn(date),
                  closesAt,
                  this.#pactSeenAfter.get(pact.id) ?? 0,
                );
          facts.automatic = {
            ...facts.automatic,
            bedtimeStart: sleep?.start ?? null,
            arrivedAt: sleep?.arrivedAt ?? null,
          };
        }
        // The checks as the watch saw them, answered ones too: the context here has none.
        if (facts.automatic?.kind === "anki") facts.automatic = { ...facts.automatic, checks };
        if (facts.automatic?.kind === "anki" && facts.automatic.finishedAt !== null) {
          // The check that found the deck finished was recorded when it was answered.
          const finishedAt = facts.automatic.finishedAt.getTime();
          const answered = checks.find((check) => check.startedAt.getTime() === finishedAt)?.finishedAt;
          facts.automatic = { ...facts.automatic, recordedAt: answered ?? facts.automatic.finishedAt };
        }
        const verdict = verdictOf(facts, now);
        const agreement = agrees(stored, verdict, facts, tickedThrough, now);
        if (agreement === "waits-for-tick") waitsForTick();
        if (agreement === false) found.push({ pactId: pact.id, date, stored, verdict, facts });
      }
    }
    return found;
  }

  close(): void {
    this.#db?.close();
    this.#db = null;
  }

  /**
   * Notes the accounts' timezones for the ticks and uploads since the last
   * check, which runs after each, and when each pact was first seen.
   */
  #noteJudgings(ctx: CoreContext): void {
    this.#watch.noteTimezones(
      () =>
        new Map(
          ctx
            .all<{ id: AccountId; timezone: string | null }>(`SELECT id, timezone FROM account`)
            .map((row) => [row.id, row.timezone]),
        ),
    );
    for (const { id } of ctx.all<{ id: string }>(`SELECT id FROM pact`)) {
      if (!this.#pactSeenAfter.has(id)) this.#pactSeenAfter.set(id, this.#watch.judgingCount());
    }
  }

  #context(): CoreContext {
    this.#db ??= openWithPragmas(this.#dbPath);
    const unused = () => {
      throw new Error("the verdict check only reads");
    };
    return createContext({
      db: this.#db,
      clock: this.#clock,
      newId: unused,
      log: unused,
      enqueue: unused,
      // The check reads the checks of AnkiWeb from its own watch, not the core's memory.
      ankiChecksRunning: new Map(),
    });
  }
}

function storedOf(ctx: CoreContext, pactId: string, date: LocalDate): Stored {
  const row = ctx.one<{ outcome: Stored["outcome"]; judged_at: string | null }>(
    `SELECT outcome, judged_at FROM occurrence WHERE pact_id = ? AND date = ?`,
    pactId,
    date,
  );
  const penalties = ctx
    .all<{ amount_cents: number; recipient_id: string }>(
      `SELECT amount_cents, recipient_id FROM penalty WHERE pact_id = ? AND occurrence_date = ? ORDER BY id`,
      pactId,
      date,
    )
    .map((p) => ({ amountCents: p.amount_cents, recipientId: p.recipient_id }));
  return {
    outcome: row?.outcome ?? null,
    judgedAt: row?.judged_at ? new Date(row.judged_at) : null,
    penalties,
  };
}

/**
 * Whether what's stored is the verdict. An occurrence the scheduler judges
 * at its due time (or a bedtime night at its close) isn't judged until a
 * tick reaches that time, so until then nothing stored agrees too.
 */
function agrees(
  stored: Stored,
  verdict: Verdict,
  facts: OccurrenceFacts,
  tickedThrough: Date | null,
  now: Date,
): boolean | "waits-for-tick" {
  if (!("at" in verdict)) return stored.outcome === null && stored.penalties.length === 0;
  if (stored.outcome === null && stored.penalties.length === 0) {
    const { dueAt, closesAt } = facts.occurrence;
    const at = verdict.at.getTime();
    // An Anki day a running check held is judged on the first tick after it's answered.
    const tickJudgesFrom =
      at === dueAt.getTime() ? (dueJudgedFrom(facts, now) ?? dueAt) : at === closesAt.getTime() ? closesAt : null;
    if (tickJudgesFrom === null) return false;
    if (tickedThrough === null || tickedThrough.getTime() < tickJudgesFrom.getTime()) return "waits-for-tick";
    // A tick at the very instant a check was answered may have run while it still held the day.
    const held =
      tickedThrough.getTime() === tickJudgesFrom.getTime() &&
      facts.automatic?.kind === "anki" &&
      facts.automatic.checks.some(
        (check) => check.startedAt < dueAt && check.finishedAt?.getTime() === tickJudgesFrom.getTime(),
      );
    return held ? "waits-for-tick" : false;
  }
  if (stored.outcome !== verdict.kind) return false;
  if (stored.judgedAt?.getTime() !== verdict.at.getTime()) return false;
  if (verdict.kind !== "missed") return stored.penalties.length === 0;
  return (
    stored.penalties.length === 1 &&
    stored.penalties[0]!.amountCents === verdict.penaltyCents &&
    stored.penalties[0]!.recipientId === verdict.recipientId
  );
}

/** When the scheduler last ticked, as stored; null before its first tick. */
function lastTickOf(ctx: CoreContext): string | null {
  return (
    ctx.one<{ last_tick_at: string }>(`SELECT last_tick_at FROM scheduler_state WHERE id = 1`)?.last_tick_at ?? null
  );
}

/** Everything stored that judging reads or writes, as one string: equal strings, equal facts. */
function factsFingerprint(ctx: CoreContext): string {
  const reads = [
    `SELECT id, timezone FROM account`,
    `SELECT id, stage, ended_at, schedule, first_occurrence, in_bed_by, due_by, end_date, penalty_cents, recipient_id,
            evidence_kind, anki_deck_id, anki_rollover_hour, created_at FROM pact`,
    `SELECT * FROM pact_earlier_terms`,
    `SELECT * FROM occurrence`,
    `SELECT * FROM evidence`,
    `SELECT * FROM cover_day_v ORDER BY kind, id, pact_id, date`,
    `SELECT * FROM anki_check`,
    `SELECT pact_id, occurrence_date, amount_cents, recipient_id FROM penalty`,
  ];
  return JSON.stringify(reads.map((sql) => ctx.all(sql.includes("ORDER BY") ? sql : `${sql} ORDER BY rowid`)));
}
