// The Anki adapter at its boundary: what it asks the Python script, and what
// it makes of the answers. A fake runner answers for the script; nothing
// runs Python or reaches AnkiWeb. Host keys go in the scenario's real database.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { ankiAdapter, devAnki, type AnkiScriptRequest, type AnkiScriptRunner } from "./anki.ts";
import { openWithPragmas } from "./db.ts";
import { OperatorAlerted } from "./ports.ts";
import { scenario, type Scenario } from "./testing/scenario.ts";

const TOKEN_KEY = Buffer.alloc(32, 9).toString("base64");
const DECKS = [{ id: "1", name: "Spanish", parentId: null, counts: { new: 1, learn: 0, review: 2 } }];

/** Plays the script: answers each request with `answer`'s result, recording what it was asked. */
function fakeScript(answer: (request: AnkiScriptRequest) => unknown | Promise<unknown>) {
  const requests: AnkiScriptRequest[] = [];
  const run: AnkiScriptRunner = async (request) => {
    requests.push(structuredClone(request));
    return answer(request);
  };
  return { requests, run };
}

/** The adapter on the scenario's database, answered by `run`; it closes when the test ends. */
function adapterFor(s: Scenario, run: AnkiScriptRunner) {
  const collectionsDir = join(s.dbPath, "..", "anki");
  const adapter = ankiAdapter(s.dbPath, { tokenKey: TOKEN_KEY, collectionsDir }, s.clock, {
    run,
    log: (line) => s.logs.push(line),
    raiseOperatorAlert: s.operatorAlerts.raise,
  });
  onTestFinished(() => adapter.close());
  return { adapter, collectionsDir };
}

function okLogin(request: AnkiScriptRequest) {
  if (request.op === "login") {
    return request.password === "right"
      ? { ok: true, hostKey: "host-key-1", endpoint: "https://sync.ankiweb.net/" }
      : { ok: false, error: "auth", message: "SyncError: Email or password was incorrect" };
  }
  return null;
}

test("logging in keeps the host key, encrypted, and never the password", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  const script = fakeScript(okLogin);
  const { adapter } = adapterFor(s, script.run);

  expect(await adapter.login(owner.id, "owner@example.test", "wrong")).toEqual({ ok: false, reason: "wrong-login" });
  expect(await adapter.login(owner.id, "owner@example.test", "right")).toEqual({ ok: true });
  expect(script.requests[1]).toEqual({ op: "login", username: "owner@example.test", password: "right" });

  const db = openWithPragmas(s.dbPath);
  const rows = db.prepare("SELECT * FROM anki_connection").all() as Record<string, unknown>[];
  db.close();
  expect(rows).toHaveLength(1);
  const stored = JSON.stringify(rows);
  expect(stored).not.toContain("host-key-1");
  expect(stored).not.toContain("right");
});

test("a login AnkiWeb can't answer is unreachable", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  const { adapter } = adapterFor(
    s,
    fakeScript(() => ({ ok: false, error: "network", message: "NetworkError: timed out" })).run,
  );
  expect(await adapter.login(owner.id, "owner@example.test", "right")).toEqual({ ok: false, reason: "unreachable" });
});

test("a login that fails is logged; a protocol error also alerts the operator", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  let answer: () => unknown = () => ({ ok: false, error: "network", message: "NetworkError: timed out" });
  const { adapter } = adapterFor(s, fakeScript(() => answer()).run);

  expect(await adapter.login(owner.id, "owner@example.test", "right")).toEqual({ ok: false, reason: "unreachable" });
  expect(s.logs).toEqual([expect.stringMatching(/^AnkiWeb login failed for account .*NetworkError: timed out/)]);

  s.logs.length = 0;
  answer = () => ({ ok: false, error: "protocol", message: "SyncError: client too old" });
  expect(await adapter.login(owner.id, "owner@example.test", "right")).toEqual({ ok: false, reason: "unreachable" });
  expect(s.logs).toEqual([expect.stringMatching(/^OPERATOR_ALERT AnkiWeb protocol error.*client too old/)]);

  s.logs.length = 0;
  answer = () => {
    throw new Error("the Anki script failed: python3 not found");
  };
  expect(await adapter.login(owner.id, "owner@example.test", "right")).toEqual({ ok: false, reason: "unreachable" });
  expect(s.logs).toEqual([expect.stringMatching(/^AnkiWeb login failed for account .*python3 not found/)]);
});

