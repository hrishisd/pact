// anki_check.py's own rules about what it asks AnkiWeb, and in what order.
// Python runs the script's `fresh_copy` with a stand-in for Anki's
// Collection that records each call, so neither the anki package nor
// AnkiWeb is needed: only python3.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Each test starts Python, which a loaded CI runner can make slow.
vi.setConfig({ testTimeout: 30_000 });

const SCRIPT = join(import.meta.dirname, "anki_check.py");

/** Loads the script by path and runs `fresh_copy` with a recording Collection; prints the calls as JSON. */
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

class Collection:
    def __init__(self, path, server):
        calls.append(["open", server])
        open(path, "a").close()
    def sync_status(self, auth):
        calls.append(["sync_status", auth.endpoint])
        return Status()
    def close_for_full_sync(self):
        calls.append(["close_for_full_sync"])
    def full_upload_or_download(self, *, auth, server_usn, upload):
        calls.append(["download", auth.endpoint, server_usn, upload])
    def reopen(self, after_full_sync):
        calls.append(["reopen", after_full_sync])

auth = Auth()
anki_check.fresh_copy(Collection, given["collection"], auth)
json.dump({"calls": calls, "endpoint": auth.endpoint}, sys.stdout)
`;

// Anki's sync status values (SyncStatus.Required).
const NO_CHANGES = 0;
const FULL_SYNC = 2;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pact-anki-check-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function freshCopy(given: { copy: boolean; required: number; newEndpoint: string | null }) {
  const collection = join(dir, "collections", "owner.anki2");
  if (given.copy) {
    mkdirSync(join(dir, "collections"), { recursive: true });
    writeFileSync(collection, "");
  }
  // -B: loading the script must leave no __pycache__ beside it.
  const run = spawnSync("python3", ["-I", "-B", "-c", DRIVER, SCRIPT], {
    input: JSON.stringify({ collection, required: given.required, newEndpoint: given.newEndpoint }),
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`python3 failed: ${run.error?.message ?? run.stderr}`);
  return JSON.parse(run.stdout) as { calls: unknown[][]; endpoint: string | null };
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
    ],
    endpoint: "https://sync7.ankiweb.net/",
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
  ]);
});

test("with a copy, it downloads only when the change check says something changed, from the endpoint named", () => {
  expect(freshCopy({ copy: true, required: NO_CHANGES, newEndpoint: "https://sync7.ankiweb.net/" })).toEqual({
    calls: [
      ["open", true],
      ["sync_status", null],
    ],
    endpoint: "https://sync7.ankiweb.net/",
  });
  expect(freshCopy({ copy: true, required: FULL_SYNC, newEndpoint: null }).calls).toEqual([
    ["open", true],
    ["sync_status", null],
    ["close_for_full_sync"],
    ["download", null, null, false],
    ["reopen", true],
  ]);
});
