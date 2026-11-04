// The scenario harness: every core test is written with it.
//
// A scenario is one Pact core on its own temporary SQLite file (production
// pragmas, WAL), with fakes for the four ports. Tests act as named accounts,
// issue commands, move time with `advanceTo`, and assert only on query
// results, on what `s.notifier` recorded, and on `s.logs`. Never on storage.
//
// TIME STRINGS. Wherever the harness takes a time, "Mon 18:00" means that
// wall-clock time in America/New_York during the reference week
// Mon 5 Jan – Sun 11 Jan 2026 (UTC−5 all week, no DST change), so
// "Mon 18:00" is 2026-01-05T23:00:00Z. A "+N" after the day moves N weeks on:
// "Wed+1 18:00" is the next week's Wednesday (14 Jan). Any ISO 8601 string
// with an offset or "Z" is accepted as is. The clock starts at "Mon 09:00".
//
// NAMES. `s.signIn("owner")` signs in as owner@example.test, display name
// "owner". The operator (whose first sign-in may create an account without
// an invite) is "owner".

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { zonedWallTimeToInstant } from "../calendar.ts";
import { createPactCore, type AccountView, type PactCore } from "../core.ts";
import type { AccountId, SignInResult } from "../../shared/types.ts";
import { FakeClock, FakeOuraSource, InMemoryPhotoStore, RecordingNotifier } from "./fakes.ts";

/** A named account. Every AccountView query and command, plus its id. */
export type AccountHandle = AccountView & { readonly id: AccountId; readonly name: string };

/** As on the invite page: sign in carrying the invite link's token. */
interface SignInOptions {
  inviteToken?: string;
}

export interface Scenario {
  /** The current core. Replaced by `restart()`. */
  readonly core: PactCore;
  readonly clock: FakeClock;
  readonly notifier: RecordingNotifier;
  readonly ouraSource: FakeOuraSource;
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
const REFERENCE_WEEK_MONDAY = { year: 2026, month: 1, day: 5 } as const;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const OPERATOR = "owner";

export function scenario(): Scenario {
  const dir = mkdtempSync(join(tmpdir(), "pact-test-"));
  const dbPath = join(dir, "pact.db");
  const clock = new FakeClock(at("Mon 09:00"));
  const notifier = new RecordingNotifier();
  const ouraSource = new FakeOuraSource();
  const photoStore = new InMemoryPhotoStore(clock);
  const logs: string[] = [];
  // UUID-shaped ids in creation order, so a tie broken by id breaks the same way
  // every run. Shared across restart(), as the database is.
  let idCount = 0;
  const newId = () => `00000000-0000-4000-8000-${(++idCount).toString(16).padStart(12, "0")}`;

  const build = () =>
    createPactCore({
      dbPath,
      clock,
      notifier,
      ouraSource,
      photoStore,
      operatorEmail: emailFor(OPERATOR),
      log: (line) => logs.push(line),
      newId,
    });
  let core = build();

  onTestFinished(async () => {
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
          return result instanceof Promise ? result.finally(() => core.deliveriesSettled()) : result;
        };
      },
    });

  const s: Scenario = {
    get core() {
      return core;
    },
    clock,
    notifier,
    ouraSource,
    photoStore,
    logs,
    dbPath,
    at,
    attemptSignIn: (name, options) => core.signIn({ email: emailFor(name), name }, options),
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
      await core.advanceTo(clock.now());
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
  const match = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:\+(\d+))? (\d{2}):(\d{2})$/.exec(when);
  if (!match) throw new Error(`unreadable scenario time "${when}" (want e.g. "Mon 18:00" or "Wed+1 18:00")`);
  const [, day, weeks, hh, mm] = match as unknown as [
    string,
    (typeof DAYS)[number],
    string | undefined,
    string,
    string,
  ];
  const { year, month, day: monday } = REFERENCE_WEEK_MONDAY;
  const dayOfMonth = monday + 7 * Number(weeks ?? 0) + DAYS.indexOf(day);
  return zonedWallTimeToInstant(year, month, dayOfMonth, Number(hh), Number(mm), TIMEZONE);
}
