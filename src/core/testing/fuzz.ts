// The randomised test of the core: what a run is, and how it's made smaller.
//
// A run is a list of actions made from a seed, applied to one scenario
// (scenario.ts). An action is plain data: what to do, who does it, and four
// raw numbers. It names no id. When it's applied it picks its target from
// what the queries show then ("the n-th item in this reviewer's queue"), so a
// run with some actions taken out is still a run that means something. That
// is what lets `shrink` cut a failing run down to the few actions that matter.
//
// After every action that did something the invariants are checked
// (fuzz-invariants.ts), on top of the scenario's own check that stored
// outcomes match `verdictOf`. The first one broken ends the run as a
// `Violation`, which names the invariant.
//
// fuzz.test.ts runs fixed seeds in `npm test`, and any range of seeds when
// asked (see the top of that file).

import { addDays } from "../../shared/calendar.ts";
import { termsOf } from "../../shared/terms.ts";
import {
  MAX_TEXT_CHARS,
  WEEKDAYS,
  type NewPact,
  type PactChange,
  type PactTerms,
  type ReviewItem,
  type Schedule,
  type TodayWaitingItem,
} from "../../shared/types.ts";
import { localDateOf, zoneOffsetAt } from "../calendar.ts";
import type { OuraSleepPeriod, Photo } from "../ports.ts";
import { Checks, Violation } from "./fuzz-invariants.ts";
import { scenario, type AccountHandle, type Scenario } from "./scenario.ts";

/** A deterministic source of whole numbers from 0 to 2^32 - 1 (mulberry32). */
function numbersFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** What an action does, and how often the generator picks it (its weight). */
const WEIGHTS = {
  // Time.
  advance: 14,
  "advance-to-edge": 10,
  drift: 4,
  "cross-edge": 6,
  "tick-again": 1,
  restart: 1,
  // Pacts.
  "create-pact": 7,
  "edit-pact": 3,
  "delete-pact": 1,
  "change-pact": 6,
  rename: 1,
  "add-reviewers": 1,
  "set-reminders": 2,
  "request-end": 2,
  "withdraw-change-request": 1,
  // Evidence and its review.
  submit: 10,
  decide: 12,
  "decide-again": 1,
  ask: 3,
  reply: 5,
  "accept-miss": 2,
  // Excuses and vacations.
  "file-excuse": 6,
  "accept-excuse-rejection": 1,
  "file-vacation": 5,
  "withdraw-vacation": 2,
  "accept-vacation-rejection": 1,
  // Money.
  "record-payment": 4,
  // Oura and AnkiWeb.
  sleep: 3,
  "anki-counts": 3,
  "check-source": 2,
  "connect-or-disconnect": 1,
  // The account.
  "set-timezone": 1,
  "notification-setting": 1,
} as const;

type ActionKind = keyof typeof WEIGHTS;

/** One step of a run. `by` and `n` are raw numbers, read against the state when the action is applied. */
export interface Action {
  do: ActionKind;
  by: number;
  n: [number, number, number, number];
}

/** What a seed fixes besides its actions. */
export interface Setup {
  /** When the run starts: some start a few days before the clocks change somewhere. */
  start: string;
  /** Each of the three people's timezone. */
  timezones: [string, string, string];
  /** Whether the clock may run hours ahead of the last tick, as after an outage. */
  outages: boolean;
  /** Whether people change their timezone during the run. */
  timezoneChanges: boolean;
  /** Whether Oura Ring and Anki pacts are made. Off, the run is Camera only. */
  automatic: boolean;
}

const STARTS = [
  "2026-01-05T14:00:00Z", // the scenarios' reference week
  "2026-03-05T14:00:00Z", // clocks go forward in New York on 8 March
  "2026-03-26T09:00:00Z", // and in London on 29 March
  "2026-04-02T00:00:00Z", // clocks go back in Auckland on 5 April
  "2026-09-24T00:00:00Z", // and forward there on 27 September
  "2026-10-29T14:00:00Z", // clocks go back in New York on 1 November
  "2026-12-28T14:00:00Z", // the year ends
];

const TIMEZONES = [
  "America/New_York",
  "America/New_York",
  "Europe/London",
  "Pacific/Auckland",
  "Asia/Kolkata",
  "Pacific/Honolulu",
  "UTC",
];

/** The fixed parts of the run a seed makes. */
export function setupOf(seed: number): Setup {
  const next = numbersFrom(seed ^ 0x5eed);
  const zone = () => TIMEZONES[next() % TIMEZONES.length]!;
  return {
    start: STARTS[next() % STARTS.length]!,
    timezones: [zone(), zone(), zone()],
    outages: next() % 4 === 0,
    timezoneChanges: next() % 4 === 0,
    automatic: next() % 3 !== 0,
  };
}

/** The first `count` actions of the run a seed makes. */
export function actionsOf(seed: number, count: number): Action[] {
  const next = numbersFrom(seed);
  const kinds = Object.entries(WEIGHTS) as [ActionKind, number][];
  const total = kinds.reduce((sum, [, weight]) => sum + weight, 0);
  const actions: Action[] = [];
  for (let i = 0; i < count; i++) {
    let at = next() % total;
    const kind = kinds.find(([, weight]) => (at -= weight) < 0)![0];
    actions.push({ do: kind, by: next(), n: [next(), next(), next(), next()] });
  }
  return actions;
}

/** How often each command was accepted and refused, over every run in this process. */
export const STATS = new Map<string, number>();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PENALTIES = [100, 250, 500, 1000, 2500];
const CLOCK_TIMES = ["06:30", "09:00", "12:00", "17:45", "20:00", "21:30", "23:00", "23:59", "00:30", "02:00"];
const DECKS = ["1700000000001", "1700000000002"];

