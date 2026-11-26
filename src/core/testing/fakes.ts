// Fakes for the six ports. Used only by tests.

import type { AccountId } from "../../shared/types.ts";
import type {
  AnkiCounts,
  AnkiCountsResult,
  AnkiDeck,
  AnkiDeckListResult,
  AnkiSource,
  Clock,
  DeliveryReport,
  Email,
  Mailer,
  Notification,
  NotificationKind,
  NotificationOf,
  Notifier,
  OuraDateRange,
  OuraSleepPeriod,
  OuraSleepResult,
  OuraSource,
  Photo,
  PhotoStore,
  Push,
  PushDevice,
  StoredPhoto,
} from "../ports.ts";

/** A clock that only moves when the test moves it, and only forward. */
export class FakeClock implements Clock {
  #current: Date;

  constructor(start: Date) {
    this.#current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.#current.getTime());
  }

  set(t: Date): void {
    if (t.getTime() < this.#current.getTime()) {
      throw new Error(
        `FakeClock: time only moves forward (now ${this.#current.toISOString()}, asked for ${t.toISOString()})`,
      );
    }
    this.#current = new Date(t.getTime());
  }
}

/** Records every notification it delivers, its badge, and the devices it went to, in delivery order. */
export class RecordingNotifier implements Notifier {
  readonly sent: Notification[] = [];
  /** The badge each of `sent` carried. */
  readonly #badges: number[] = [];
  readonly #devices: { recipient: AccountId; device: PushDevice }[] = [];
  readonly #expired = new Set<string>();
  readonly #failing = new Set<string>();
  #held: Promise<void> = Promise.resolve();

