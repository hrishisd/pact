// Apple Health bedtime pacts: the upload key that connects an account, the
// uploads its Pact Health Shortcut posts, and judging each night from the
// sleep sessions they hold, read on the account's timezone. Scenario times
// are New York's, the owner's timezone unless a test says otherwise.

import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { WEEKDAYS, type AppleHealthSampleFields, type Weekday } from "../shared/types.ts";
import { bedtimePact } from "./testing/bedtime-pact.ts";
import { scenario, type AccountHandle, type Scenario } from "./testing/scenario.ts";
import { cards, dayOn, ok, sectionKinds } from "./testing/queries.ts";

/**
 * An owner in `timezone` (New York unless given) with Apple Health connected,
 * a friend "reviewer" and a recipient "Sam". `createPact` makes a $5 Apple
 * Health bedtime pact with Sam that the reviewer reviews: in bed by
 * `inBedBy`, every night unless `days` says otherwise.
 */
async function ownerWithAppleHealth(s: Scenario, timezone = "America/New_York") {
  const owner = await s.signIn("owner");
  await owner.setTimezone(timezone);
  const reviewer = await s.befriend(owner, "reviewer");
  const added = ok(await owner.addRecipient({ name: "Sam" }));
  const { uploadUrl } = await owner.makeAppleHealthKey();
  const createPact = async (inBedBy = "00:00", days: Weekday[] = [...WEEKDAYS]) => {
    const pact = { ...bedtimePact(added.recipient.id, reviewer, inBedBy, days), evidenceKind: "apple_health" as const };
    return ok(await owner.createPact(pact)).pactId;
  };
  return { owner, reviewer, sam: added.recipient, createPact, key: keyOf(uploadUrl) };
}

function keyOf(uploadUrl: string): string {
  return new URL(uploadUrl).searchParams.get("key")!;
}

/**
 * A sleep sample from `start` to `end`: each a scenario time ("Tue 23:40",
 * New York) written as the Shortcut writes it, with New York's offset, or a
 * full ISO 8601 string.
 */
function sleepSample(start: string, end: string, value = "Asleep", source = "Oura"): AppleHealthSampleFields {
  return { type: "sleep", start: isoText(start), end: isoText(end), value, source };
}

/** `when` as ISO 8601 with New York's offset in January: "2026-01-06T23:40:00-05:00". */
function isoText(when: string): string {
  if (/^\d{4}-/.test(when)) return when;
  const instant = new Date(at(when).getTime() - 5 * 60 * 60 * 1000);
  return `${instant.toISOString().slice(0, 19)}-05:00`;
}

let at: (when: string) => Date;

/** A scenario whose times `sleepSample` reads. */
function appleHealthScenario(): Scenario {
  const s = scenario();
  at = s.at;
  return s;
}

/** Uploads `samples`, as the server does with a body it could read entirely. */
function upload(owner: AccountHandle, ...samples: AppleHealthSampleFields[]) {
  return owner.uploadAppleHealth({ samples, unreadableLines: 0 });
}

/** How the night of `date` stands, as an excuse for it would see it. */
function night(owner: AccountHandle, pactId: string, date: string) {
  const preview = ok(owner.excusePreview(pactId, { from: date, to: date }));
  const skipped = preview.preview.skipped[0];
  if (skipped) return skipped.reason;
  return preview.preview.covered[0]!.status.kind;
}

/** The Apple Health samples stored for every account. */
function storedSamples(s: Scenario): number {
  const db = new Database(s.dbPath, { readonly: true });
  try {
    return (db.prepare(`SELECT count(*) AS n FROM apple_health_sample`).get() as { n: number }).n;
  } finally {
    db.close();
  }
}