function pick<T>(list: readonly T[], n: number): T | undefined {
  return list.length === 0 ? undefined : list[n % list.length];
}

function photo(n: number): Photo {
  return { bytes: new Uint8Array([0xff, 0xd8, n % 251]), contentType: "image/jpeg" };
}

/** A run in progress: the scenario, its people, and what the run has said so far. */
export class World {
  readonly s: Scenario;
  readonly setup: Setup;
  /** The three people who own and review pacts, each a friend of the other two. */
  readonly people: AccountHandle[] = [];
  /** A friend of the first person who reviews nothing: nothing of anyone's should reach them. */
  outsider!: AccountHandle;
  /** What each action did, for the report of a failure. */
  readonly log: string[] = [];
  readonly checks: Checks;
  /** The last few items decided, with who decided them, for deciding one again. */
  readonly decided: { reviewer: AccountHandle; id: string; what: string }[] = [];
  /** Whether each tick is made as many: one a minute for half an hour, or thirty evenly spaced. */
  readonly #manyTicks: boolean;
  #names = 0;

  constructor(setup: Setup, { manyTicks = false } = {}) {
    this.s = scenario();
    this.setup = setup;
    this.#manyTicks = manyTicks;
    this.checks = new Checks(this);
  }

  now(): Date {
    return this.s.clock.now();
  }

  /** The person an action is by. */
  person(by: number): AccountHandle {
    return this.people[by % this.people.length]!;
  }

  /** The other two people: who `person` can pick as reviewers. */
  friendsOf(person: AccountHandle): AccountHandle[] {
    return this.people.filter((other) => other.id !== person.id);
  }

  timezoneOf(person: AccountHandle): string {
    return person.profile().timezone;
  }

  today(person: AccountHandle): string {
    return localDateOf(this.now(), this.timezoneOf(person));
  }

  /** Adds `line` to the log. `run` skips the checks after an action that neither notes nor moves the clock. */
  note(line: string): void {
    this.log.push(`${this.now().toISOString().slice(0, 16)}Z  ${line}`);
  }

  async start(): Promise<void> {
    const { s, setup } = this;
    s.setClockTo(setup.start);
    const first = await s.signIn("owner", { timezone: setup.timezones[0] });
    const second = await s.befriend(first, "bea");
    const third = await s.befriend(first, "cal");
    await s.befriend(second, "cal");
    await second.setTimezone(setup.timezones[1]);
    await third.setTimezone(setup.timezones[2]);
    this.people.push(first, second, third);
    this.outsider = await s.befriend(first, "dan");
    for (const person of this.people) {
      await person.addRecipient({ name: "Sam" });
      await person.addRecipient({ name: "Oxfam" });
      await person.savePushSubscription({
        endpoint: `https://fcm.googleapis.com/fcm/send/${person.name}`,
        p256dh: "p256dh",
        auth: "auth",
      });
      if (!setup.automatic) continue;
      await person.connectOura();
      await person.connectAnki();
      DECKS.forEach((id, i) => s.ankiSource.setDeck(person.id, { id, name: `Deck ${i + 1}`, review: 20 }));
      this.setAnkiDay(person);
      await person.ankiDecks();
    }
    await s.advanceTo(this.now().toISOString());
    this.note(
      `start: owner in ${setup.timezones[0]}, bea in ${setup.timezones[1]}, cal in ${setup.timezones[2]}` +
        (setup.automatic ? ", Oura and AnkiWeb connected" : ""),
    );
  }

  /** What AnkiWeb answers from now on: counts as of now, for the Anki day that has opened (rollover 4am). */
  setAnkiDay(person: AccountHandle, daysOff = 0): void {
    const ankiDate = addDays(localDateOf(new Date(this.now().getTime() - 4 * HOUR), this.timezoneOf(person)), daysOff);
    this.s.ankiSource.setAnkiDay(person.id, ankiDate, this.now());
  }

  /** When the last tick ran, or null before the first. */
  tickedAt: number | null = null;

  /** A scheduler tick at `to`, then every check. */
  async tick(to: Date): Promise<void> {
    const from = this.now().getTime();
    const span = to.getTime() - from;
    if (this.#manyTicks && span > MINUTE) {
      const pieces = Math.min(30, Math.floor(span / MINUTE));
      for (let i = 1; i < pieces; i++) {
        // On the minute, as the scheduler ticks.
        const at = Math.floor((from + (span * i) / pieces) / MINUTE) * MINUTE;
        if (at <= this.now().getTime()) continue;
        await this.checks.guard("tick", () => this.s.advanceTo(new Date(at).toISOString()));
        this.checks.messagesFollowSettings();
      }
    }
    await this.checks.guard("tick", () => this.s.advanceTo(to.toISOString()));
    this.tickedAt = to.getTime();
    this.checks.nothingMootWaits();
    // Now, while the clock still says when they were sent.
    this.checks.messagesFollowSettings();
  }

  /**
   * Runs a command as the checks want it run: an exception is a violation,
   * and so is a refusal that changed anything. Returns the command's answer.
   */
  async command<T>(who: AccountHandle, call: string, run: () => Promise<T>): Promise<T> {
    const result = await this.checks.command(`${who.name}.${call}`, run);
    this.note(`${who.name}.${call} -> ${brief(result)}`);
    const name = call.split("(")[0]!;
    const how =
      typeof result === "object" && result !== null && "ok" in result && result.ok === false
        ? `refused:${(result as { reason?: string }).reason}`
        : "ok";
    STATS.set(`${name} ${how}`, (STATS.get(`${name} ${how}`) ?? 0) + 1);
    return result;
  }

  nextName(): string {
    return `P${++this.#names}`;
  }