test("decks and counts send the host key and the account's own copy, follow a new endpoint, and name each deck", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  const script = fakeScript(
    (request) =>
      okLogin(request) ??
      (request.op === "decks"
        ? { ok: true, decks: DECKS, rolloverHour: 4, endpoint: "https://sync2.ankiweb.net/" }
        : {
            ok: true,
            ankiDate: "2026-01-06",
            asOf: Date.parse("2026-01-07T02:05:00Z"),
            decks: { "1": { new: 0, learn: 0, review: 0 }, "2": null },
            names: { "1": "Languages::Spanish" },
            endpoint: "https://sync2.ankiweb.net/",
          }),
  );
  const { adapter, collectionsDir } = adapterFor(s, script.run);
  expect(await adapter.decks(owner.id)).toEqual({ ok: false, reason: "disconnected" });
  await adapter.login(owner.id, "owner@example.test", "right");

  expect(await adapter.decks(owner.id)).toEqual({ ok: true, decks: DECKS, rolloverHour: 4 });
  expect(await adapter.deckCounts(owner.id, ["1", "2"])).toEqual({
    ok: true,
    ankiDate: "2026-01-06",
    asOf: new Date("2026-01-07T02:05:00Z"),
    decks: { "1": { new: 0, learn: 0, review: 0 }, "2": null },
    names: { "1": "Languages::Spanish" },
  });
  const collection = join(collectionsDir, `${owner.id}.anki2`);
  expect(script.requests.slice(1)).toEqual([
    { op: "decks", hostKey: "host-key-1", endpoint: "https://sync.ankiweb.net/", collection },
    { op: "counts", hostKey: "host-key-1", endpoint: "https://sync2.ankiweb.net/", collection, deckIds: ["1", "2"] },
  ]);
});

test("each decks and counts check logs one anki-fetch line: whether it downloaded and why, the sizes and the times", async () => {
  // The operator reads these to see how often Pact downloads the whole
  // collection. No host key, deck name or card content goes in the line.
  const s = scenario();
  const owner = await s.signIn("owner");
  const reuse = { action: "reuse", required: 0, checkSeconds: 0.4321 };
  const download = {
    action: "download",
    reason: "no-copy",
    required: 2,
    downloadedBytes: 52_428_800,
    prunedBytes: 31_457_280,
    checkSeconds: 0.25,
    downloadSeconds: 6.1,
    pruneSeconds: 2.004,
  };
  const { adapter } = adapterFor(
    s,
    fakeScript(
      (request) =>
        okLogin(request) ??
        (request.op === "decks"
          ? { ok: true, decks: DECKS, rolloverHour: 4, endpoint: null, fetch: reuse }
          : {
              ok: true,
              ankiDate: "2026-01-06",
              asOf: 0,
              decks: { "1": null },
              names: {},
              endpoint: null,
              fetch: download,
            }),
    ).run,
  );
  await adapter.login(owner.id, "owner@example.test", "right");

  await adapter.decks(owner.id);
  await adapter.deckCounts(owner.id, ["1"]);

  expect(s.logs).toEqual([
    `anki-fetch op:decks account:${owner.id} fetch:reuse required:0 checkSeconds:0.43`,
    `anki-fetch op:counts account:${owner.id} fetch:download reason:no-copy required:2 downloadedBytes:52428800 ` +
      `prunedBytes:31457280 checkSeconds:0.25 downloadSeconds:6.10 pruneSeconds:2.00`,
  ]);
  expect(s.logs.join("\n")).toMatch(/^[A-Za-z0-9_ .:\n-]+$/);
});

