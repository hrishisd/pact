// The scenario harness: every core test is written with it.
//
// A scenario is one Pact core on its own temporary SQLite file (production
// pragmas, WAL), with fakes for the six ports. Tests act as named accounts,
// issue commands, move time with `advanceTo`, and assert only on query
// results, on what `s.notifier` and `s.mailer` recorded, and on `s.logs`.
// Never on storage.
//
// TIME STRINGS. Wherever the harness takes a time, "Mon 18:00" means that
// wall-clock time in America/New_York during the reference week
// Mon 5 Jan – Sun 11 Jan 2026 (UTC−5 all week, no DST change), so
// "Mon 18:00" is 2026-01-05T23:00:00Z. A "+N" after the day moves N weeks on:
// "Wed+1 18:00" is the next week's Wednesday (14 Jan). Any ISO 8601 string
// with an offset or "Z" is accepted as is. The clock starts at "Mon 09:00".
//
// DATES. A day on its own names that day's date in the reference week, with
// the same "+N": `s.date("Tue")` is "2026-01-06", `s.date("Wed+1")` is
// "2026-01-14".
//
// NAMES. `s.signIn("owner")` signs in as owner@example.test, display name
// "owner", from a browser in America/New_York unless told otherwise. The
// operator (whose first sign-in may create an account without an invite) is
// "owner".

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { wallTime } from "../calendar.ts";
import { addDays } from "../../shared/calendar.ts";
import { createPactCore, type AccountView, type PactCore } from "../core.ts";
import { operatorAlerts, type OperatorAlerts } from "../operator-alerts.ts";
import type { AccountId, ChangePactResult, LocalDate, SignInResult } from "../../shared/types.ts";
import {
  FakeAnkiSource,
  FakeClock,
  FakeOuraSource,
  InMemoryPhotoStore,
  RecordingMailer,
  RecordingNotifier,
} from "./fakes.ts";
import { SourceWatch, VerdictCheck } from "./verdict-check.ts";

/** A named account. Every AccountView query and command, plus its id. */
export type AccountHandle = AccountView & { readonly id: AccountId; readonly name: string };

/** The id of the change request a sent change became; throws if it became none. */
export function changeRequestIdOf(result: ChangePactResult): string {
  if (!result.ok || result.outcome.kind !== "needs-approval")
    throw new Error(`no change request: ${JSON.stringify(result)}`);
  return result.outcome.changeRequestId;
}

/**
 * As the browser does: sign in carrying the invite link's token, if any, and
 * the browser's timezone (America/New_York unless given).
 */
interface SignInOptions {
  inviteToken?: string;
  timezone?: string;
}

export interface Scenario {
  /** The current core. Replaced by `restart()`. */
  readonly core: PactCore;
  readonly clock: FakeClock;
  readonly notifier: RecordingNotifier;
  readonly mailer: RecordingMailer;
  /** The operator's address, OPERATOR_EMAIL: where operator alert emails go. */
  readonly operatorEmail: string;
  /**
   * The operator alert path the core has, to `mailer` and `logs`, for the Oura
   * and Anki adapters too. `advanceTo` waits for its emails; after anything
   * else, `settled()` does.
   */
  readonly operatorAlerts: OperatorAlerts;
  readonly ouraSource: FakeOuraSource;
  readonly ankiSource: FakeAnkiSource;
  readonly photoStore: InMemoryPhotoStore;
  /** Lines the core logged, in order. */
  readonly logs: string[];
  /**
   * The scenario's SQLite file, in a temporary directory removed when the
   * test finishes. For the server tests, which put Better Auth on the same
   * file; core tests never touch storage.
   */
  readonly dbPath: string;

  /** The instant a time string names (see TIME STRINGS above). */
  at(when: string): Date;
  /** The local date a day names, "Tue" or "Wed+1" (see DATES above). */
  date(day: string): LocalDate;
  /** Signs in as `name`; throws if the sign-in is refused. */
  signIn(name: string, options?: SignInOptions): Promise<AccountHandle>;
  /** Signs in as `name` and returns the core's answer, refused or not. */
  attemptSignIn(name: string, options?: SignInOptions): Promise<SignInResult>;
  /**
   * Makes `name` a friend of `inviter` the way people do: the inviter creates
   * an invite (or `inviteToken` is used), `name` signs in with it and accepts.
   * Throws if any step is refused. Returns the new friend's handle.
   */
  befriend(inviter: AccountHandle, name: string, inviteToken?: string): Promise<AccountHandle>;
  /** A scheduler tick: moves the clock to `when` and runs advance to T. */
  advanceTo(when: string): Promise<void>;
  /** Moves the clock only, as if the scheduler had stopped. */
  setClockTo(when: string): void;
  /** Discards the core and builds a new one on the same database file. */
  restart(): Promise<void>;
}

const TIMEZONE = "America/New_York";
const REFERENCE_WEEK_MONDAY = "2026-01-05";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const OPERATOR = "owner";
/** Where the app is: links in emails start with it. */
const APP_URL = "https://pact.example.test";