  /**
   * Does `action`. A branch that changes anything (runs a command, ticks,
   * changes a fake source, restarts) must `note` it or move the clock: `run`
   * takes an action that does neither as one that did nothing, and skips the
   * checks after it.
   */
  async apply(action: Action): Promise<void> {
    const [a, b, c, d] = action.n;
    const who = this.person(action.by);
    const s = this.s;
    switch (action.do) {
      case "advance": {
        const size = a % 100;
        const minutes =
          size < 40
            ? 1 + (b % 5)
            : size < 70
              ? 5 + (b % 85)
              : size < 90
                ? 90 + (b % 630)
                : size < 98
                  ? 720 + (b % 3600)
                  : 4320 + (b % 20000);
        const to = new Date(this.now().getTime() + minutes * MINUTE);
        await this.tick(to);
        this.note(`tick after ${minutes} min`);
        return;
      }
      case "advance-to-edge": {
        const edge = pick(this.checks.edgesAhead(), a);
        if (!edge) return;
        const offset = [-MINUTE, -1000, 0, 0, 1000, MINUTE][b % 6]!;
        const to = new Date(Math.max(edge.at.getTime() + offset, this.now().getTime() + 1000));
        await this.tick(to);
        this.note(`tick at ${edge.what} ${offset >= 0 ? "+" : ""}${offset / 1000} s`);
        return;
      }
      case "cross-edge": {
        // The clock passes an edge with no tick yet, as in the minute between two ticks: what comes next arrives in that gap.
        const edge = pick(this.checks.edgesAhead().slice(0, 4), a);
        if (!edge) return;
        const before = edge.at.getTime() - [1000, 20_000, 59_000][b % 3]!;
        if (before > this.now().getTime()) await this.tick(new Date(before));
        const to = Math.max(edge.at.getTime() + [0, 1000, 30_000][c % 3]!, this.now().getTime() + 1000);
        s.setClockTo(new Date(to).toISOString());
        this.note(`clock passes ${edge.what} with no tick yet`);
        return;
      }
      case "drift": {
        const ms = this.setup.outages && a % 5 === 0 ? (1 + (b % 360)) * MINUTE : (1 + (b % 90)) * 1000;
        s.setClockTo(new Date(this.now().getTime() + ms).toISOString());
        this.note(`clock moves ${Math.round(ms / 1000)} s with no tick`);
        return;
      }
      case "tick-again":
        await this.checks.tickTwice();
        this.note("tick twice at the same time");
        return;
      case "restart":
        await this.checks.restart();
        this.note("restart");
        return;
      case "create-pact": {
        const pact = this.newPact(who, a, b, c, d);
        if (!pact) return;
        const preview = this.checks.firstOccurrenceOf(who, pact);
        const result = await this.command(who, `createPact(${describe(pact)})`, () => who.createPact(pact));
        this.checks.createdAsPreviewed(who, pact, preview, result);
        if (!result.ok) return;
        // Sometimes straight on, in its edit window: evidence, then an edit or a delete.
        const then = (a >>> 12) % 10;
        if (then < 3 && pact.evidenceKind === "camera") {
          await this.command(who, `submitEvidence(${pact.name})`, () => who.submitEvidence(result.pactId, [photo(b)]));
        }
        if (then === 1 || then === 4 || then === 5) {
          const edited = this.newPact(who, b >>> 3, c >>> 3, d >>> 3, a >>> 3, pact.evidenceKind);
          if (edited) {
            await this.command(who, `editPact(${pact.name}, ${describe(edited)})`, () =>
              who.editPact(result.pactId, edited),
            );
          }
        }
        if (then === 2 || then === 6) {
          await this.command(who, `deletePact(${pact.name})`, () => who.deletePact(result.pactId));
        }
        return;
      }
      case "edit-pact": {
        // Mostly a pact in its edit window; sometimes any, which is refused once the window has closed.
        const pacts = who.pacts();
        const summary = pick((b >>> 24) % 4 === 0 ? pacts : pacts.filter((p) => p.editWindowClosesAt !== null), a);
        if (!summary) return;
        const pact = this.checks.pactOf(who, summary.id);
        const edited = this.newPact(who, b, c, d, a >>> 8, pact.evidenceKind);
        if (!edited) return;
        const result = await this.command(who, `editPact(${pact.name}, ${describe(edited)})`, () =>
          who.editPact(pact.id, edited),
        );
        this.checks.editedInWindow(pact, result);
        return;
      }
      case "delete-pact": {
        const summary = pick(
          who.pacts().filter((p) => p.editWindowClosesAt !== null),
          a,
        );
        if (!summary || b % 3 !== 0) return;
        await this.command(who, `deletePact(${summary.name})`, () => who.deletePact(summary.id));
        return;
      }
      case "change-pact": {
        const pact = this.activePact(who, a);
        if (!pact) return;
        const change = this.changeTo(who, pact, b, c, d);
        const preview = this.checks.changePreviewOf(who, pact.id, change);
        const result = await this.command(who, `changePact(${pact.name}, ${describeChange(pact, change)})`, () =>
          who.changePact(pact.id, change),
        );
        this.checks.changedAsPreviewed(preview, result);
        this.checks.easierNeedsApproval(pact, change, result);
        return;
      }
      case "rename": {
        const pact = this.activePact(who, a);
        if (!pact) return;
        const name = b % 9 === 0 ? "  " : `${pact.name}'`;
        await this.command(who, `renamePact(${pact.name}, "${name}")`, () => who.renamePact(pact.id, name));
        return;
      }
      case "add-reviewers": {
        const pact = this.activePact(who, a);
        if (!pact) return;
        const reviewers = this.friendsOf(who).filter((_, i) => (b >> i) & 1);
        await this.command(who, `addReviewers(${pact.name}, ${names(reviewers)})`, () =>
          who.addReviewers(
            pact.id,
            reviewers.map((r) => r.id),
          ),
        );
        return;
      }
      case "set-reminders": {
        const pact = this.activePact(who, a);
        if (!pact) return;
        const reminders = this.reminders(who, pact.schedule, b, c);
        await this.command(who, `setReminders(${pact.name}, [${reminders.join(", ")}])`, () =>
          who.setReminders(pact.id, reminders),
        );
        return;
      }
      case "request-end": {
        const pact = this.activePact(who, a);
        if (!pact) return;
        await this.command(who, `requestEnd(${pact.name})`, () =>
          who.requestEnd(pact.id, b % 2 === 0 ? "moving away" : undefined),
        );
        return;
      }
      case "withdraw-change-request": {
        const item = pick(
          who.today().waiting.filter((w) => w.kind === "change-request"),
          a,
        );
        if (!item) return;
        await this.command(who, `withdrawChangeRequest(${item.name})`, () => who.withdrawChangeRequest(item.id));
        return;
      }
      case "submit": {
        const toDo = who
          .today()
          .sections.flatMap((section) => (section.kind === "to-do" ? section.cards : []))
          .flatMap((card) => ("pactId" in card ? [card.pactId] : []));
        // Mostly a pact Today says to do; sometimes any pact, or an Ended recurring one, which are mostly refused.
        const all = who.pacts().map((p) => p.id);
        const ended = who
          .pacts()
          .filter((p) => p.stage === "ended" && p.schedule.kind !== "one-time")
          .map((p) => p.id);
        const pactId = pick(
          (c >>> 8) % 3 === 0 && ended.length > 0 ? ended : b % 5 === 0 || toDo.length === 0 ? all : toDo,
          a,
        );
        if (pactId === undefined) return;
        const pact = this.checks.pactOf(who, pactId);
        const photos = Array.from({ length: 1 + (c % 2) }, (_, i) => photo(d + i));
        const result = await this.command(who, `submitEvidence(${pact.name})`, () =>
          who.submitEvidence(pactId, photos),
        );
        this.checks.submittedWhileActive(pact, result);
        return;
      }
      case "decide": {
        const queue = who.reviewQueue();
        const waitingOnReply = who.waitingOnReply();
        const item = pick(b % 4 === 0 && waitingOnReply.length > 0 ? waitingOnReply : queue, a);
        if (!item) return;
        const decision = c % 5 < 3 ? ({ kind: "approve" } as const) : ({ kind: "reject", reason: "no" } as const);
        const result = await this.command(who, `decide(${describeItem(item)}, ${decision.kind})`, () =>
          who.decide(item.id, decision),
        );
        this.checks.decidedFromQueue(who, item, decision.kind, result);
        if (result.ok) this.decided.push({ reviewer: who, id: item.id, what: describeItem(item) });
        if (this.decided.length > 5) this.decided.shift();
        return;
      }
      case "decide-again": {
        const done = pick(this.decided, a);
        if (!done) return;
        const decision = c % 2 === 0 ? ({ kind: "approve" } as const) : ({ kind: "reject", reason: "no" } as const);
        const result = await this.command(done.reviewer, `decide(${done.what}, ${decision.kind}) again`, () =>
          done.reviewer.decide(done.id, decision),
        );
        this.checks.decidedOnce(done.reviewer, done.what, result);
        return;
      }
      case "ask": {
        const item = pick(who.reviewQueue(), a);
        if (!item) return;
        // Sometimes blank or too long, which is refused.
        const question = b % 5 !== 0 ? "why?" : c % 2 === 0 ? "  " : "?".repeat(MAX_TEXT_CHARS + 1);
        const result = await this.command(who, `askOwner(${describeItem(item)}, ${question.length} chars)`, () =>
          who.askOwner(item.id, question),
        );
        this.checks.askedFromQueue(who, item, b % 5 !== 0, result);
        return;
      }
      case "reply": {
        const asked = who.today().alerts.flatMap((alert) => (alert.kind === "reviewer-question" ? [alert.item] : []));
        const item = pick(b % 6 === 0 ? who.today().waiting : asked, a);
        if (!item) return;
        const result = await this.command(who, `reply(${item.kind} ${item.id.slice(-4)})`, () =>
          who.reply(item.id, "because"),
        );
        if (asked.some((other) => other.id === item.id)) this.checks.repliedToQuestion(who, item, result);
        return;
      }
      case "accept-miss": {
        const today = who.today();
        const misses = [
          ...today.sections.flatMap((section) => (section.kind === "missed" ? section.cards : [])),
          ...today.alerts.flatMap((alert) => (alert.kind === "evidence-rejected" ? [alert] : [])),
        ];
        const miss = pick(misses, a);
        if (!miss) return;
        await this.command(who, `acceptMiss(${miss.name}, ${miss.occurrenceDate})`, () =>
          who.acceptMiss(miss.pactId, miss.occurrenceDate),
        );
        return;
      }
      case "file-excuse": {
        const summary = pick(who.pacts(), a);
        if (!summary) return;
        // Sometimes around a day that was Satisfied, which can't be excused.
        const satisfied = this.checks.satisfiedDates(this.checks.pactOf(who, summary.id));
        const around = (c >>> 8) % 4 === 0 ? pick(satisfied, d >>> 8) : undefined;
        const from = around ?? addDays(this.today(who), (b % 12) - 4);
        const to = addDays(from, c % 8 === 7 ? 70 : c % 5);
        const excuse = { from, to, reason: d % 11 === 0 ? " " : "ill" };
        const preview = this.checks.excusePreviewOf(who, summary.id, excuse);
        const before = this.checks.pactOf(who, summary.id);
        const photos = d % 3 === 0 ? [photo(d)] : [];
        const result = await this.command(who, `fileExcuse(${summary.name}, ${from}..${to})`, () =>
          who.fileExcuse(summary.id, excuse, photos),
        );
        this.checks.excusedAsPreviewed(who, excuse, preview, result);
        this.checks.excusedNoSatisfiedDay(who, before, result);
        return;
      }
      case "accept-excuse-rejection": {
        const alert = pick(
          who.today().alerts.flatMap((alert) => (alert.kind === "excuse-rejected" ? [alert] : [])),
          a,
        );
        if (!alert) return;
        await this.command(who, `acceptExcuseRejection(${alert.name})`, () =>
          who.acceptExcuseRejection(alert.excuseId),
        );
        return;
      }
      case "file-vacation": {
        const options = who.vacationOptions();
        const offered = [...options.recurring, ...options.oneTime];
        const some = offered.filter((_, i) => (a >> i) & 1 || a % 3 === 0);
        // Mostly at least one pact; sometimes none, which is refused.
        const ticked = some.length > 0 || a % 11 === 0 || offered.length === 0 ? some : [offered[a % offered.length]!];
        // Often from tomorrow, when a Weekly count week may already be open.
        const from = addDays(options.today, b % 9 === 8 ? 0 : (b >>> 8) % 3 === 0 ? 1 : 1 + (b % 8));
        const to = addDays(from, c % 12);
        // Mostly from the ticked pacts' reviewers; sometimes any friend, who may review none of them.
        const friends = this.friendsOf(who);
        const offeredReviewers = friends.filter((f) => ticked.some((p) => p.reviewers.some((r) => r.id === f.id)));
        const reviewers = ((d >>> 8) % 4 === 0 ? friends : offeredReviewers).filter(
          (_, i) => (d >> i) & 1 || d % 3 === 0,
        );
        const request = { from, to, pactIds: ticked.map((p) => p.id) };
        const vacation = { ...request, reviewerIds: reviewers.map((r) => r.id), ...(d % 2 === 0 && { note: "away" }) };
        const preview = this.checks.vacationPreviewOf(who, request);
        const before = ticked.map((p) => this.checks.pactOf(who, p.id));
        const result = await this.command(
          who,
          `fileVacation(${from}..${to}, [${ticked.map((p) => p.name).join(", ")}], to ${names(reviewers)})`,
          () => who.fileVacation(vacation),
        );
        this.checks.vacationAsPreviewed(who, vacation, preview, result);
        this.checks.vacationCoversNothingOpen(who, before, result);
        return;
      }
      case "withdraw-vacation": {
        const item = pick(
          who.today().waiting.filter((w) => w.kind === "vacation"),
          a,
        );
        if (!item) return;
        await this.command(who, `withdrawVacation(${item.firstDate}..${item.lastDate})`, () =>
          who.withdrawVacation(item.id),
        );
        return;
      }
      case "accept-vacation-rejection": {
        const alert = pick(
          who.today().alerts.flatMap((alert) => (alert.kind === "vacation-rejected" ? [alert] : [])),
          a,
        );
        if (!alert) return;
        await this.command(who, `acceptVacationRejection(${alert.firstDate}..${alert.lastDate})`, () =>
          who.acceptVacationRejection(alert.vacationId),
        );
        return;
      }
      case "record-payment": {
        const ledger = pick(who.ledgers(), a);
        if (!ledger) return;
        // Sometimes more than payable: up to what payments awaiting approval leave owed, or beyond.
        const sized = b % 10;
        const amountCents =
          sized < 3
            ? ledger.payableCents
            : sized < 5
              ? ledger.suggestedPaymentCents
              : sized < 7
                ? 1 + (c % Math.max(1, ledger.payableCents))
                : sized < 9
                  ? ledger.payableCents + 1 + (c % Math.max(1, ledger.awaitingCents))
                  : ledger.payableCents + 1 + (c % 500);
        const screenshot = d % 13 === 0 ? null : photo(d);
        const result = await this.command(
          who,
          `recordPayment(${ledger.name}, ${amountCents}c of ${ledger.payableCents}c payable)`,
          () => who.recordPayment({ recipientId: ledger.recipientId, amountCents }, screenshot),
        );
        this.checks.paidWhatIsPayable(ledger, amountCents, result);
        return;
      }
      case "sleep": {
        if (!this.setup.automatic) return;
        // A night's sleep starting some time in the 18 hours before now, as Oura reports it in the owner's zone.
        const start = new Date(this.now().getTime() - (a % (18 * 60)) * MINUTE);
        const period = sleepPeriod(start, this.timezoneOf(who), b % 7 === 0 ? "late_nap" : "long_sleep");
        s.ouraSource.addSleep(who.id, period);
        this.note(`Oura has ${who.name} in bed at ${period.bedtime_start} (${period.type})`);
        return;
      }
      case "anki-counts": {
        if (!this.setup.automatic) return;
        const left = a % 3 === 0 ? 0 : a % 40;
        const deck = DECKS[b % DECKS.length]!;
        s.ankiSource.setDeck(who.id, { id: deck, name: `Deck ${DECKS.indexOf(deck) + 1}`, review: left });
        this.setAnkiDay(who, c % 9 === 0 ? -1 : 0);
        this.note(`AnkiWeb has ${left} cards left in ${who.name}'s deck ${DECKS.indexOf(deck) + 1}`);
        return;
      }
      case "check-source": {
        if (!this.setup.automatic) return;
        this.setAnkiDay(who);
        if (a % 2 === 0) await this.command(who, "checkOura()", () => who.checkOura());
        else await this.command(who, "checkAnki()", () => who.checkAnki());
        return;
      }
      case "connect-or-disconnect": {
        if (!this.setup.automatic || a % 2 === 0) return;
        const oura = b % 2 === 0;
        const source = oura ? s.ouraSource : s.ankiSource;
        switch (c % 4) {
          case 0:
            source.disconnect(who.id);
            this.note(`${oura ? "Oura" : "AnkiWeb"} refuses ${who.name}'s login`);
            return;
          case 1:
            await this.command(who, oura ? "disconnectOura()" : "disconnectAnki()", () =>
              oura ? who.disconnectOura() : who.disconnectAnki(),
            );
            return;
          default:
            source.reconnect(who.id);
            await this.command(who, oura ? "connectOura()" : "connectAnki()", () =>
              oura ? who.connectOura() : who.connectAnki(),
            );
            return;
        }
      }
      case "set-timezone": {
        if (!this.setup.timezoneChanges || a % 2 === 0) return;
        const timezone = TIMEZONES[b % TIMEZONES.length]!;
        await this.command(who, `setTimezone(${timezone})`, () => who.setTimezone(timezone));
        return;
      }
      case "notification-setting": {
        const settings = who.notificationSettings();
        const setting = pick(settings, a);
        if (!setting) return;
        if (b % 4 === 0) {
          await this.command(who, `setDailySummary(${c % 2 === 0})`, () => who.setDailySummary(c % 2 === 0));
          return;
        }
        await this.command(who, `setNotificationSetting(${setting.setting}, ${!setting.enabled})`, () =>
          who.setNotificationSetting(setting.setting, !setting.enabled),
        );
        return;
      }
    }
  }

