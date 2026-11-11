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
import { beforeEach, expect, onTestFinished, test } from "vitest";
import { systemClock } from "./adapters.ts"; // conventions-ok: brackets SQLite's 'now', which no Clock reaches
import { localDateOf } from "./calendar.ts";
import { createPactCore, type PactCore } from "./core.ts";
import { openDatabase } from "./db.ts";
import { migrations } from "./migrations.ts";
import { FakeAnkiSource, FakeClock, FakeOuraSource, InMemoryPhotoStore, RecordingNotifier } from "./testing/fakes.ts";
import { ok } from "./testing/queries.ts";

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pact-migrations-"));
  path = join(dir, "pact.db");
  // Registered first, so it runs last: after the test's core has closed.
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
});

/** The core on the migrated database, with a FakeClock starting at `start`; it closes when the test ends. */
function coreAt(start: Date): { core: PactCore; clock: FakeClock; notifier: RecordingNotifier } {
  const clock = new FakeClock(start);
  const notifier = new RecordingNotifier();
  const core = createPactCore({
    dbPath: path,
    clock,
    notifier,
    ouraSource: new FakeOuraSource(),
    ankiSource: new FakeAnkiSource(),
    photoStore: new InMemoryPhotoStore(clock),
    operatorEmail: "owner@example.test",
    log: () => {},
  });
  onTestFinished(() => core.close());
  return { core, clock, notifier };
}

/** Runs the remaining migrations, returning the real time read just before and just after. */
function migrateRest(): { db: ReturnType<typeof openDatabase>; before: Date; after: Date } {
  const before = systemClock.now(); // conventions-ok: see the import
  const db = openDatabase(path);
  const after = systemClock.now(); // conventions-ok: see the import
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
  // Migration 20 stamped the billing cursor with the real time too; it moves to the same moment.
  db.prepare("UPDATE pact SET judged_through = '2026-01-07' WHERE id = 'gym'").run();
  db.prepare("UPDATE account SET billed_through = '2026-01-07T15:00:00.000Z' WHERE id = 'owner'").run();
  db.close();
  const { core, clock } = coreAt(new Date("2026-01-07T15:00:00Z"));
  const owner = core.as("owner");
  await advance(core, clock, clock.now());

  expect(owner.ledgers()).toEqual([expect.objectContaining({ name: "Sam", owedCents: 0 })]);

  // Judging carries on from there: Thursday and Friday, the days after the stamp now due, are judged.
  await advance(core, clock, new Date("2026-01-10T15:00:00Z"));
  const ledger = ok(owner.ledger("sam"));
  expect(ledger.ledger.history.map((e) => (e.kind === "penalty" ? e.occurrenceDate : e.kind)).sort()).toEqual([
    "2026-01-08",
    "2026-01-09",
  ]);
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

  // Migration 20 stamps the billing cursor with the real time; as if it ran when this core boots.
  const migrated = openDatabase(path);
  migrated.prepare("UPDATE account SET billed_through = '2026-01-07T15:00:00.000Z'").run();
  migrated.close();
  const { core } = coreAt(new Date("2026-01-07T15:00:00Z"));

  expect(core.as("owner").today().waiting).toEqual([
    expect.objectContaining({ kind: "evidence", id: "tuesday", occurrenceDate: "2026-01-06" }),
  ]);
  expect(core.as("reviewer").reviewQueue()).toEqual([
    expect.objectContaining({ kind: "evidence", id: "tuesday", occurrenceDate: "2026-01-06" }),
  ]);
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
      const ledger = ok(owner.ledger("sam"));
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
  },
);

