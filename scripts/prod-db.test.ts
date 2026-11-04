// scripts/prod-db.sh against a real database made by the app's own migrations.
// A fake `fly` runs the -C command here, with the machine's /app and
// /data/pact.db swapped for this repo and a temporary file. PATH leaves out
// wherever a real `fly` is installed, so this can't reach production.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { openDatabase, type Db } from "../src/core/db.ts";
import { migrations } from "../src/core/migrations.ts";

// Each test starts bash and node (about 1 s alone, 2 s or more on a loaded
// machine), so the 5 s default would fail a busy CI runner, not a bug.
vi.setConfig({ testTimeout: 30_000 });

const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "prod-db.sh");

const FAKE_FLY = `#!/bin/sh
[ "$1 $2 $3 $4 $5" = "ssh console -a pact-hrishisd -C" ] || { echo "unexpected fly arguments: $*" >&2; exit 99; }
printf '%s' "$6" > "$FAKE_FLY_DIR/command"
# The paths go in as quoted variables the inner sh expands, so a space or a
# sed metacharacter in the checkout or temp path can't change the command.
exec sh -c "$(printf '%s' "$6" | sed -e 's#cd /app #cd "$REPO_ROOT" #' -e 's#/data/pact.db#"$PACT_DB"#')"
`;

let dir: string;
let path: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pact-prod-db-"));
  path = join(dir, "pact.db");
  writeFileSync(join(dir, "fly"), FAKE_FLY);
  chmodSync(join(dir, "fly"), 0o755);
  // Left open, like the running app's connection on the machine.
  db = openDatabase(path);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function prodDb(...args: string[]) {
  return spawnSync(SCRIPT, args, {
    encoding: "utf8",
    env: {
      PATH: [dir, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      FAKE_FLY_DIR: dir,
      REPO_ROOT,
      PACT_DB: path,
    },
  });
}

function seed(): void {
  const at = "2026-01-01T00:00:00Z";
  db.exec(`
    INSERT INTO account (id, email, email_key, name, timezone, created_at)
      VALUES ('owner', 'owner@example.test', 'owner@example.test', 'Owner', 'America/New_York', '${at}');
    INSERT INTO recipient (id, owner_account_id, name, created_at) VALUES ('sam', 'owner', 'Sam', '${at}');
  `);
  const pact = db.prepare(`
    INSERT INTO pact (id, owner_account_id, name, description, evidence_kind, schedule, penalty_cents,
                      recipient_id, stage, first_occurrence, created_at, judged_through)
      VALUES (?, 'owner', 'Gym', 'A photo of Gym', 'camera', '{"kind":"fixed-days","days":["mon"]}', 500,
              'sam', 'active', '2026-01-05', '${at}', ?)
  `);
  pact.run("a", "2026-01-05");
  pact.run("b", "2026-01-05");
  pact.run("c", "2026-01-12");
  pact.run("d", null);
  const occurrence = db.prepare(`
    INSERT INTO occurrence (pact_id, date, outcome, judged_at) VALUES (?, '2026-01-05', 'missed', '${at}')
  `);
  const penalty = db.prepare(`
    INSERT INTO penalty (id, owner_account_id, recipient_id, pact_id, occurrence_date, amount_cents, added_at)
      VALUES (?, 'owner', 'sam', ?, '2026-01-05', ?, '${at}')
  `);
  occurrence.run("a");
  penalty.run("p1", "a", 500);
  occurrence.run("b");
  penalty.run("p2", "b", 250);
}

test("schema-version reports how many migrations have run", () => {
  const result = prodDb("schema-version");

  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(`user_version=${migrations.length}\n`);
});

test("penalty-totals and pact-cursors print only the aggregates", () => {
  seed();

  expect(prodDb("penalty-totals").stdout).toBe("penalties=2 amount_cents=750\n");
  expect(prodDb("pact-cursors").stdout).toBe(
    "judged_through=2026-01-05 pacts=2\njudged_through=2026-01-12 pacts=1\njudged_through=NULL pacts=1\n",
  );
});

test("on an empty database the totals are zero, not blank", () => {
  expect(prodDb("penalty-totals").stdout).toBe("penalties=0 amount_cents=0\n");
  expect(prodDb("pact-cursors").stdout).toBe("judged_through=NULL pacts=0\n");
});

test.each(["schema-version", "penalty-totals", "pact-cursors"])(
  "the connection %s opens refuses a write, and a pragma write",
  (query) => {
    seed();
    expect(prodDb(query).status).toBe(0);
    const command = readFileSync(join(dir, "command"), "utf8");
    const program = Buffer.from(/echo (\S+) \|/.exec(command)![1]!, "base64").toString();

    // The script's own program, with a write added where a query's bug would be.
    for (const write of [`db.exec("DELETE FROM penalty");`, `db.pragma("user_version = 99");`]) {
      const result = spawnSync(process.execPath, ["-", path], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { PATH: dirname(process.execPath) },
        input: `${program}\n${write}\n`,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("SQLITE_READONLY");
    }

    expect(db.prepare("SELECT COUNT(*) AS n FROM penalty").get()).toEqual({ n: 2 });
    expect(db.pragma("user_version", { simple: true })).toBe(migrations.length);
  },
);

test("a missing database fails, and isn't created", () => {
  db.close();
  rmSync(path);

  const result = prodDb("schema-version");

  expect(result.status).not.toBe(0);
  // Failing for this reason, not because the fake fly or cd broke first.
  expect(result.stderr).toContain("SQLITE_CANTOPEN");
  expect(existsSync(path)).toBe(false);
  db = openDatabase(path); // for afterEach
});

test.each([
  ["an unknown query", ["accounts"]],
  ["no query", []],
  ["SQL as the query", ["SELECT * FROM account"]],
  ["an extra argument", ["schema-version", "extra"]],
])("%s exits non-zero with usage, and never reaches fly", (_, args) => {
  const result = prodDb(...args);

  expect(result.status).toBe(2);
  expect(result.stderr).toContain("scripts/prod-db.sh schema-version");
  expect(result.stderr).toContain("scripts/prod-db.sh pact-cursors");
  expect(existsSync(join(dir, "command"))).toBe(false);
});