  /** One of `who`'s Active pacts past its edit window; sometimes any pact, to draw a refusal. */
  activePact(who: AccountHandle, n: number): PactTerms | undefined {
    const pacts = who.pacts();
    const changeable = pacts.filter((p) => p.stage === "active" && p.editWindowClosesAt === null);
    const summary = pick((n >>> 16) % 12 === 0 || changeable.length === 0 ? pacts : changeable, n);
    return summary && this.checks.pactOf(who, summary.id);
  }

  /** A new pact's terms. `kind` fixes the evidence kind, as an edit must. */
  newPact(
    who: AccountHandle,
    a: number,
    b: number,
    c: number,
    d: number,
    kind?: NewPact["evidenceKind"],
  ): NewPact | undefined {
    const roll = a % 10;
    const evidenceKind = kind ?? (!this.setup.automatic || roll < 8 ? "camera" : roll === 8 ? "oura" : "anki");
    const today = this.today(who);
    const recipient = pick(who.recipients(), b);
    if (!recipient) return undefined;
    const friends = this.friendsOf(who);
    const reviewers = friends.filter((_, i) => (c >> i) & 1);
    const days = WEEKDAYS.filter((_, i) => ((b >>> 4) >> i) & 1);
    const fixedDays: Schedule = { kind: "fixed-days", days: days.length > 0 || d % 17 === 0 ? days : ["mon", "thu"] };
    const shape = (a >>> 4) % 10;
    const schedule: Schedule =
      evidenceKind !== "camera" || shape < 4
        ? fixedDays
        : shape < 6
          ? { kind: "weekly-count", target: 1 + ((b >>> 12) % 4) }
          : shape === 6
            ? { kind: "every-2-weeks" }
            : shape === 7
              ? { kind: "once-a-month" }
              : { kind: "one-time", deadline: addDays(today, (b >>> 12) % 9), submitAnytime: (b >>> 16) % 2 === 0 };
    const recurring = schedule.kind !== "one-time";
    const startDate = recurring && (c >>> 4) % 4 === 0 ? addDays(today, (c >>> 6) % 10) : undefined;
    const endDate = recurring && (c >>> 10) % 4 === 0 ? addDays(startDate ?? today, ((c >>> 12) % 25) - 1) : undefined;
    const dueBy = (d >>> 4) % 3 === 0 ? CLOCK_TIMES[(d >>> 6) % CLOCK_TIMES.length]! : undefined;
    return {
      evidenceKind,
      name: this.nextName(),
      description: evidenceKind === "camera" ? "a photo" : "",
      schedule,
      penaltyCents: d % 23 === 0 ? 0 : PENALTIES[d % PENALTIES.length]!,
      recipientId: recipient.id,
      reviewerIds: (reviewers.length > 0 || d % 19 === 0 ? reviewers : [friends[c % friends.length]!]).map((r) => r.id),
      ...(evidenceKind === "oura" && { inBedBy: ["22:30", "23:00", "00:00", "01:00"][(d >>> 8) % 4]! }),
      ...(evidenceKind === "anki" && { ankiDeckId: DECKS[(d >>> 8) % DECKS.length]! }),
      ...(evidenceKind !== "oura" && dueBy !== undefined && { dueBy }),
      ...(startDate !== undefined && { startDate }),
      ...(endDate !== undefined && { endDate }),
      ...((d >>> 12) % 3 === 0 && { reminders: this.reminders(who, schedule, d >>> 14, c >>> 16) }),
    };
  }