test("migration 25: a Kept occurrence becomes Satisfied, and the rebuilt table keeps its keys and its references", () => {
  // At migration 24: a daily pact with one occurrence of each outcome and one not judged yet,
  // the Kept one with approved evidence and the Missed one with its penalty.
  const seeded = openDatabase(path, migrations.slice(0, 24));
  seeded.exec(`
    INSERT INTO account (id, email, email_key, name, timezone, created_at)
      VALUES ('owner', 'owner@example.test', 'owner@example.test', 'owner', 'America/New_York', '2026-01-01T00:00:00Z'),
             ('reviewer', 'reviewer@example.test', 'reviewer@example.test', 'reviewer', 'America/New_York',
              '2026-01-01T00:00:00Z');
    INSERT INTO recipient (id, owner_account_id, name, created_at)
      VALUES ('sam', 'owner', 'Sam', '2026-01-01T00:00:00Z');
    INSERT INTO pact (id, owner_account_id, name, description, evidence_kind, schedule, penalty_cents,
                      recipient_id, stage, first_occurrence, created_at)
      VALUES ('gym', 'owner', 'Gym', 'A photo of Gym', 'camera',
              '{"kind":"fixed-days","days":["mon","tue","wed","thu","fri","sat","sun"]}', 500,
              'sam', 'active', '2026-01-05', '2026-01-01T00:00:00Z');
    INSERT INTO occurrence (pact_id, date, outcome, judged_at, miss_accepted_at, bedtime_start)
      VALUES ('gym', '2026-01-05', 'kept', '2026-01-06T05:00:00Z', NULL, '2026-01-05T22:40:00-05:00'),
             ('gym', '2026-01-06', 'missed', '2026-01-07T05:00:00Z', '2026-01-07T12:00:00Z', NULL),
             ('gym', '2026-01-07', 'excused', '2026-01-08T05:00:00Z', NULL, NULL),
             ('gym', '2026-01-08', NULL, NULL, NULL, NULL);
    INSERT INTO evidence (id, pact_id, occurrence_date, day, submitted_at, decision, decided_by_account_id, decided_at)
      VALUES ('monday', 'gym', '2026-01-05', '2026-01-05', '2026-01-05T15:00:00Z', 'approved', 'reviewer',
              '2026-01-05T16:00:00Z');
    INSERT INTO penalty (id, owner_account_id, recipient_id, pact_id, occurrence_date, amount_cents, added_at)
      VALUES ('tuesday', 'owner', 'sam', 'gym', '2026-01-06', 500, '2026-01-07T05:00:00Z');
  `);
  const rowsBefore = occurrences(seeded);
  const shapeBefore = shape(seeded);
  seeded.close();

  const db = openDatabase(path, migrations.slice(0, 25));

  // Only the outcome changes, and only Kept's.
  expect(occurrences(db)).toEqual(
    rowsBefore.map((row) => (row.outcome === "kept" ? { ...row, outcome: "satisfied" } : row)),
  );
  expect(occurrences(db).map((row) => row.outcome)).toEqual(["satisfied", "missed", "excused", null]);
  // Its columns, primary key, foreign key and indexes are the same, and so is every other table,
  // including evidence and penalty, which still reference it.
  expect(shape(db)).toEqual(shapeBefore);
  expect(db.pragma("foreign_key_check")).toEqual([]);

  // Both CHECKs hold: the old outcome is refused, and an outcome still needs a judged_at.
  const insert = db.prepare("INSERT INTO occurrence (pact_id, date, outcome, judged_at) VALUES ('gym', ?, ?, ?)");
  expect(() => insert.run("2026-01-09", "kept", "2026-01-10T05:00:00Z")).toThrow(/CHECK constraint failed/);
  expect(() => insert.run("2026-01-09", "satisfied", null)).toThrow(/CHECK constraint failed/);
  insert.run("2026-01-09", "satisfied", "2026-01-10T05:00:00Z");
  // The references are enforced: evidence for an occurrence with no row, or one for a pact that doesn't exist, is refused.
  expect(() =>
    db
      .prepare(
        "INSERT INTO evidence (id, pact_id, occurrence_date, day, submitted_at) VALUES ('x', 'gym', '2026-02-01', '2026-02-01', '2026-02-01T15:00:00Z')",
      )
      .run(),
  ).toThrow(/FOREIGN KEY constraint failed/);
  expect(() => db.prepare("INSERT INTO occurrence (pact_id, date) VALUES ('none', '2026-01-05')").run()).toThrow(
    /FOREIGN KEY constraint failed/,
  );
  db.close();
});

