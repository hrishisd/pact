// Fakes for the four ports. Used only by tests.

import type { AccountId } from "../../shared/types.ts";
import type {
  Clock,
  Notification,
  Notifier,
  OuraDateRange,
  OuraSleepPeriod,
  OuraSleepResult,
  OuraSource,
  Photo,
  PhotoStore,
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

/** Records every notification it delivers, in delivery order. */
export class RecordingNotifier implements Notifier {
  readonly sent: Notification[] = [];

  async deliver(notification: Notification): Promise<void> {
    this.sent.push(structuredClone(notification));
  }

  sentTo(account: { id: AccountId }): Notification[] {
    return this.sent.filter((n) => n.recipient === account.id);
  }
}

/** Keeps photos in memory; the received time comes from the given clock. */
export class InMemoryPhotoStore implements PhotoStore {
  readonly #clock: Clock;
  readonly #photos = new Map<string, Photo>();
  #nextId = 1;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async store(photo: Photo): Promise<StoredPhoto> {
    const photoId = `photo-${this.#nextId++}`;
    this.#photos.set(photoId, { bytes: photo.bytes.slice(), contentType: photo.contentType });
    return { photoId, receivedAt: this.#clock.now() };
  }

  async fetch(photoId: string): Promise<Photo | null> {
    const photo = this.#photos.get(photoId);
    return photo ? { bytes: photo.bytes.slice(), contentType: photo.contentType } : null;
  }
}

/**
 * Serves the sleep periods a test has given each account, filtered to the
 * requested days, or "disconnected" for an account the test disconnected.
 */
export class FakeOuraSource implements OuraSource {
  readonly #periods = new Map<AccountId, OuraSleepPeriod[]>();
  readonly #disconnected = new Set<AccountId>();

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
    if (this.#disconnected.has(account)) return { ok: false, reason: "disconnected" };
    const periods = (this.#periods.get(account) ?? []).filter(
      (p) => p.day >= range.startDate && p.day <= range.endDate,
    );
    return { ok: true, periods: structuredClone(periods) };
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