  reminders(who: AccountHandle, schedule: Schedule, a: number, b: number): string[] {
    const times = [CLOCK_TIMES[a % CLOCK_TIMES.length]!, CLOCK_TIMES[b % CLOCK_TIMES.length]!].slice(0, 1 + (a % 2));
    if (schedule.kind !== "one-time") return times;
    return times.map((time, i) => `${addDays(schedule.deadline, -((b >>> 4) % 3) - i)}T${time}`);
  }

  /** The pact's terms as they stand with one or two of them changed, as the Request change form sends them. */
  changeTo(who: AccountHandle, pact: PactTerms, a: number, b: number, c: number): PactChange {
    const change: PactChange = { ...termsOf(pact) };
    const today = this.today(who);
    const one = (which: number, n: number) => {
      switch (which % 11) {
        case 0:
          change.penaltyCents = PENALTIES[n % PENALTIES.length]!;
          return;
        case 1: {
          if (change.schedule.kind === "fixed-days") {
            const day = WEEKDAYS[n % 7]!;
            const has = change.schedule.days.includes(day);
            const days = WEEKDAYS.filter((d) =>
              d === day ? !has : (change.schedule as { days: string[] }).days.includes(d),
            );
            change.schedule = { kind: "fixed-days", days };
          } else if (change.schedule.kind === "weekly-count") {
            change.schedule = { kind: "weekly-count", target: 1 + (n % 7) };
          } else if (change.schedule.kind === "one-time") {
            change.schedule = {
              kind: "one-time",
              deadline: addDays(today, n % 6),
              submitAnytime: (n >>> 4) % 2 === 0,
            };
          }
          return;
        }
        case 2:
          if (pact.evidenceKind === "oura") change.inBedBy = ["22:00", "23:00", "00:00", "01:30"][n % 4]!;
          else if (n % 4 === 0) delete change.dueBy;
          else change.dueBy = CLOCK_TIMES[n % CLOCK_TIMES.length]!;
          return;
        case 3:
          if (n % 3 === 0) delete change.endDate;
          else change.endDate = addDays(today, (n % 20) - 2);
          return;
        case 4:
          if (n % 3 === 0) delete change.startDate;
          else change.startDate = addDays(today, n % 8);
          return;
        case 5:
          change.recipientId = pick(who.recipients(), n)?.id ?? change.recipientId;
          return;
        case 6: {
          const friends = this.friendsOf(who).map((f) => f.id);
          const reviewerIds = friends.filter((_, i) => (n >> i) & 1);
          change.reviewerIds = reviewerIds.length > 0 || n % 13 === 0 ? reviewerIds : [friends[n % friends.length]!];
          return;
        }
        case 7:
          change.name = `${pact.name}*`;
          return;
        case 8:
          change.reminders = this.reminders(who, change.schedule, n, n >>> 8);
          return;
        case 9:
          if (pact.evidenceKind === "anki") change.ankiDeckId = DECKS[n % DECKS.length]!;
          else change.penaltyCents = Math.max(100, change.penaltyCents + (n % 2 === 0 ? 100 : -100));
          return;
        case 10:
          // Nothing: the terms as they stand.
          return;
      }
    };
    one(a, b);
    if (c % 3 === 0) one(c >>> 4, b >>> 8);
    if (c % 5 === 0) change.note = "please";
    return change;
  }
}