test("an auth error is disconnected; a network error throws; a protocol error throws and alerts the operator", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  let answer: unknown = { ok: false, error: "auth", message: "SyncError: auth" };
  const { adapter } = adapterFor(s, fakeScript((request) => okLogin(request) ?? answer).run);
  await adapter.login(owner.id, "owner@example.test", "right");

  expect(await adapter.deckCounts(owner.id, ["1"])).toEqual({ ok: false, reason: "disconnected" });
  answer = { ok: false, error: "network", message: "NetworkError: 503" };
  await expect(adapter.deckCounts(owner.id, ["1"])).rejects.toThrow("NetworkError: 503");
  await expect(adapter.deckCounts(owner.id, ["1"])).rejects.not.toBeInstanceOf(OperatorAlerted);
  expect(s.logs.filter((line) => line.startsWith("OPERATOR_ALERT"))).toEqual([]);
  answer = { ok: false, error: "protocol", message: "DecodeError: unexpected field" };
  // Already the operator's to fix: a check now doesn't tell the owner AnkiWeb was out of reach.
  await expect(adapter.deckCounts(owner.id, ["1"])).rejects.toThrow(OperatorAlerted);
  expect(s.logs).toEqual([expect.stringMatching(/^OPERATOR_ALERT AnkiWeb protocol error.*DecodeError/)]);
  expect(s.mailer.sent).toEqual([
    {
      to: s.operatorEmail,
      subject: "Pact operator alert: AnkiWeb protocol error",
      text: expect.stringMatching(new RegExp(`^AnkiWeb protocol error for account ${owner.id}: DecodeError`)),
    },
  ]);
  answer = "not json at all";
  await expect(adapter.deckCounts(owner.id, ["1"])).rejects.toThrow();
});

test("a protocol error is logged every time but emailed once per account, until AnkiWeb answers it again", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  const friend = await s.befriend(owner, "friend");
  let answer: unknown = { ok: false, error: "protocol", message: "DecodeError: unexpected field" };
  const { adapter } = adapterFor(s, fakeScript((request) => okLogin(request) ?? answer).run);
  await adapter.login(owner.id, "owner@example.test", "right");
  await adapter.login(friend.id, "friend@example.test", "right");
  const emailedAbout = () =>
    s.mailer.sent.map((email) =>
      email.text.includes(owner.id) ? "owner" : email.text.includes(friend.id) ? "friend" : "?",
    );

  for (let check = 0; check < 3; check++) await expect(adapter.deckCounts(owner.id, ["1"])).rejects.toThrow();
  await expect(adapter.deckCounts(friend.id, ["1"])).rejects.toThrow();

  expect(s.logs.filter((line) => line.startsWith("OPERATOR_ALERT"))).toHaveLength(4);
  expect(emailedAbout()).toEqual(["owner", "friend"]);

  answer = { ok: true, decks: DECKS, rolloverHour: 4, endpoint: null };
  await adapter.decks(owner.id);
  answer = { ok: false, error: "protocol", message: "DecodeError: unexpected field" };
  await expect(adapter.deckCounts(owner.id, ["1"])).rejects.toThrow();
  await expect(adapter.deckCounts(friend.id, ["1"])).rejects.toThrow();

  expect(s.logs.filter((line) => line.startsWith("OPERATOR_ALERT"))).toHaveLength(6);
  expect(emailedAbout()).toEqual(["owner", "friend", "owner"]);
});