describe("connecting Apple Health", () => {
  test("making a key connects it: Profile lists it with no upload yet, and the key finds the account", async () => {
    const s = appleHealthScenario();
    const owner = await s.signIn("owner");
    expect(owner.appleHealth()).toEqual({ connected: false, lastUpload: null });

    s.setClockTo("Mon 09:30");
    const { uploadUrl } = await owner.makeAppleHealthKey();

    expect(uploadUrl).toMatch(/^https:\/\/pact\.example\.test\/api\/apple-health\/samples\?key=[\w-]{32}$/);
    expect(owner.appleHealth()).toEqual({ connected: true, lastUpload: null });
    expect(owner.profile().connections).toEqual([
      {
        service: "apple_health",
        status: "connected",
        connectedAt: s.at("Mon 09:30"),
        activePacts: 0,
        lastUpload: null,
      },
    ]);
    expect(s.core.accountIdForUploadKey(keyOf(uploadUrl))).toBe(owner.id);
    expect(s.core.accountIdForUploadKey("")).toBeNull();
    expect(s.core.accountIdForUploadKey("not-a-key")).toBeNull();
  });

  test("a new key replaces the old one, which stops working at once", async () => {
    const s = appleHealthScenario();
    const owner = await s.signIn("owner");
    const first = keyOf((await owner.makeAppleHealthKey()).uploadUrl);
    const second = keyOf((await owner.makeAppleHealthKey()).uploadUrl);

    expect(second).not.toBe(first);
    expect(s.core.accountIdForUploadKey(first)).toBeNull();
    expect(s.core.accountIdForUploadKey(second)).toBe(owner.id);
    expect(owner.profile().connections).toHaveLength(1);
  });

  test("each account's key is its own", async () => {
    const s = appleHealthScenario();
    const owner = await s.signIn("owner");
    const friend = await s.befriend(owner, "friend");
    const ownerKey = keyOf((await owner.makeAppleHealthKey()).uploadUrl);
    const friendKey = keyOf((await friend.makeAppleHealthKey()).uploadUrl);
    expect(s.core.accountIdForUploadKey(ownerKey)).toBe(owner.id);
    expect(s.core.accountIdForUploadKey(friendKey)).toBe(friend.id);
  });

  test("disconnecting deletes the key and keeps the samples and the last upload; its pacts' nights then wait for a new key", async () => {
    const s = appleHealthScenario();
    const { owner, createPact, key } = await ownerWithAppleHealth(s);
    await createPact("00:00");
    s.setClockTo("Tue 08:00");
    await upload(owner, sleepSample("Mon 23:00", "Tue 07:00"));

    await owner.disconnectAppleHealth();

    expect(s.core.accountIdForUploadKey(key)).toBeNull();
    expect(owner.appleHealth()).toEqual({
      connected: false,
      lastUpload: { at: s.at("Tue 08:00"), sleepSamples: 1, mindfulSessions: 0 },
    });
    expect(owner.profile().connections).toEqual([]);
    expect(storedSamples(s)).toBe(1);
    expect(owner.today().alerts).toEqual([{ kind: "connection", service: "apple_health", status: "not-connected" }]);
  });
});

describe("creating an Apple Health pact", () => {
  test("needs the connection", async () => {
    const s = appleHealthScenario();
    const owner = await s.signIn("owner");
    const reviewer = await s.befriend(owner, "reviewer");
    const added = ok(await owner.addRecipient({ name: "Sam" }));
    const pact = { ...bedtimePact(added.recipient.id, reviewer), evidenceKind: "apple_health" as const };

    expect(await owner.createPact(pact)).toEqual({ ok: false, reason: "apple-health-not-connected" });
    await owner.connectOura();
    expect(await owner.createPact(pact)).toEqual({ ok: false, reason: "apple-health-not-connected" });

    await owner.makeAppleHealthKey();
    expect(await owner.createPact(pact)).toMatchObject({ ok: true });
  });

  test("its terms are a bedtime pact's: an in-bed-by time and no description", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("23:30");
    expect(owner.pact(pactId)).toMatchObject({
      ok: true,
      pact: { evidenceKind: "apple_health", description: "", inBedBy: "23:30" },
    });
    expect(owner.profile().connections).toEqual([expect.objectContaining({ service: "apple_health", activePacts: 1 })]);
  });
});

