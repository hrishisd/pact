// Migrations that change data, tested on a database made at the version
// before them. Migration 5 reads SQLite's clock, so this runs at the real
// date and asserts only what holds whatever that is.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { systemClock } from "./adapters.ts";
import { localDateOf } from "./calendar.ts";
import { createPactCore } from "./core.ts";
import { openDatabase } from "./db.ts";
import { migrations } from "./migrations.ts";
import { FakeOuraSource, InMemoryPhotoStore, RecordingNotifier } from "./testing/fakes.ts";

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pact-migrations-"));
  path = join(dir, "pact.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const DAY_MS = 24 * 60 * 60 * 1000;

test("migration 5: a pact made before judging existed gets no penalty for any occurrence due before the migration ran", async () => {
  // At migration 4: a daily pact whose first occurrence was years ago, never judged.
  const before = openDatabase(path, migrations.slice(0, 4));
  before.exec(`
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
  before.close();
  const migratedAt = systemClock.now();

  // The release with judging boots: the rest of the migrations run, then the first tick.
  const core = createPactCore({
    dbPath: path,
    clock: systemClock,
    notifier: new RecordingNotifier(),
    ouraSource: new FakeOuraSource(),
    photoStore: new InMemoryPhotoStore(systemClock),
    operatorEmail: "owner@example.test",
    log: () => {},
  });
  const owner = core.as("owner");
  await core.advanceTo(migratedAt);

  expect(owner.ledgers()).toEqual([expect.objectContaining({ name: "Sam", owedCents: 0 })]);

  // Judging carries on from there: days after the migration's UTC date are judged.
  await core.advanceTo(new Date(migratedAt.getTime() + 3 * DAY_MS));
  const ledger = owner.ledger("sam");
  if (!ledger.ok) throw new Error(ledger.reason);
  expect(ledger.ledger.history.length).toBeGreaterThan(0);
  const migratedOn = localDateOf(migratedAt, "UTC");
  for (const entry of ledger.ledger.history)
    expect(entry.kind === "penalty" && entry.occurrenceDate > migratedOn).toBe(true);
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

  const core = createPactCore({
    dbPath: path,
    clock: systemClock,
    notifier: new RecordingNotifier(),
    ouraSource: new FakeOuraSource(),
    photoStore: new InMemoryPhotoStore(systemClock),
    operatorEmail: "owner@example.test",
    log: () => {},
  });

  expect(core.as("owner").today().waiting).toEqual([
    expect.objectContaining({ kind: "evidence", id: "tuesday", occurrenceDate: "2026-01-06" }),
  ]);
  expect(core.as("reviewer").reviewQueue()).toEqual([
    expect.objectContaining({ kind: "evidence", id: "tuesday", occurrenceDate: "2026-01-06" }),
  ]);
  await core.close();
});