test("a warning from the script alerts the operator, emailed once per account, and the counts still come back", async () => {
  // The script put the copy's change stamp back after pruning: the counts are
  // right, but the pinned anki package changed how it treats the copy.
  const s = scenario();
  const owner = await s.signIn("owner");
  const warning =
    "pruning moved the copy's change stamp (mod, scm, usn, ls) from [1, 2, 3, 1] to [9, 2, 3, 1]; it was put back";
  const counts = {
    ok: true,
    ankiDate: "2026-01-06",
    asOf: Date.parse("2026-01-07T02:05:00Z"),
    decks: { "1": { new: 0, learn: 0, review: 3 } },
    names: { "1": "Spanish" },
    endpoint: null,
    warning,
  };
  const { adapter } = adapterFor(s, fakeScript((request) => okLogin(request) ?? counts).run);
  await adapter.login(owner.id, "owner@example.test", "right");

  for (let check = 0; check < 2; check++) {
    expect(await adapter.deckCounts(owner.id, ["1"])).toEqual({
      ok: true,
      ankiDate: "2026-01-06",
      asOf: new Date("2026-01-07T02:05:00Z"),
      decks: { "1": { new: 0, learn: 0, review: 3 } },
      names: { "1": "Spanish" },
    });
  }
  expect(s.logs).toEqual([
    expect.stringMatching(/^OPERATOR_ALERT Anki check warning.*change stamp.*put back/),
    expect.stringMatching(/^OPERATOR_ALERT Anki check warning/),
  ]);
  expect(s.mailer.sent).toEqual([
    {
      to: s.operatorEmail,
      subject: "Pact operator alert: Anki check warning",
      text: expect.stringContaining(`Anki check warning for account ${owner.id}: ${warning}`),
    },
  ]);
});

test("an answer that isn't one is a login AnkiWeb can't answer; a success without a host key throws", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  let answer: unknown = "not json at all";
  const { adapter } = adapterFor(s, fakeScript(() => answer).run);

  expect(await adapter.login(owner.id, "owner@example.test", "right")).toEqual({ ok: false, reason: "unreachable" });
  expect(s.logs).toEqual([`AnkiWeb login failed for account ${owner.id}: the Anki script's answer wasn't one`]);
  answer = { ok: true, endpoint: null };
  await expect(adapter.login(owner.id, "owner@example.test", "right")).rejects.toThrow(
    "AnkiWeb login answered without a host key",
  );
  expect(s.logs).toHaveLength(1);
  const db = openWithPragmas(s.dbPath);
  expect(db.prepare("SELECT * FROM anki_connection").all()).toEqual([]);
  db.close();
});

test("decks or counts that say they succeeded without them throw, and keep the endpoint as it was", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  const moved = "https://sync2.ankiweb.net/";
  const script = fakeScript(
    (request) =>
      okLogin(request) ??
      (request.op === "decks" ? { ok: true, decks: DECKS, endpoint: moved } : { ok: true, endpoint: moved }),
  );
  const { adapter } = adapterFor(s, script.run);
  await adapter.login(owner.id, "owner@example.test", "right");

  await expect(adapter.decks(owner.id)).rejects.toThrow("AnkiWeb deck list answered without decks");
  await expect(adapter.deckCounts(owner.id, ["1"])).rejects.toThrow("AnkiWeb counts answered without counts");
  expect(script.requests.slice(1).map((request) => "endpoint" in request && request.endpoint)).toEqual([
    "https://sync.ankiweb.net/",
    "https://sync.ankiweb.net/",
  ]);
});

test("one check runs at a time per account", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  const started: AnkiScriptRequest["op"][] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const { adapter } = adapterFor(
    s,
    fakeScript(async (request) => {
      if (request.op === "login") return okLogin(request);
      started.push(request.op);
      // The first check waits until the test lets it finish.
      if (started.length === 1) await held;
      return request.op === "decks"
        ? { ok: true, decks: [], rolloverHour: 4, endpoint: null }
        : { ok: true, ankiDate: "2026-01-06", asOf: 0, decks: {}, endpoint: null };
    }).run,
  );
  await adapter.login(owner.id, "owner@example.test", "right");
  const all = Promise.all([adapter.deckCounts(owner.id, []), adapter.decks(owner.id)]);
  await Promise.resolve();
  await Promise.resolve();
  expect(started).toEqual(["counts"]);
  release();
  await all;
  expect(started).toEqual(["counts", "decks"]);
});