describe("an upload", () => {
  test("keeps the sleep and mindful samples and answers how many it held; other types are left out silently", async () => {
    const s = appleHealthScenario();
    const { owner } = await ownerWithAppleHealth(s);
    s.setClockTo("Tue 09:00");

    const result = await upload(
      owner,
      sleepSample("Mon 23:00", "Tue 02:00", "Core"),
      sleepSample("Tue 02:00", "Tue 06:30", "Deep"),
      { type: "Mindful", start: isoText("Mon 12:00"), end: isoText("Mon 12:10"), value: "", source: "Calm" },
      { type: "steps", start: isoText("Mon 12:00"), end: isoText("Mon 12:10"), value: "300", source: "iPhone" },
    );

    expect(result).toEqual({ sleepSamples: 2, mindfulSessions: 1, skippedLines: 0 });
    expect(owner.appleHealth()).toEqual({
      connected: true,
      lastUpload: { at: s.at("Tue 09:00"), sleepSamples: 2, mindfulSessions: 1 },
    });
    expect(storedSamples(s)).toBe(3);
  });

  test("a sample whose dates it can't read, or that ends before it starts, is skipped and counted with the lines the server couldn't read", async () => {
    const s = appleHealthScenario();
    const { owner } = await ownerWithAppleHealth(s);
    s.setClockTo("Tue 09:00");

    const result = await owner.uploadAppleHealth({
      samples: [
        { type: "sleep", start: "yesterday", end: "today", value: "Asleep", source: "Oura" },
        sleepSample("2026-01-06T07:00:00", "2026-01-06T08:00:00"),
        sleepSample("Tue 07:00", "Tue 06:00"),
        // Shortcuts may write the offset without a colon, or as Z.
        sleepSample("2026-01-05T23:00:00-0500", "2026-01-06T04:00:00Z"),
      ],
      unreadableLines: 2,
    });

    expect(result).toEqual({ sleepSamples: 1, mindfulSessions: 0, skippedLines: 5 });
  });

  test("a sample that ended more than 14 days before it, or starts after it, is left out", async () => {
    const s = appleHealthScenario();
    const { owner } = await ownerWithAppleHealth(s);
    s.setClockTo("Tue+2 09:00");

    const result = await upload(
      owner,
      sleepSample("Mon 23:00", "Tue 06:00"), // ended 14 days and 3 hours before
      sleepSample("Mon+0 23:00", "Tue+0 09:00"), // ended exactly 14 days before
      sleepSample("Tue+2 09:01", "Tue+2 10:00"), // still to come
    );

    expect(result).toEqual({ sleepSamples: 1, mindfulSessions: 0, skippedLines: 0 });
    expect(storedSamples(s)).toBe(1);
  });

  test("a sample sent again, even written with another offset, is kept once", async () => {
    const s = appleHealthScenario();
    const { owner } = await ownerWithAppleHealth(s);
    s.setClockTo("Tue 09:00");
    const sample = sleepSample("Mon 23:00", "Tue 06:00");

    await upload(owner, sample, sample);
    const again = await upload(owner, sleepSample("2026-01-05T20:00:00-08:00", "2026-01-06T03:00:00-08:00"));

    expect(again).toEqual({ sleepSamples: 1, mindfulSessions: 0, skippedLines: 0 });
    expect(storedSamples(s)).toBe(1);
    // Another value or source is another sample.
    await upload(
      owner,
      sleepSample("Mon 23:00", "Tue 06:00", "In Bed"),
      sleepSample("Mon 23:00", "Tue 06:00", "Asleep", ""),
    );
    expect(storedSamples(s)).toBe(3);
  });

  test("mindful sessions are kept and counted, and judge nothing", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00");
    s.setClockTo("Tue 09:00");

    await upload(owner, {
      type: "mindful",
      start: isoText("Mon 22:00"),
      end: isoText("Tue 06:00"),
      value: "",
      source: "Calm",
    });

    expect(night(owner, pactId, s.date("Mon"))).toBe("not-judged");
  });
});

