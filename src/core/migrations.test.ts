// Migrations that change data, tested on a database made at the version
// before them. Migrations 5 and 20 read SQLite's clock, so each of their
// tests has two steps: the migration step reads the real time just before and
// after the rest of the migrations run and asserts the stamp lies between
// them, which holds whatever the time; the behaviour step overwrites the stamp
// with a fixed one and runs the core on a FakeClock from there, so it gives
// the same result on any day.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { systemClock } from "./adapters.ts";
import { localDateOf } from "./calendar.ts";
import { createPactCore, type PactCore } from "./core.ts";
import { openDatabase } from "./db.ts";
import { migrations } from "./migrations.ts";
import { FakeClock, FakeOuraSource, InMemoryPhotoStore, RecordingNotifier } from "./testing/fakes.ts";

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pact-migrations-"));
  path = join(dir, "pact.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The core on the migrated database, with a FakeClock starting at `start`. */
function coreAt(start: Date): { core: PactCore; clock: FakeClock; notifier: RecordingNotifier } {
  const clock = new FakeClock(start);
  const notifier = new RecordingNotifier();
  const core = createPactCore({
    dbPath: path,
    clock,
    notifier,
    ouraSource: new FakeOuraSource(),
    photoStore: new InMemoryPhotoStore(clock),
    operatorEmail: "owner@example.test",
    log: () => {},
  });
  return { core, clock, notifier };
}

/** Runs the remaining migrations, returning the real time read just before and just after. */
function migrateRest(): { db: ReturnType<typeof openDatabase>; before: Date; after: Date } {
  const before = systemClock.now();
  const db = openDatabase(path);
  const after = systemClock.now();
  return { db, before, after };
}

async function advance(core: PactCore, clock: FakeClock, t: Date): Promise<void> {
  clock.set(t);
  await core.advanceTo(clock.now());
  await core.deliveriesSettled();
}

test("migration 5: a pact made before judging existed gets no penalty for any occurrence due before the migration ran", async () => {
  // At migration 4: a daily pact whose first occurrence was years ago, never judged.
  const seeded = openDatabase(path, migrations.slice(0, 4));
  seeded.exec(`
    INSERT INTO account (id, email, email_key, name, timezone, created_at)
      VALUES ('owner', 'owner@example.test', 'owner@example.test', 'owner', 'America/New_York', '2020-01-01T00:00:00Z');
    INSERT INTO recipient (id, owner_account_id, name, created_at)
      VALUES ('sam', 'owner', 'Sam', '2020-01-01T00:00:00Z');
    INSERT INTO pact (id, owner_account_id, name, description, evidence_kind, schedule, penalty_cents,
                      recipient_id, stage, first_occurrence, created_at)
      VALUES ('gym', 'owner', 'Gym', 'A photo of Gym', 'camera',
              '{"kind":"fixed-days","days":["mon","tue","wed","thu","fri","sat","sun"]}', 500,
              'sam', 'active', '2020-01-06', '2020-01-01T00:00:00Z');
  `);
  seeded.close();

  // The migration stamps the pact's judging cursor with the UTC date it ran.
  const { db, before, after } = migrateRest();
  const { judged_through } = db.prepare("SELECT judged_through FROM pact WHERE id = 'gym'").get() as {
    judged_through: string;
  };
  expect(judged_through >= localDateOf(before, "UTC") && judged_through <= localDateOf(after, "UTC")).toBe(true);

  // As if it ran on Wed 2026-01-07 (10:00 in New York), and the release with judging booted then.
  db.prepare("UPDATE pact SET judged_through = '2026-01-07' WHERE id = 'gym'").run();
  db.close();
  const { core, clock } = coreAt(new Date("2026-01-07T15:00:00Z"));
  const owner = core.as("owner");
  await advance(core, clock, clock.now());

  expect(owner.ledgers()).toEqual([expect.objectContaining({ name: "Sam", owedCents: 0 })]);

  // Judging carries on from there: Thursday and Friday, the days after the stamp now due, are judged.
  await advance(core, clock, new Date("2026-01-10T15:00:00Z"));
  const ledger = owner.ledger("sam");
  if (!ledger.ok) throw new Error(ledger.reason);
  expect(ledger.ledger.history.map((e) => (e.kind === "penalty" ? e.occurrenceDate : e.kind)).sort()).toEqual([
    "2026-01-08",
    "2026-01-09",
  ]);
  await core.close();
});

test("migration 19: evidence from before Weekly count counts for its own day", async () => {
  // At migration 18: a daily pact with Monday's evidence approved and Tuesday's waiting.
  const before = openDatabase(path, migrations.slice(0, 18));
  before.exec(`
    INSERT INTO account (id, email, email_key, name, timezone, created_at)
      VALUES ('owner', 'owner@example.test', 'owner@example.test', 'owner', 'America/New_York', '2026-01-01T00:00:00Z'),
             ('reviewer', 'reviewer@example.test', 'reviewer@example.test', 'reviewer', 'America/New_York',
              '2026-01-01T00:00:00Z');
    INSERT INTO recipient (id, owner_account_id, name, created_at)
      VALUES ('sam', 'owner', 'Sam', '2026-01-01T00:00:00Z');
    INSERT INTO pact (id, owner_account_id, name, description, evidence_kind, schedule, penalty_cents,
                      recipient_id, stage, first_occurrence, created_at, reviewers_notified_at)
      VALUES ('gym', 'owner', 'Gym', 'A photo of Gym', 'camera',
              '{"kind":"fixed-days","days":["mon","tue","wed","thu","fri","sat","sun"]}', 500,
              'sam', 'active', '2026-01-05', '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z');
    INSERT INTO pact_reviewer (pact_id, reviewer_account_id) VALUES ('gym', 'reviewer');
    INSERT INTO occurrence (pact_id, date) VALUES ('gym', '2026-01-05'), ('gym', '2026-01-06');
    INSERT INTO evidence (id, pact_id, occurrence_date, submitted_at, decision, decided_by_account_id, decided_at)
      VALUES ('monday', 'gym', '2026-01-05', '2026-01-05T15:00:00Z', 'approved', 'reviewer', '2026-01-05T16:00:00Z');
    INSERT INTO evidence (id, pact_id, occurrence_date, submitted_at)
      VALUES ('tuesday', 'gym', '2026-01-06', '2026-01-06T15:00:00Z');
  `);
  before.close();

  const { core } = coreAt(new Date("2026-01-07T15:00:00Z"));

  expect(core.as("owner").today().waiting).toEqual([
    expect.objectContaining({ kind: "evidence", id: "tuesday", occurrenceDate: "2026-01-06" }),
  ]);
  expect(core.as("reviewer").reviewQueue()).toEqual([
    expect.objectContaining({ kind: "evidence", id: "tuesday", occurrenceDate: "2026-01-06" }),
  ]);
  await core.close();
});

// The new-bill notifications sent so far.
const newBills = (notifier: RecordingNotifier) => notifier.sent.filter((n) => n.kind === "new-bill");

test.each([
  // Wed 10:00 in New York, before that day's 18:00 bill: the first bill falls the same day.
  { stamp: "2026-01-07T15:00:00.000Z", billedOn: "2026-01-07", billAt: "2026-01-07T23:00:00Z" },
  // Thu 10:00 in New York: the first bill falls the next Wednesday.
  { stamp: "2026-01-08T15:00:00.000Z", billedOn: "2026-01-14", billAt: "2026-01-14T23:00:00Z" },
])(
  "migration 20: an account made before billing existed gets no bill for any Wednesday before the migration ran (stamped $stamp)",
  async ({ stamp, billedOn, billAt }) => {
    // At migration 13, before bills: an owner since 2020 who owes Sam a penalty from then, and
    // another account. Judging is ahead of the test's days, so only the old penalty is
    // ever owed.
    const seeded = openDatabase(path, migrations.slice(0, 13));
    seeded.exec(`
      INSERT INTO account (id, email, email_key, name, timezone, created_at)
        VALUES ('owner', 'owner@example.test', 'owner@example.test', 'owner', 'America/New_York', '2020-01-01T00:00:00Z'),
               ('billed', 'billed@example.test', 'billed@example.test', 'billed', 'America/New_York',
                '2020-01-01T00:00:00Z');
      INSERT INTO recipient (id, owner_account_id, name, created_at)
        VALUES ('sam', 'owner', 'Sam', '2020-01-01T00:00:00Z'),
               ('ali', 'billed', 'Ali', '2020-01-01T00:00:00Z');
      INSERT INTO pact (id, owner_account_id, name, description, evidence_kind, schedule, penalty_cents,
                        recipient_id, stage, first_occurrence, created_at, judged_through)
        VALUES ('gym', 'owner', 'Gym', 'A photo of Gym', 'camera',
                '{"kind":"fixed-days","days":["mon","tue","wed","thu","fri","sat","sun"]}', 500,
                'sam', 'active', '2020-01-06', '2020-01-01T00:00:00Z', '2026-03-01');
      INSERT INTO occurrence (pact_id, date, outcome, judged_at)
        VALUES ('gym', '2020-01-06', 'missed', '2020-01-07T05:00:00Z');
      INSERT INTO penalty (id, owner_account_id, recipient_id, pact_id, occurrence_date, amount_cents, added_at)
        VALUES ('missed', 'owner', 'sam', 'gym', '2020-01-06', 500, '2020-01-07T05:00:00Z');
    `);
    seeded.close();
    // At migration 19, with bills: the other account has had one.
    const billing = openDatabase(path, migrations.slice(0, 19));
    billing.exec(`
      INSERT INTO bill (id, owner_account_id, recipient_id, billed_on, created_at, due_at)
        VALUES ('old', 'billed', 'ali', '2020-01-08', '2020-01-08T23:00:00Z', '2020-01-15T23:00:00Z');
    `);
    billing.close();

    // The migration stamps billing with the instant it ran, except for an account with a bill.
    const { db, before, after } = migrateRest();
    const billedThrough = (id: string) =>
      (db.prepare("SELECT billed_through FROM account WHERE id = ?").get(id) as { billed_through: string | null })
        .billed_through;
    const stamped = billedThrough("owner");
    expect(stamped !== null && stamped >= before.toISOString() && stamped <= after.toISOString()).toBe(true);
    expect(billedThrough("billed")).toBeNull();

    // As if it ran at `stamp`, and the release with bills booted then.
    db.prepare("UPDATE account SET billed_through = ? WHERE id = 'owner'").run(stamp);
    db.close();
    const { core, clock, notifier } = coreAt(new Date(stamp));
    const owner = core.as("owner");
    await advance(core, clock, clock.now());

    const billOf = () => {
      const ledger = owner.ledger("sam");
      if (!ledger.ok) throw new Error(ledger.reason);
      const [entry] = ledger.ledger.history;
      if (entry?.kind !== "penalty") throw new Error("no penalty");
      return entry.bill;
    };
    expect(newBills(notifier)).toEqual([]);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500, overdueCents: 0, billDue: null })]);
    expect(billOf()).toEqual({ kind: "next-bill", billedOn });

    // Billing carries on from there: the penalty goes on the first Wednesday bill after the stamp,
    // and no earlier Wednesday gets one.
    await advance(core, clock, new Date(billAt));
    expect(newBills(notifier)).toHaveLength(1);
    expect(billOf()).toMatchObject({ kind: "on-bill", billedOn });
    await core.close();
  },
);