  async deliver({ badge, ...notification }: Push, devices: readonly PushDevice[]): Promise<DeliveryReport> {
    await this.#held;
    this.sent.push(structuredClone(notification as Notification));
    this.#badges.push(badge);
    const reached = devices.filter((d) => !this.#failing.has(d.endpoint));
    for (const device of reached) this.#devices.push({ recipient: notification.recipient, device: { ...device } });
    return {
      expired: devices.map((d) => d.endpoint).filter((endpoint) => this.#expired.has(endpoint)),
      failed: devices
        .filter((d) => this.#failing.has(d.endpoint))
        .map((d) => ({ endpoint: d.endpoint, error: "injected failure" })),
    };
  }

  /** Every notification delivered to `account`, or only those of `kind`, in delivery order. */
  sentTo(account: { id: AccountId }): Notification[];
  sentTo<K extends NotificationKind>(account: { id: AccountId }, kind: K): NotificationOf<K>[];
  sentTo(account: { id: AccountId }, kind?: NotificationKind): Notification[] {
    return this.sent.filter((n) => n.recipient === account.id && (kind === undefined || n.kind === kind));
  }

  /** The badge of every notification delivered to `account`, or only those of `kind`, in delivery order. */
  badgesSentTo(account: { id: AccountId }, kind?: NotificationKind): number[] {
    return this.sent.flatMap((n, i) =>
      n.recipient === account.id && (kind === undefined || n.kind === kind) ? [this.#badges[i]!] : [],
    );
  }

  /** The kind of every notification delivered to `account`, in delivery order. */
  kindsSentTo(account: { id: AccountId }): NotificationKind[] {
    return this.sentTo(account).map((n) => n.kind);
  }

  /** Every device a delivery to `account` has gone to, repeats included. */
  devicesOf(account: { id: AccountId }): PushDevice[] {
    return this.#devices.filter((d) => d.recipient === account.id).map((d) => d.device);
  }

  /** From now on the push service reports this device as expired. */
  expire(endpoint: string): void {
    this.#expired.add(endpoint);
  }

  /** From now on (or until `recover`) sending to this device fails. */
  fail(endpoint: string): void {
    this.#failing.add(endpoint);
  }

  recover(endpoint: string): void {
    this.#failing.delete(endpoint);
  }

  /** Stalls delivery, as a slow push service would, until the returned function is called. */
  hold(): () => void {
    let release = () => {};
    this.#held = new Promise((resolve) => (release = resolve));
    return release;
  }
}

/**
 * Records every email it sends, in order. A send to an address `fail` named,
 * or one `failOnCall` makes fail, rejects and is not recorded.
 */
export class RecordingMailer implements Mailer {
  readonly sent: Email[] = [];
  readonly #failing = new Set<string>();
  #held: Promise<void> = Promise.resolve();

  async send(email: Email): Promise<void> {
    await this.#held;
    if (this.#failing.has(email.to)) throw new Error(`injected failure: mail to ${email.to}`);
    this.sent.push(structuredClone(email));
  }

  /** Sends stall, as a hung mail server's would, until the returned function is called. */
  hold(): () => void {
    let release = () => {};
    this.#held = new Promise((resolve) => (release = resolve));
    return release;
  }

  /** From now on (or until `recover`) sending to `address` fails. */
  fail(address: string): void {
    this.#failing.add(address);
  }

  recover(address: string): void {
    this.#failing.delete(address);
  }
}

/** Keeps photos in memory; the received time comes from the given clock. */
export class InMemoryPhotoStore implements PhotoStore {
  readonly #clock: Clock;
  readonly #photos = new Map<string, Photo>();
  /** Every photo id it has handed out, in order. */
  readonly photoIds: string[] = [];
  #nextId = 1;
  #held: Promise<void> = Promise.resolve();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async store(photo: Photo): Promise<StoredPhoto> {
    const photoId = `photo-${this.#nextId++}`;
    const receivedAt = this.#clock.now();
    await this.#held;
    this.photoIds.push(photoId);
    this.#photos.set(photoId, { bytes: photo.bytes.slice(), contentType: photo.contentType });
    return { photoId, receivedAt };
  }

  /** Uploads received from now on don't finish until the returned function is called. */
  hold(): () => void {
    let release = () => {};
    this.#held = new Promise((resolve) => (release = resolve));
    return release;
  }

  async fetch(photoId: string): Promise<Photo | null> {
    const photo = this.#photos.get(photoId);
    return photo ? { bytes: photo.bytes.slice(), contentType: photo.contentType } : null;
  }
}

/**
 * A fake source's call held open, as a slow service would: `started`
 * resolves once it's called; it answers once `release` is called, or throws
 * the error given to `fail`, as an unreachable service would.
 */
export interface HeldCall {
  started: Promise<void>;
  release: () => void;
  fail: (error: Error) => void;
}

/** A `HeldCall`, and what the source awaits for it: `started` to call, then `released`. */
function holdCall(): { held: HeldCall; hold: { started: () => void; released: Promise<void> } } {
  let started = () => {};
  let release = () => {};
  let fail = (_error: Error) => {};
  const called = new Promise<void>((resolve) => (started = resolve));
  const released = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { held: { started: called, release, fail }, hold: { started, released } };
}

/**
 * Serves the sleep periods a test has given each account, filtered to the
 * requested days, or "disconnected" for an account the test disconnected.
 */
export class FakeOuraSource implements OuraSource {
  readonly #periods = new Map<AccountId, OuraSleepPeriod[]>();
  readonly #disconnected = new Set<AccountId>();
  /** Every call, in order: whose sleep periods, and for which days. */
  readonly calls: ({ account: AccountId } & OuraDateRange)[] = [];
  readonly #holds = new Map<AccountId, { started: () => void; released: Promise<void> }>();

  /** Holds `account`'s next sleepPeriods call open (`HeldCall`). */
  holdSleepPeriods(account: AccountId): HeldCall {
    const { held, hold } = holdCall();
    this.#holds.set(account, hold);
    return held;
  }

  addSleep(account: AccountId, ...periods: OuraSleepPeriod[]): void {
    this.#periods.set(account, [...(this.#periods.get(account) ?? []), ...periods]);
  }

  disconnect(account: AccountId): void {
    this.#disconnected.add(account);
  }

  reconnect(account: AccountId): void {
    this.#disconnected.delete(account);
  }

  async sleepPeriods(account: AccountId, range: OuraDateRange): Promise<OuraSleepResult> {
    this.calls.push({ account, ...range });
    const hold = this.#holds.get(account);
    if (hold) {
      this.#holds.delete(account);
      hold.started();
      await hold.released;
    }
    if (this.#disconnected.has(account)) return { ok: false, reason: "disconnected" };
    const periods = (this.#periods.get(account) ?? []).filter(
      (p) => p.day >= range.startDate && p.day <= range.endDate,
    );
    return { ok: true, periods: structuredClone(periods) };
  }
}

/**
 * Serves each account's decks and counts as a test sets them, or
 * "disconnected" for an account the test disconnected. Counts are as of the
 * Anki day and moment the test last set (`setAnkiDay`), with each deck's name
 * as last set; a deck the test removed answers null.
 */
export class FakeAnkiSource implements AnkiSource {
  readonly #decks = new Map<AccountId, AnkiDeck[]>();
  readonly #days = new Map<AccountId, { ankiDate: string; asOf: Date }>();
  readonly #disconnected = new Set<AccountId>();
  rolloverHour = 4;
  /** Every deckCounts call, in order. */
  readonly countCalls: { account: AccountId; deckIds: string[] }[] = [];
  readonly #holds = new Map<AccountId, { started: () => void; released: Promise<void> }>();

  /** Adds or replaces a deck. */
  setDeck(
    account: AccountId,
    deck: { id: string; name: string; parentId?: string | null } & Partial<AnkiCounts>,
  ): void {
    const decks = (this.#decks.get(account) ?? []).filter((d) => d.id !== deck.id);
    const { id, name, parentId = null, new: fresh = 0, learn = 0, review = 0 } = deck;
    decks.push({ id, name, parentId, counts: { new: fresh, learn, review } });
    this.#decks.set(account, decks);
  }

  removeDeck(account: AccountId, deckId: string): void {
    this.#decks.set(
      account,
      (this.#decks.get(account) ?? []).filter((d) => d.id !== deckId),
    );
  }

  /** The Anki day and evaluation moment the next counts are for. */
  setAnkiDay(account: AccountId, ankiDate: string, asOf: Date): void {
    this.#days.set(account, { ankiDate, asOf: new Date(asOf.getTime()) });
  }

  disconnect(account: AccountId): void {
    this.#disconnected.add(account);
  }

  /** AnkiWeb takes the account's login again, as after the owner reconnects. */
  reconnect(account: AccountId): void {
    this.#disconnected.delete(account);
  }

  /** Holds `account`'s next deckCounts call open (`HeldCall`), as a slow AnkiWeb would. */
  holdDeckCounts(account: AccountId): HeldCall {
    const { held, hold } = holdCall();
    this.#holds.set(account, hold);
    return held;
  }

  async decks(account: AccountId): Promise<AnkiDeckListResult> {
    if (this.#disconnected.has(account)) return { ok: false, reason: "disconnected" };
    return { ok: true, decks: structuredClone(this.#decks.get(account) ?? []), rolloverHour: this.rolloverHour };
  }

  async deckCounts(account: AccountId, deckIds: readonly string[]): Promise<AnkiCountsResult> {
    this.countCalls.push({ account, deckIds: [...deckIds] });
    const hold = this.#holds.get(account);
    if (hold) {
      this.#holds.delete(account);
      hold.started();
      await hold.released;
    }
    if (this.#disconnected.has(account)) return { ok: false, reason: "disconnected" };
    const day = this.#days.get(account);
    if (!day) throw new Error(`FakeAnkiSource: no Anki day set for ${account}`);
    const decks = (this.#decks.get(account) ?? []).filter((d) => deckIds.includes(d.id));
    return {
      ok: true,
      ankiDate: day.ankiDate,
      asOf: new Date(day.asOf.getTime()),
      decks: Object.fromEntries(
        deckIds.map((id) => [id, structuredClone(decks.find((d) => d.id === id)?.counts ?? null)]),
      ),
      names: Object.fromEntries(decks.map((d) => [d.id, d.name])),
    };
  }
}

/**
 * Makes `port[method]` throw on its `n`th call from now (1 = the next call).
 * Every other call, before and after, behaves normally.
 */
export function failOnCall<T extends object, K extends keyof T>(
  port: T,
  method: K,
  n: number,
  error: Error = new Error(`injected failure: ${String(method)} call ${n}`),
): void {
  const original = port[method];
  if (typeof original !== "function") throw new Error(`${String(method)} is not a method`);
  let calls = 0;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    calls += 1;
    if (calls === n) {
      // Async ports reject; sync ports (the clock) throw.
      if (original.constructor.name === "AsyncFunction") return Promise.reject(error);
      throw error;
    }
    return original.apply(this, args);
  };
  port[method] = wrapped as T[K];
}