/** A sleep period as Oura reports it, 7 hours from `start`, written with `timezone`'s offset then. */
function sleepPeriod(start: Date, timezone: string, type: OuraSleepPeriod["type"]): OuraSleepPeriod {
  const offsetMs = zoneOffsetAt(start, timezone);
  const offsetMinutes = Math.round(Math.abs(offsetMs) / MINUTE);
  const offset =
    (offsetMs < 0 ? "-" : "+") +
    String(Math.floor(offsetMinutes / 60)).padStart(2, "0") +
    ":" +
    String(offsetMinutes % 60).padStart(2, "0");
  const wall = (instant: Date) => new Date(instant.getTime() + offsetMs).toISOString().slice(0, 19) + offset;
  const end = new Date(start.getTime() + 7 * HOUR);
  return {
    id: `sleep-${type}-${wall(start)}`,
    day: wall(end).slice(0, 10),
    bedtime_start: wall(start),
    bedtime_end: wall(end),
    type,
    time_in_bed: 7 * 60 * 60,
    total_sleep_duration: 6 * 60 * 60,
  };
}

function names(people: AccountHandle[]): string {
  return `[${people.map((p) => p.name).join(", ")}]`;
}

function describeSchedule(schedule: Schedule): string {
  if (schedule.kind === "fixed-days") return schedule.days.join("/") || "no days";
  if (schedule.kind === "weekly-count") return `${schedule.target} a week`;
  if (schedule.kind === "every-2-weeks") return "every 2 weeks";
  if (schedule.kind === "once-a-month") return "once a month";
  return `once by ${schedule.deadline}${schedule.submitAnytime ? " anytime" : ""}`;
}

