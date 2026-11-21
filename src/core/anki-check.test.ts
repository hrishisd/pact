// anki_check.py's own rules about what it asks AnkiWeb, in what order, and
// what it keeps of the download. Python runs the script's `fresh_copy` with a
// stand-in for Anki's Collection that records each call, so neither the anki
// package nor AnkiWeb is needed: only python3.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Each test starts Python, which a loaded CI runner can make slow.
vi.setConfig({ testTimeout: 30_000 });

const SCRIPT = join(import.meta.dirname, "anki_check.py");

/**
 * Loads the script by path and runs `fresh_copy` with a recording Collection;
 * prints the calls as JSON, the warning it returned or its own failure answer
 * if it raised, and the change stamp left on disk.
 */
const DRIVER = `
import importlib.util, json, sqlite3, sys

spec = importlib.util.spec_from_file_location("anki_check", sys.argv[1])
anki_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(anki_check)
given = json.load(sys.stdin)
path = given["collection"]
calls = []

def sql(statement, *args):
    """The stand-in keeps the col row in the file itself, so the script's plain sqlite3 sees it."""
    db = sqlite3.connect(path)
    with db:
        rows = db.execute(statement, args).fetchall()
    db.close()
    return rows

def move_mod():
    sql("update col set mod = mod + 1")

class Status:
    required = given["required"]
    new_endpoint = given["newEndpoint"] or ""

class Auth:
    endpoint = None

class DB:
    """Anki's connection: records writes, and reads the col row from the file."""
    def first(self, statement, *args):
        assert statement.startswith("select"), statement
        return list(sql(statement, *args)[0])
    def execute(self, statement, *args):
        calls.append(["execute", statement, *args])

class Collection:
    def __init__(self, path, server):
        calls.append(["open", server])
        open(path, "a").close()
        self.db = DB()
    def sync_status(self, auth):
        calls.append(["sync_status", auth.endpoint])
        return Status()
    def close_for_full_sync(self):
        calls.append(["close_for_full_sync"])
        self.db = None
    def full_upload_or_download(self, *, auth, server_usn, upload):
        calls.append(["download", auth.endpoint, server_usn, upload])
        sql("create table col (mod, scm, usn, ls)")
        sql("insert into col values (?, ?, ?, ?)", *given["downloaded"])
    def reopen(self, after_full_sync=False):
        calls.append(["reopen", after_full_sync])
        self.db = DB()
    def optimize(self):
        calls.append(["optimize"])
        if given["moves"] == "optimize":
            move_mod()
        if given["moves"] == "fails":
            raise RuntimeError("disk full")
    def close(self, downgrade):
        # As Anki's: nothing once the connection is closed.
        if self.db is None:
            return
        calls.append(["close", downgrade])
        self.db = None
        if given["moves"] == "close":
            move_mod()

auth = Auth()
warning = failure = None
try:
    col, warning = anki_check.fresh_copy(Collection, path, auth)
except Exception as error:
    failure = anki_check.failure(error)
stamp = sql("select mod, scm, usn, ls from col")[0] if given["required"] != 0 else None
json.dump({"calls": calls, "endpoint": auth.endpoint, "warning": warning, "failure": failure, "stamp": stamp}, sys.stdout)
`;

/** The col row's change stamp as downloaded: mod, scm, usn, ls. */
const DOWNLOADED = [1700000000500, 1600000000000, 42, 1700000000500];

/**
 * What `fresh_copy` runs after each download: the note fields blanked, then a
 * vacuum, and the copy closed so the stamp can be checked on disk. The review
 * log stays: `last_answer_today` reads today's answers.
 */
const PRUNE = [
  ["execute", "update notes set flds = '', sfld = '', csum = 0"],
  ["optimize"],
  ["close", false],
  ["reopen", false],
];