describe("judging a night", () => {
  test("in bed by 00:00, sleep from 23:40 uploaded the next morning: Satisfied as the upload arrives, with its source", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00");
    await s.advanceTo("Tue 18:00");

    s.setClockTo("Wed 07:10");
    await upload(owner, sleepSample("Tue 23:40", "Wed 07:00", "In Bed", "Oura"));

    expect(night(owner, pactId, s.date("Tue"))).toBe("satisfied");
    expect(dayOn(owner, pactId, s.date("Tue"))?.detail).toEqual({ kind: "night", inBedAt: "23:40", source: "Oura" });
    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({ occurrenceDate: s.date("Mon"), detail: { kind: "night", inBedAt: null } }),
    ]);
  });

  test("sleep from a minute before the in-bed-by time is Satisfied; from exactly then, Missed, showing when and its source", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00");
    s.setClockTo("Tue 08:00");
    await upload(owner, sleepSample("Mon 23:59", "Tue 07:00"));
    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");

    // As for an Oura Ring night: in bed by 00:00 means before it.
    s.setClockTo("Wed 08:00");
    await upload(owner, sleepSample("Wed 00:00", "Wed 07:00", "Asleep", "Google Health"));

    expect(cards(owner, "missed")).toEqual([
      {
        pactId,
        name: "In bed by midnight",
        penaltyCents: 500,
        occurrenceDate: s.date("Tue"),
        missedAt: s.at("Wed 08:00"),
        excusableUntil: s.at("Fri 08:00"),
        detail: { kind: "night", inBedAt: "00:00", source: "Google Health" },
      },
    ]);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
  });

  test("an upload before the in-bed-by time with a main sleep already begun before it Satisfies the night at once", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("23:00");

    // Asleep on the sofa from 19:00; the phone uploads at 22:30.
    s.setClockTo("Mon 22:30");
    await upload(owner, sleepSample("Mon 19:00", "Mon 22:20"));

    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");
  });

  test("an upload before the in-bed-by time with only a short session judges nothing; the next decides", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("23:00");

    s.setClockTo("Mon 22:30");
    await upload(owner, sleepSample("Mon 21:00", "Mon 22:20"));
    expect(night(owner, pactId, s.date("Mon"))).toBe("not-judged");

    // The same session, now longer, arrives at the in-bed-by time.
    s.setClockTo("Mon 23:00");
    await upload(owner, sleepSample("Mon 21:00", "Mon 22:20"), sleepSample("Mon 22:20", "Mon 23:00"));
    expect(night(owner, pactId, s.date("Mon"))).toBe("not-judged");

    s.setClockTo("Tue 07:00");
    await upload(owner, sleepSample("Mon 23:00", "Tue 06:30"));
    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");
  });

  test("a nap is ignored: the first session of 3 hours or more decides", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00");
    s.setClockTo("Tue 08:00");

    // 19:00 to 21:59 is a nap, a minute short of 3 hours.
    await upload(owner, sleepSample("Mon 19:00", "Mon 21:59"), sleepSample("Mon 23:30", "Tue 02:30"));

    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toEqual([]);
  });

  test("Awake samples are ignored, whatever their case: the sleep after them decides", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    await createPact("00:00");
    s.setClockTo("Tue 08:00");

    await upload(
      owner,
      sleepSample("Mon 21:00", "Mon 23:00", "Awake"),
      sleepSample("Mon 22:58", "Mon 23:10", "HKCategoryValueSleepAnalysisAWAKE"),
      sleepSample("Tue 00:20", "Tue 06:00", "Core"),
    );

    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({
        occurrenceDate: s.date("Mon"),
        detail: { kind: "night", inBedAt: "00:20", source: "Oura" },
      }),
    ]);
  });

  test("stages with gaps of up to an hour are one session; a longer gap starts another", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00");
    s.setClockTo("Tue 08:00");

    // Each stage alone is under 3 hours; with gaps of 60 and 45 minutes they're one.
    await upload(
      owner,
      sleepSample("Mon 23:40", "Tue 01:00", "Core", "Apple Watch"),
      sleepSample("Tue 02:00", "Tue 03:00", "Deep", "Apple Watch"),
      sleepSample("Tue 03:45", "Tue 05:00", "REM", "Apple Watch"),
    );
    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");

    // 23:30 to 01:00, then 02:01 to 06:00: the second is the first main sleep.
    s.setClockTo("Wed 08:00");
    await upload(owner, sleepSample("Tue 23:30", "Wed 01:00", "Core"), sleepSample("Wed 02:01", "Wed 06:00", "Core"));
    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({
        occurrenceDate: s.date("Tue"),
        detail: { kind: "night", inBedAt: "02:01", source: "Oura" },
      }),
    ]);
  });

  test("sleep is never merged across 18:00: a nap just before it doesn't pull the night's sleep into the night before", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00");
    s.setClockTo("Tue 08:00");
    await upload(owner, sleepSample("Mon 23:00", "Tue 07:00"));

    // 30 minutes apart, but 18:00 falls between them.
    s.setClockTo("Wed 08:00");
    await upload(owner, sleepSample("Tue 17:00", "Tue 17:50"), sleepSample("Tue 18:20", "Wed 06:00"));
    expect(night(owner, pactId, s.date("Tue"))).toBe("satisfied");
    expect(dayOn(owner, pactId, s.date("Tue"))?.detail).toEqual({ kind: "night", inBedAt: "18:20", source: "Oura" });

    // Touching at 18:00 is across it too.
    s.setClockTo("Thu 08:00");
    await upload(owner, sleepSample("Wed 15:00", "Wed 18:00"), sleepSample("Wed 18:00", "Thu 02:00"));
    expect(dayOn(owner, pactId, s.date("Wed"))?.detail).toEqual({ kind: "night", inBedAt: "18:00", source: "Oura" });
  });

  test("the 18:00 sleep isn't merged across is the account's", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s, "America/Los_Angeles");
    const pactId = await createPact("00:00");
    s.setClockTo("Tue 11:00");
    await upload(owner, sleepSample("Tue 02:00", "Tue 10:00"));

    // 17:00 to 17:50 and from 18:20 in Los Angeles: 20:00 to 20:50 and from 21:20 in New York.
    s.setClockTo("Wed 11:00");
    await upload(owner, sleepSample("Tue 20:00", "Tue 20:50"), sleepSample("Tue 21:20", "Wed 09:00"));
    expect(dayOn(owner, pactId, s.date("Tue"))?.detail).toEqual({ kind: "night", inBedAt: "18:20", source: "Oura" });
  });

  test("In Bed and stages from two apps overlap into one session, from the earliest start, with that sample's source", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00");
    s.setClockTo("Tue 08:00");

    await upload(
      owner,
      sleepSample("Mon 23:55", "Tue 06:00", "Core", "Apple Watch"),
      sleepSample("Mon 23:50", "Tue 07:00", "In Bed", "Oura"),
    );

    expect(dayOn(owner, pactId, s.date("Mon"))?.detail).toEqual({ kind: "night", inBedAt: "23:50", source: "Oura" });
  });

  test("a later upload never rejudges a night", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00");
    s.setClockTo("Tue 08:00");
    await upload(owner, sleepSample("Tue 01:00", "Tue 07:00"));
    expect(night(owner, pactId, s.date("Mon"))).toBe("missed");

    s.setClockTo("Tue 09:00");
    await upload(owner, sleepSample("Mon 23:00", "Tue 01:00"));

    expect(night(owner, pactId, s.date("Mon"))).toBe("missed");
    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({ detail: { kind: "night", inBedAt: "01:00", source: "Oura" } }),
    ]);
  });

  test("a sample sent twice judges the night once", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00");
    s.setClockTo("Tue 08:00");
    const sample = sleepSample("Tue 00:30", "Tue 07:00");

    await upload(owner, sample, sample);
    await upload(owner, sample);

    expect(night(owner, pactId, s.date("Mon"))).toBe("missed");
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toHaveLength(1);
  });

  test("no upload: the night is Missed at 18:00 the next day, with no bedtime", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00", ["mon"]);
    await s.advanceTo("Tue 17:59");
    expect(night(owner, pactId, s.date("Mon"))).toBe("not-judged");

    await s.advanceTo("Tue 18:00");

    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({
        occurrenceDate: s.date("Mon"),
        missedAt: s.at("Tue 18:00"),
        detail: { kind: "night", inBedAt: null },
      }),
    ]);
  });

  test("an upload after the night closed changes nothing", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00", ["mon"]);
    await s.advanceTo("Tue 18:00");

    s.setClockTo("Tue 18:05");
    await upload(owner, sleepSample("Mon 23:00", "Tue 07:00"));

    expect(night(owner, pactId, s.date("Mon"))).toBe("missed");
  });

  test("an upload judges only its own account's nights", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00");
    const friend = await s.befriend(owner, "friend");
    await friend.makeAppleHealthKey();
    s.setClockTo("Tue 08:00");

    await upload(friend, sleepSample("Mon 23:00", "Tue 07:00"));

    expect(night(owner, pactId, s.date("Mon"))).toBe("not-judged");
  });
});