function describe(pact: NewPact | PactChange): string {
  const parts = [
    "name" in pact ? pact.name : "",
    "evidenceKind" in pact ? pact.evidenceKind : "",
    describeSchedule(pact.schedule),
    `${pact.penaltyCents}c`,
    pact.dueBy !== undefined ? `due by ${pact.dueBy}` : "",
    pact.inBedBy !== undefined ? `in bed by ${pact.inBedBy}` : "",
    pact.startDate !== undefined ? `from ${pact.startDate}` : "",
    pact.endDate !== undefined ? `to ${pact.endDate}` : "",
    pact.reminders && pact.reminders.length > 0 ? `reminders ${pact.reminders.join(",")}` : "",
    `${pact.reviewerIds.length} reviewers`,
  ];
  return parts.filter((part) => part !== "").join(", ");
}

/** Only the terms `change` changes, old and new. */
function describeChange(pact: PactTerms, change: PactChange): string {
  const before = termsOf(pact) as unknown as Record<string, unknown>;
  const after = change as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const parts = keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => `${key}: ${JSON.stringify(before[key])} -> ${JSON.stringify(after[key])}`);
  return parts.length > 0 ? parts.join("; ") : "nothing";
}

export function describeItem(item: ReviewItem | TodayWaitingItem): string {
  const of = "ownerName" in item ? `${item.ownerName}'s ` : "";
  return `${of}${item.kind} ${item.id.slice(-4)}`;
}