test("migration 26: pacts and connections keep their rows and references, and take Anki", () => {
  // At migration 25: a Camera pact with a reviewer, a judged day, a penalty and earlier terms, and an Oura connection.
  const seeded = openDatabase(path, migrations.slice(0, 25));
  seeded.exec(`
    INSERT INTO account (id, email, email_key, name, timezone, created_at)
      VALUES ('owner', 'owner@example.test', 'owner@example.test', 'owner', 'America/New_York', '2026-01-01T00:00:00Z'),
             ('reviewer', 'reviewer@example.test', 'reviewer@example.test', 'reviewer', 'America/New_York',
              '2026-01-01T00:00:00Z');
    INSERT INTO recipient (id, owner_account_id, name, created_at)
      VALUES ('sam', 'owner', 'Sam', '2026-01-01T00:00:00Z');
    INSERT INTO pact (id, owner_account_id, name, description, evidence_kind, schedule, penalty_cents,
                      recipient_id, stage, first_occurrence, created_at, judged_through, due_by, reminders)
      VALUES ('gym', 'owner', 'Gym', 'A photo of Gym', 'camera',
              '{"kind":"fixed-days","days":["mon","tue","wed","thu","fri","sat","sun"]}', 500,
              'sam', 'active', '2026-01-05', '2026-01-01T00:00:00Z', '2026-01-05', '09:00', '["08:00"]');
    INSERT INTO pact_reviewer (pact_id, reviewer_account_id) VALUES ('gym', 'reviewer');
    INSERT INTO pact_earlier_terms (pact_id, until, description, schedule, penalty_cents, recipient_id)
      VALUES ('gym', '2026-01-04', 'A photo', '{"kind":"fixed-days","days":["mon"]}', 300, 'sam');
    INSERT INTO occurrence (pact_id, date, outcome, judged_at) VALUES ('gym', '2026-01-05', 'missed', '2026-01-05T14:00:00Z');
    INSERT INTO penalty (id, owner_account_id, recipient_id, pact_id, occurrence_date, amount_cents, added_at)
      VALUES ('monday', 'owner', 'sam', 'gym', '2026-01-05', 500, '2026-01-05T14:00:00Z');
    INSERT INTO connection (account_id, service, status, connected_at)
      VALUES ('owner', 'oura', 'needs-reconnecting', '2026-01-02T00:00:00Z');
  `);
  const pactBefore = seeded.prepare("SELECT * FROM pact").get() as Record<string, unknown>;
  const connectionBefore = seeded.prepare("SELECT * FROM connection").all();
  seeded.close();

  const db = openDatabase(path, migrations.slice(0, 26));

  expect(db.prepare("SELECT * FROM pact").get()).toEqual({
    ...pactBefore,
    anki_deck_id: null,
    anki_rollover_hour: null,
  });
  expect(db.prepare("SELECT * FROM connection").all()).toEqual(connectionBefore);
  expect(db.pragma("index_list(pact)")).toEqual([
    expect.objectContaining({ name: "pact_owner" }),
    expect.objectContaining({ name: "sqlite_autoindex_pact_1" }),
  ]);
  expect(db.pragma("foreign_key_check")).toEqual([]);

  // An Anki pact needs its deck and rollover hour, and only an Anki pact has them.
  const insertPact = db.prepare(
    `INSERT INTO pact (id, owner_account_id, name, description, evidence_kind, schedule, penalty_cents,
                       recipient_id, stage, first_occurrence, created_at, anki_deck_id, anki_rollover_hour)
     VALUES (?, 'owner', 'Spanish', '', ?, '{"kind":"fixed-days","days":["tue"]}', 500, 'sam', 'active',
             '2026-01-06', '2026-01-01T00:00:00Z', ?, ?)`,
  );
  expect(() => insertPact.run("a", "anki", null, 4)).toThrow(/CHECK constraint failed/);
  expect(() => insertPact.run("b", "anki", "1700000000000", null)).toThrow(/CHECK constraint failed/);
  expect(() => insertPact.run("c", "camera", "1700000000000", 4)).toThrow(/CHECK constraint failed/);
  expect(() => insertPact.run("d", "anki", "1700000000000", 24)).toThrow(/CHECK constraint failed/);
  insertPact.run("spanish", "anki", "1700000000000", 4);
  db.prepare(
    "INSERT INTO connection (account_id, service, status, connected_at) VALUES ('owner', 'anki', 'connected', ?)",
  ).run("2026-01-03T00:00:00Z");
  expect(() =>
    db
      .prepare(
        "INSERT INTO connection (account_id, service, status, connected_at) VALUES ('reviewer', 'fitbit', 'connected', ?)",
      )
      .run("2026-01-03T00:00:00Z"),
  ).toThrow(/CHECK constraint failed/);
  // The references to the rebuilt pact are enforced.
  expect(() => db.prepare("INSERT INTO occurrence (pact_id, date) VALUES ('none', '2026-01-05')").run()).toThrow(
    /FOREIGN KEY constraint failed/,
  );
  db.close();
});