describe("the account's timezone decides the window", () => {
  test("samples are read on the account's clock, whatever offset the phone wrote them with", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00");
    s.setClockTo("Wed 08:00");

    await upload(
      owner,
      // 20:40 in Los Angeles is 23:40 in New York: Satisfied.
      sleepSample("2026-01-05T20:40:00-08:00", "2026-01-06T04:00:00-08:00"),
      // 06:10 in Paris is 00:10 in New York: Missed.
      sleepSample("2026-01-07T06:10:00+01:00", "2026-01-07T13:00:00+01:00"),
    );

    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");
    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({
        occurrenceDate: s.date("Tue"),
        detail: { kind: "night", inBedAt: "00:10", source: "Oura" },
      }),
    ]);
  });

  test("an account in Los Angeles: 23:40 there is Satisfied, though it's 02:40 in New York", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s, "America/Los_Angeles");
    const pactId = await createPact("00:00");
    s.setClockTo("Tue 12:00");

    await upload(owner, sleepSample("2026-01-06T02:40:00-05:00", "2026-01-06T10:00:00-05:00"));

    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");
  });

  test("a move west tells the reviewer that the in-bed-by time is later from the first night in the new timezone", async () => {
    const s = appleHealthScenario();
    const { owner, reviewer, createPact } = await ownerWithAppleHealth(s);
    await createPact("00:00");
    await s.advanceTo("Mon 12:00");

    await owner.setTimezone("America/Los_Angeles");

    expect(s.notifier.sentTo(reviewer, "timezone-changed")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          body: "From New York to Los Angeles. From Tue Jan 6, In bed by midnight is due 3 hours later.",
        }),
      }),
    ]);
  });
});