function brief(result: unknown): string {
  if (result === undefined) return "done";
  const text = JSON.stringify(result) ?? "undefined";
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

/** How a run ended. */
export interface RunResult {
  /** The invariant broken, or null if the run reached its end. */
  violation: Violation | null;
  /** How many actions were applied before it ended. */
  steps: number;
  log: string[];
}

/**
 * How long `world`'s log is, and the time. An action that leaves both as they
 * were did nothing: every action that runs a command, ticks, moves the clock,
 * changes a fake source or restarts notes it.
 */
function markOf(world: World): string {
  return `${world.log.length} ${world.now().getTime()}`;
}

/**
 * Applies `actions` in order to a new scenario, checking every invariant
 * after each that did something. About a third of actions find nothing to
 * act on. Skipping the checks after one loses nothing: what the checks read
 * hasn't changed since the last check, and the invariants about what changed
 * since the last check still compare with that one.
 */
export async function run(setup: Setup, actions: readonly Action[]): Promise<RunResult> {
  const world = new World(setup);
  let steps = 0;
  try {
    await world.checks.guard("start", () => world.start());
    world.checks.all();
    for (const action of actions) {
      steps++;
      const mark = markOf(world);
      await world.checks.guard(action.do, () => world.apply(action));
      if (markOf(world) !== mark) world.checks.all();
    }
    return { violation: null, steps, log: world.log };
  } catch (error) {
    if (!(error instanceof Violation)) throw error;
    return { violation: error, steps, log: world.log };
  } finally {
    world.checks.close();
    await world.s.dispose();
  }
}

/**
 * The shortest list of actions found that still breaks the same invariant as
 * `actions` did (`failed` is how that run ended): it drops runs of actions,
 * long ones first, and keeps a shorter list whenever that still fails the
 * same way. It asks `outOfTime` before each run, and when that says yes it
 * stops with the shortest so far.
 */
export async function shrink(
  setup: Setup,
  actions: readonly Action[],
  failed: RunResult,
  runner: (setup: Setup, actions: readonly Action[]) => Promise<RunResult>,
  outOfTime: () => boolean,
): Promise<{ actions: Action[]; result: RunResult; stopped: boolean }> {
  const invariant = failed.violation?.invariant;
  if (invariant === undefined) throw new Error("the run to shrink didn't fail");
  let best = actions.slice(0, failed.steps);
  let result = failed;
  // Until a whole pass drops nothing: taking one action out often frees others.
  for (let dropped = true; dropped;) {
    dropped = false;
    for (let size = Math.ceil(best.length / 2); size >= 1; size = Math.floor(size / 2)) {
      // From the end: the actions just before the failure matter most, so the early ones go in big pieces.
      for (let from = Math.max(0, best.length - size); from >= 0; from -= size) {
        if (outOfTime()) return { actions: best, result, stopped: true };
        const shorter = [...best.slice(0, from), ...best.slice(from + size)];
        const tried = await runner(setup, shorter);
        if (tried.violation?.invariant !== invariant) continue;
        best = shorter.slice(0, tried.steps);
        result = tried;
        dropped = true;
      }
    }
  }
  return { actions: best, result, stopped: false };
}

/** `value` as JSON with each id replaced by when it first appears, so two runs that made their rows in another order compare equal. */
function withoutIds(value: unknown): unknown {
  const seen = new Map<string, string>();
  const text = (JSON.stringify(value) ?? "null").replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}/g,
    (id) => {
      if (!seen.has(id)) seen.set(id, `#${seen.size + 1}`);
      return seen.get(id)!;
    },
  );
  return JSON.parse(text) as unknown;
}

/** Where two JSON values first differ, and the two values there; null if they don't. */
function firstDifference(a: unknown, b: unknown, path = ""): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const key of keys) {
      const found = firstDifference(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}/${key}`,
      );
      if (found !== null) return found;
    }
  }
  const brief = (value: unknown) => (JSON.stringify(value) ?? "undefined").slice(0, 300);
  return `${path}: with one tick ${brief(a)}, with many ${brief(b)}`;
}

/**
 * Applies `actions` to two scenarios side by side. In the first every tick
 * is one tick, however far it moves the clock, as after an outage. In the
 * second it's many ticks on the way. The core catches up on what it missed
 * (`advanceTo`), so after every action every query must answer the same in
 * both. Camera pacts only: what Oura and AnkiWeb said depends on when they
 * were asked.
 */
export async function runBothWays(setup: Setup, actions: readonly Action[]): Promise<RunResult> {
  const cameraOnly = { ...setup, automatic: false };
  const once = new World(cameraOnly);
  const many = new World(cameraOnly, { manyTicks: true });
  let steps = 0;
  try {
    await once.start();
    await many.start();
    for (const action of actions) {
      steps++;
      const marks = `${markOf(once)}, ${markOf(many)}`;
      await once.checks.guard(action.do, () => once.apply(action));
      await many.checks.guard(action.do, () => many.apply(action));
      // As in `run`: if neither did anything, both answer as they did at the last comparison.
      if (`${markOf(once)}, ${markOf(many)}` === marks) continue;
      const difference = firstDifference(withoutIds(once.checks.everything()), withoutIds(many.checks.everything()));
      if (difference !== null) throw new Violation("one-tick-or-many", difference);
    }
    return { violation: null, steps, log: once.log };
  } catch (error) {
    if (!(error instanceof Violation)) throw error;
    return { violation: error, steps, log: once.log };
  } finally {
    once.checks.close();
    many.checks.close();
    await once.s.dispose();
    await many.s.dispose();
  }
}