test("migration 30: an account with no timezone gets UTC, and the rebuilt account table keeps its rows, index and references", () => {
  // At migration 29: an operator who confirmed a zone and an invited friend who never did, with a friendship and a recipient.
  const seeded = openDatabase(path, migrations.slice(0, 29));
  seeded.exec(`
    INSERT INTO account (id, email, email_key, name, timezone, is_operator, created_at, billed_through,
                         oura_latest_bedtime_start)
      VALUES ('owner', 'owner@example.test', 'owner@example.test', 'owner', 'America/Chicago', 1,
              '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-01T22:40:00-06:00'),
             ('friend', 'friend@example.test', 'friend@example.test', 'friend', NULL, 0,
              '2026-01-03T00:00:00Z', NULL, NULL);
    INSERT INTO friendship (account_a_id, account_b_id, created_at) VALUES ('friend', 'owner', '2026-01-03T00:00:00Z');
    INSERT INTO recipient (id, owner_account_id, name, created_at) VALUES ('sam', 'owner', 'Sam', '2026-01-01T00:00:00Z');
  `);
  const accountsBefore = seeded.prepare("SELECT * FROM account ORDER BY id").all() as Record<string, unknown>[];
  const columnsBefore = seeded.pragma("table_info(account)") as { name: string; notnull: number }[];
  const indexesBefore = indexesOf(seeded, "account");
  const restBefore = schemaOutside(seeded, "account");
  seeded.close();

  const db = openDatabase(path, migrations.slice(0, 30));

  // Only the NULL timezone changes, to UTC; every other column and row is as it was.
  expect(db.prepare("SELECT * FROM account ORDER BY id").all()).toEqual(
    accountsBefore.map((row) => (row.timezone === null ? { ...row, timezone: "UTC" } : row)),
  );
  // The same columns, now with timezone NOT NULL.
  expect(db.pragma("table_info(account)")).toEqual(
    columnsBefore.map((column) => (column.name === "timezone" ? { ...column, notnull: 1 } : column)),
  );
  // Its indexes, account_one_operator included, are the same.
  expect(indexesOf(db, "account")).toEqual(indexesBefore);
  expect(indexesOf(db, "account").map((index) => index.name)).toContain("account_one_operator");
  // Every other table, index and view is unchanged, and the references to account still hold.
  expect(schemaOutside(db, "account")).toEqual(restBefore);
  expect(db.pragma("foreign_key_check")).toEqual([]);

  // timezone is required now, and there is still only one operator.
  const insert = db.prepare(
    "INSERT INTO account (id, email, email_key, name, timezone, is_operator, created_at) VALUES (?, ?, ?, 'x', ?, ?, '2026-01-04T00:00:00Z')",
  );
  expect(() => insert.run("nozone", "a@example.test", "a@example.test", null, 0)).toThrow(/NOT NULL constraint failed/);
  expect(() => insert.run("second", "b@example.test", "b@example.test", "UTC", 1)).toThrow(/UNIQUE constraint failed/);
  // The references to the rebuilt account are enforced.
  expect(() =>
    db
      .prepare(
        "INSERT INTO recipient (id, owner_account_id, name, created_at) VALUES ('x', 'none', 'X', '2026-01-04T00:00:00Z')",
      )
      .run(),
  ).toThrow(/FOREIGN KEY constraint failed/);
  db.close();
});