export function scenario(): Scenario {
  const dir = mkdtempSync(join(tmpdir(), "pact-test-"));
  const dbPath = join(dir, "pact.db");
  const clock = new FakeClock(at("Mon 09:00"));
  const notifier = new RecordingNotifier();
  const mailer = new RecordingMailer();
  const logs: string[] = [];
  const alerts = operatorAlerts({
    mailer,
    operatorEmail: emailFor(OPERATOR),
    log: (line) => logs.push(line),
  });
  const ouraSource = new FakeOuraSource();
  const ankiSource = new FakeAnkiSource();
  const photoStore = new InMemoryPhotoStore(clock);
  // After every command and tick, judging's stored outcomes must be what verdictOf says (verdict-check.ts).
  const watch = new SourceWatch(clock);
  const verdicts = new VerdictCheck(dbPath, clock, watch);
  // UUID-shaped ids in creation order, so a tie broken by id breaks the same way
  // every run. Shared across restart(), as the database is.
  let idCount = 0;
  const newId = () => `00000000-0000-4000-8000-${(++idCount).toString(16).padStart(12, "0")}`;

  const build = () =>
    createPactCore({
      dbPath,
      clock,
      notifier,
      mailer,
      appUrl: APP_URL,
      raiseOperatorAlert: alerts.raise,
      ouraSource: watch.oura(ouraSource),
      ankiSource: watch.anki(ankiSource),
      photoStore,
      operatorEmail: emailFor(OPERATOR),
      log: (line) => logs.push(line),
      newId,
    });
  let core = build();

  onTestFinished(async () => {
    verdicts.close();
    await core.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const handle = (id: AccountId, name: string): AccountHandle =>
    new Proxy({} as AccountHandle, {
      get(_target, prop) {
        if (prop === "id") return id;
        if (prop === "name") return name;
        // Resolve against the current core on every use, so handles survive restart().
        const view = core.as(id);
        const value = Reflect.get(view, prop);
        if (typeof value !== "function") return value;
        // Commands don't wait for delivery; a scenario's next line may assert on it.
        return (...args: unknown[]) => {
          const result = value.apply(view, args);
          if (!(result instanceof Promise)) return result;
          return result
            .finally(() => core.deliveriesSettled())
            .then((value: unknown) => {
              verdicts.check();
              return value;
            });
        };
      },
    });

  const s: Scenario = {
    get core() {
      return core;
    },
    clock,
    notifier,
    mailer,
    operatorEmail: emailFor(OPERATOR),
    operatorAlerts: alerts,
    ouraSource,
    ankiSource,
    photoStore,
    logs,
    dbPath,
    at,
    date: referenceDate,
    attemptSignIn: (name, options) =>
      core.signIn({ email: emailFor(name), name }, { timezone: "America/New_York", ...options }),
    async signIn(name, options) {
      const result = await s.attemptSignIn(name, options);
      if (!result.ok) throw new Error(`sign-in as ${name} refused: ${result.reason}`);
      return handle(result.accountId, name);
    },
    async befriend(inviter, name, inviteToken) {
      const token = inviteToken ?? (await inviter.createInvite()).token;
      const friend = await s.signIn(name, { inviteToken: token });
      const accepted = await friend.acceptInvite(token);
      if (!accepted.ok) throw new Error(`${name} could not accept ${inviter.name}'s invite: ${accepted.reason}`);
      return friend;
    },
    async advanceTo(when) {
      clock.set(at(when));
      watch.tick(clock.now());
      await core.advanceTo(clock.now());
      await alerts.settled();
      verdicts.check();
    },
    setClockTo(when) {
      clock.set(at(when));
    },
    async restart() {
      await core.close();
      core = build();
    },
  };
  return s;
}

function emailFor(name: string): string {
  return `${name}@example.test`;
}

/** Reads a time string as described under TIME STRINGS at the top of this file. */
function at(when: string): Date {
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(when)) return new Date(when);
  const match = /^(\S+) (\d{2}):(\d{2})$/.exec(when);
  const date = match && readDay(match[1]!);
  if (!date) throw new Error(`unreadable scenario time "${when}" (want e.g. "Mon 18:00" or "Wed+1 18:00")`);
  return wallTime(date, Number(match[2]), Number(match[3]), TIMEZONE);
}

/**
 * The local date a day names, as described under DATES at the top of this
 * file. Exported for the helpers that have no scenario at hand.
 */
export function referenceDate(day: string): LocalDate {
  const date = readDay(day);
  if (!date) throw new Error(`unreadable scenario day "${day}" (want e.g. "Tue" or "Wed+1")`);
  return date;
}

/** "Tue" or "Wed+1" as a reference-week date; undefined if unreadable. */
function readDay(day: string): LocalDate | undefined {
  const match = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:\+(\d+))?$/.exec(day);
  if (!match) return undefined;
  const [, name, weeks] = match as unknown as [string, (typeof DAYS)[number], string | undefined];
  return addDays(REFERENCE_WEEK_MONDAY, 7 * Number(weeks ?? 0) + DAYS.indexOf(name));
}