describe("Today and the 15:00 push", () => {
  test("the Automatic card and the no-data card name Apple Health", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    const pactId = await createPact("00:00", ["mon"]);
    await s.advanceTo("Mon 20:00");
    expect(cards(owner, "automatic")).toEqual([expect.objectContaining({ pactId })]);

    await s.advanceTo("Tue 09:00");
    expect(owner.today().sections).toEqual([
      {
        kind: "no-sleep-data",
        cards: [
          {
            pactId,
            name: "In bed by midnight",
            penaltyCents: 500,
            evidenceKind: "apple_health",
            connectionProblem: null,
            occurrenceDate: s.date("Mon"),
            closesAt: s.at("Tue 18:00"),
            tonight: null,
          },
        ],
      },
    ]);

    s.setClockTo("Tue 09:05");
    await upload(owner, sleepSample("Mon 23:00", "Tue 07:00"));
    expect(sectionKinds(owner)).toEqual([]);
  });

  test("still no sleep at 15:00: one push telling the owner to sync from Pact", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    await createPact("00:00", ["mon"]);
    await s.advanceTo("Tue 14:59");
    expect(s.notifier.sentTo(owner, "connection-problem")).toEqual([]);

    await s.advanceTo("Tue 15:00");
    await s.advanceTo("Tue 17:00");

    expect(s.notifier.sentTo(owner, "connection-problem")).toEqual([
      {
        recipient: owner.id,
        kind: "connection-problem",
        payload: {
          occurrenceDate: s.date("Mon"),
          title: "Mon night hasn't synced",
          body: "Open Pact and tap Sync now before 6pm, or the night is missed.",
          url: "/",
        },
      },
    ]);
  });

  test("an Apple Health and an Oura Ring night waiting at 15:00: one push, telling the owner to sync both", async () => {
    const s = appleHealthScenario();
    const { owner, reviewer, sam, createPact } = await ownerWithAppleHealth(s);
    await createPact("00:00", ["mon"]);
    await owner.connectOura();
    ok(await owner.createPact(bedtimePact(sam.id, reviewer, "00:00", ["mon"])));
    await s.advanceTo("Tue 15:00");

    expect(s.notifier.sentTo(owner, "connection-problem")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          body: "Open the Oura app to sync it, and open Pact and tap Sync now before 6pm, or the night is missed.",
        }),
      }),
    ]);
  });

  test("disconnected, the card says so and the push says to set Apple Health up again", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    await createPact("00:00", ["mon"]);
    await owner.disconnectAppleHealth();
    await s.advanceTo("Tue 15:00");

    expect(cards(owner, "no-sleep-data")).toEqual([expect.objectContaining({ connectionProblem: "not-connected" })]);

    expect(s.notifier.sentTo(owner, "connection-problem")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ body: "Set up Apple Health in Pact before 6pm, or the night is missed." }),
      }),
    ]);
  });

  test("sleep uploaded by 15:00: no push", async () => {
    const s = appleHealthScenario();
    const { owner, createPact } = await ownerWithAppleHealth(s);
    await createPact("00:00", ["mon"]);
    await s.advanceTo("Tue 14:00");
    await upload(owner, sleepSample("Mon 23:00", "Tue 07:00"));
    await s.advanceTo("Tue 15:00");
    expect(s.notifier.sentTo(owner, "connection-problem")).toEqual([]);
  });
});