// Anki's sync status values (SyncStatus.Required).
const NO_CHANGES = 0;
const FULL_SYNC = 2;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pact-anki-check-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function freshCopy(given: {
  copy: boolean;
  required: number;
  newEndpoint: string | null;
  /** What moves the copy's mod, as a future anki package might, or makes the prune fail. */
  moves?: "optimize" | "close" | "fails";
}) {
  const collection = join(dir, "collections", "owner.anki2");
  if (given.copy) {
    mkdirSync(join(dir, "collections"), { recursive: true });
    writeFileSync(collection, "");
  }
  // -B: loading the script must leave no __pycache__ beside it.
  const run = spawnSync("python3", ["-I", "-B", "-c", DRIVER, SCRIPT], {
    input: JSON.stringify({
      collection,
      required: given.required,
      newEndpoint: given.newEndpoint,
      downloaded: DOWNLOADED,
      moves: given.moves ?? null,
    }),
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`python3 failed: ${run.error?.message ?? run.stderr}`);
  return JSON.parse(run.stdout) as {
    calls: unknown[][];
    endpoint: string | null;
    warning: string | null;
    failure: { ok: false; error: string; message: string } | null;
    stamp: number[] | null;
  };
}

test("with no copy yet, it asks AnkiWeb's change check first and downloads from the endpoint AnkiWeb names", () => {
  // Anki's own clients always ask meta before a download, and only meta
  // follows AnkiWeb's redirect to the account's own endpoint. The first
  // connect in production downloaded without it, from the default endpoint,
  // and AnkiWeb answered with something that isn't a sync answer ("missing
  // original size").
  expect(freshCopy({ copy: false, required: FULL_SYNC, newEndpoint: "https://sync7.ankiweb.net/" })).toEqual({
    calls: [
      ["open", true],
      ["sync_status", null],
      ["close_for_full_sync"],
      ["download", "https://sync7.ankiweb.net/", null, false],
      ["reopen", true],
      ...PRUNE,
    ],
    endpoint: "https://sync7.ankiweb.net/",
    warning: null,
    failure: null,
    stamp: DOWNLOADED,
  });
});

test("with no copy yet, it downloads even when the change check says nothing changed", () => {
  // The new copy holds nothing of the owner's, whatever the check answers.
  expect(freshCopy({ copy: false, required: NO_CHANGES, newEndpoint: null }).calls).toEqual([
    ["open", true],
    ["sync_status", null],
    ["close_for_full_sync"],
    ["download", null, null, false],
    ["reopen", true],
    ...PRUNE,
  ]);
});

test("with a copy, it downloads only when the change check says something changed, from the endpoint named", () => {
  expect(freshCopy({ copy: true, required: NO_CHANGES, newEndpoint: "https://sync7.ankiweb.net/" })).toEqual({
    calls: [
      ["open", true],
      ["sync_status", null],
    ],
    endpoint: "https://sync7.ankiweb.net/",
    warning: null,
    failure: null,
    stamp: null,
  });
  expect(freshCopy({ copy: true, required: FULL_SYNC, newEndpoint: null }).calls).toEqual([
    ["open", true],
    ["sync_status", null],
    ["close_for_full_sync"],
    ["download", null, null, false],
    ["reopen", true],
    ...PRUNE,
  ]);
});

test("a stamp moved by pruning is put back, and the check goes on with a warning", () => {
  // A stamp that no longer matches AnkiWeb's would make every check download
  // again. The counts are still right, so the check succeeds, and the warning
  // tells the operator that the anki package changed how it treats the prune.
  for (const moves of ["optimize", "close"] as const) {
    const { calls, warning, failure, stamp } = freshCopy({ copy: true, required: FULL_SYNC, newEndpoint: null, moves });
    expect(calls.slice(-PRUNE.length)).toEqual(PRUNE);
    expect(failure).toBeNull();
    expect(stamp).toEqual(DOWNLOADED);
    expect(warning).toMatch(/change stamp \(mod, scm, usn, ls\).*put back/);
  }
});

test("a prune that fails closes the collection", () => {
  const { calls, failure } = freshCopy({ copy: true, required: FULL_SYNC, newEndpoint: null, moves: "fails" });
  expect(calls.slice(-2)).toEqual([["optimize"], ["close", false]]);
  expect(failure).toEqual({ ok: false, error: "protocol", message: "RuntimeError: disk full" });
});

test("the script has one way to AnkiWeb's full sync, and it only downloads", () => {
  // The stored copy is pruned: uploading it would replace the owner's notes
  // on AnkiWeb, and every device, with blank ones.
  const script = readFileSync(SCRIPT, "utf8");
  expect(script.match(/\.full_upload_or_download\(/g)).toHaveLength(1);
  expect(script).toMatch(/\.full_upload_or_download\(auth=auth, server_usn=None, upload=False\)/);
  expect(script).not.toMatch(/\.(sync_collection|full_upload|full_download)\(/);
});
