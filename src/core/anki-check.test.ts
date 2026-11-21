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
 * prints the calls as JSON, and the script's own failure answer if it raised.
 */
const DRIVER = `
import importlib.util, json, sys

spec = importlib.util.spec_from_file_location("anki_check", sys.argv[1])
anki_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(anki_check)
given = json.load(sys.stdin)
calls = []

class Status:
    required = given["required"]
    new_endpoint = given["newEndpoint"] or ""

class Auth:
    endpoint = None

# The col row's change stamp: mod, usn, ls.
stamp = [1700000000000, 42, 1700000000000]

class DB:
    """Anki's connection, open only while the collection is: records writes, answers stamp reads."""
    def first(self, sql, *args):
        assert sql.startswith("select"), sql
        return list(stamp)
    def execute(self, sql, *args):
        calls.append(["execute", sql, *args])

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
    def reopen(self, after_full_sync):
        calls.append(["reopen", after_full_sync])
        self.db = DB()
    def optimize(self):
        calls.append(["optimize"])
        if given["optimizeBumpsMod"]:
            stamp[0] += 1

auth = Auth()
try:
    anki_check.fresh_copy(Collection, given["collection"], auth)
    failure = None
except Exception as error:
    failure = anki_check.failure(error)
json.dump({"calls": calls, "endpoint": auth.endpoint, "failure": failure}, sys.stdout)
`;

/** The prune `fresh_copy` runs after each download: note content blanked, revlog kept, then a vacuum. */
const PRUNE = [["execute", "update notes set flds = '', sfld = '', csum = 0"], ["optimize"]];

// Anki's sync status values (SyncStatus.Required).
const NO_CHANGES = 0;
const FULL_SYNC = 2;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pact-anki-check-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function freshCopy(given: { copy: boolean; required: number; newEndpoint: string | null; optimizeBumpsMod?: boolean }) {
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
      optimizeBumpsMod: given.optimizeBumpsMod ?? false,
    }),
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`python3 failed: ${run.error?.message ?? run.stderr}`);
  return JSON.parse(run.stdout) as {
    calls: unknown[][];
    endpoint: string | null;
    failure: { ok: false; error: string; message: string } | null;
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
    failure: null,
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
    failure: null,
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

test("after each download it blanks the notes' content, and keeps the review log", () => {
  // Counting reads cards, decks, deck options, config and today's review log,
  // never note content, so the stored copy keeps none of the owner's card
  // text. The review log stays: daily limits read today's answers.
  const { calls, failure } = freshCopy({ copy: true, required: FULL_SYNC, newEndpoint: null });
  expect(failure).toBeNull();
  expect(calls.slice(calls.findIndex((call) => call[0] === "reopen"))).toEqual([["reopen", true], ...PRUNE]);
});

test("a copy kept because nothing changed isn't pruned again", () => {
  // A copy downloaded before pruning existed is pruned at its next download.
  expect(freshCopy({ copy: true, required: NO_CHANGES, newEndpoint: null }).calls).not.toContainEqual(PRUNE[0]);
});

test("a prune that changes the collection's change stamp fails the check as a protocol error", () => {
  // A stamp that no longer matches AnkiWeb's means a full download at every
  // check, so it must not pass quietly: the pinned anki package has changed
  // how it treats Pact's own writes.
  const { calls, failure } = freshCopy({ copy: false, required: FULL_SYNC, newEndpoint: null, optimizeBumpsMod: true });
  expect(calls).toContainEqual(["optimize"]);
  expect(failure).toEqual({ ok: false, error: "protocol", message: expect.stringContaining("change stamp") });
});

test("the script has one way to AnkiWeb's full sync, and it only downloads", () => {
  // The stored copy is pruned: uploading it would replace the owner's notes
  // on AnkiWeb, and every device, with blank ones.
  const script = readFileSync(SCRIPT, "utf8");
  expect(script.match(/\.full_upload_or_download\(/g)).toHaveLength(1);
  expect(script).toMatch(/\.full_upload_or_download\(auth=auth, server_usn=None, upload=False\)/);
  expect(script).not.toMatch(/\.(sync_collection|full_upload|full_download)\(/);
});