/** `table`'s indexes, each with its columns and its definition. */
function indexesOf(db: ReturnType<typeof openDatabase>, table: string): { name: string }[] {
  const indexes = db.pragma(`index_list(${table})`) as { name: string }[];
  return indexes.map((index) => ({
    ...index,
    columns: db.pragma(`index_info(${index.name})`),
    sql: (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(index.name) as { sql: string | null }).sql,
  }));
}

/** Every table, index, trigger and view by its text, except `table`'s own and the migration record. */
function schemaOutside(db: ReturnType<typeof openDatabase>, table: string): unknown {
  return db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name NOT IN (?, 'schema_migration') ORDER BY name",
    )
    .all(table);
}

test("migration 31: a bedtime night judged from a sleep period keeps when that period arrived, its judging time", () => {
  // At migration 30: a bedtime pact with a night judged from a period, one judged at its close with none, and one waiting.
  const seeded = openDatabase(path, migrations.slice(0, 30));
  seeded.exec(`
    INSERT INTO account (id, email, email_key, name, timezone, created_at)
      VALUES ('owner', 'owner@example.test', 'owner@example.test', 'owner', 'America/New_York', '2026-01-01T00:00:00Z');
    INSERT INTO recipient (id, owner_account_id, name, created_at)
      VALUES ('sam', 'owner', 'Sam', '2026-01-01T00:00:00Z');
    INSERT INTO pact (id, owner_account_id, name, description, evidence_kind, schedule, penalty_cents,
                      recipient_id, stage, first_occurrence, in_bed_by, created_at)
      VALUES ('sleep', 'owner', 'Sleep', 'In bed by 23:00', 'oura',
              '{"kind":"fixed-days","days":["mon","tue","wed","thu","fri","sat","sun"]}', 500,
              'sam', 'active', '2026-01-05', '23:00', '2026-01-01T00:00:00Z');
    INSERT INTO occurrence (pact_id, date, outcome, judged_at, bedtime_start)
      VALUES ('sleep', '2026-01-05', 'satisfied', '2026-01-06T12:00:00Z', '2026-01-05T22:40:00-05:00'),
             ('sleep', '2026-01-06', 'missed', '2026-01-07T23:00:00Z', NULL),
             ('sleep', '2026-01-07', NULL, NULL, NULL);
  `);
  const rowsBefore = occurrences(seeded);
  seeded.close();

  const db = openDatabase(path, migrations.slice(0, 31));

  expect(occurrences(db)).toEqual(
    rowsBefore.map((row) => ({ ...row, bedtime_arrived_at: row.bedtime_start === null ? null : row.judged_at })),
  );
  db.close();
});

/** Every occurrence row, in date order. */
function occurrences(db: ReturnType<typeof openDatabase>): Record<string, unknown>[] {
  return db.prepare("SELECT * FROM occurrence ORDER BY date").all() as Record<string, unknown>[];
}

/**
 * The schema as SQLite reports it: occurrence's columns, foreign keys and indexes
 * (whose definitions change with its CHECK), and every other table, index,
 * trigger and view by its text.
 */
function shape(db: ReturnType<typeof openDatabase>): unknown {
  const indexes = db.pragma("index_list(occurrence)") as { name: string }[];
  return {
    columns: db.pragma("table_info(occurrence)"),
    foreignKeys: db.pragma("foreign_key_list(occurrence)"),
    indexes: indexes.map((index) => ({ ...index, columns: db.pragma(`index_info(${index.name})`) })),
    rest: db
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name NOT IN ('occurrence', 'schema_migration') ORDER BY name",
      )
      .all(),
  };
}