test("forgetting deletes the host key and the collection copy", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  const { adapter, collectionsDir } = adapterFor(s, fakeScript(okLogin).run);
  await adapter.login(owner.id, "owner@example.test", "right");
  mkdirSync(collectionsDir, { recursive: true });
  const copy = join(collectionsDir, `${owner.id}.anki2`);
  writeFileSync(copy, "collection");
  writeFileSync(`${copy}-wal`, "wal");

  await adapter.forget(owner.id);

  expect(existsSync(copy)).toBe(false);
  expect(existsSync(`${copy}-wal`)).toBe(false);
  expect(await adapter.decks(owner.id)).toEqual({ ok: false, reason: "disconnected" });
});

test("forgetting waits for a check already running, so its download can't bring the copy back", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let started = () => {};
  const checkStarted = new Promise<void>((resolve) => (started = resolve));
  const { adapter } = adapterFor(
    s,
    fakeScript(async (request) => {
      if (request.op === "login") return okLogin(request);
      if (request.op !== "counts") throw new Error(`unexpected ${request.op}`);
      started();
      await held;
      // The download finishes after the disconnect: the copy is written now.
      mkdirSync(join(request.collection, ".."), { recursive: true });
      writeFileSync(request.collection, "collection");
      return { ok: true, ankiDate: "2026-01-06", asOf: 0, decks: {}, endpoint: null };
    }).run,
  );
  await adapter.login(owner.id, "owner@example.test", "right");
  const check = adapter.deckCounts(owner.id, ["1"]);
  await checkStarted;

  const forgotten = adapter.forget(owner.id);
  release();
  await Promise.all([check, forgotten]);

  expect(existsSync(join(s.dbPath, "..", "anki", `${owner.id}.anki2`))).toBe(false);
  expect(await adapter.decks(owner.id)).toEqual({ ok: false, reason: "disconnected" });
});

test("the dev stand-in reads decks from a file, and refuses the password 'wrong'", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  const dir = join(s.dbPath, "..");
  const dev = devAnki(dir, s.clock);
  expect(await dev.login(owner.id, "me@example.test", "wrong")).toEqual({ ok: false, reason: "wrong-login" });
  expect(await dev.login(owner.id, "me@example.test", "anything")).toEqual({ ok: true });
  expect(await dev.decks(owner.id)).toEqual({ ok: true, decks: [], rolloverHour: 4 });

  writeFileSync(
    join(dir, "anki-decks.json"),
    JSON.stringify({ rolloverHour: 3, timezone: "America/New_York", decks: DECKS }),
  );
  expect(await dev.decks(owner.id)).toEqual({ ok: true, decks: DECKS, rolloverHour: 3 });
  // Mon 09:00 in New York, the scenario's start: Monday's Anki day.
  expect(await dev.deckCounts(owner.id, ["1", "9"])).toEqual({
    ok: true,
    ankiDate: s.date("Mon"),
    asOf: s.at("Mon 09:00"),
    decks: { "1": DECKS[0]!.counts, "9": null },
    names: { "1": "Spanish" },
  });
});

test("the dev stand-in answers 'disconnected' while its file says AnkiWeb refuses the login", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  const dir = join(s.dbPath, "..");
  const dev = devAnki(dir, s.clock);
  writeFileSync(join(dir, "anki-decks.json"), JSON.stringify({ refused: true, decks: DECKS }));
  expect(await dev.decks(owner.id)).toEqual({ ok: false, reason: "disconnected" });
  expect(await dev.deckCounts(owner.id, ["1"])).toEqual({ ok: false, reason: "disconnected" });
});
