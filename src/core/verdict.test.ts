// The verdict function, tested at its own interface: the combinations of
// evidence, covers, automatic data, due times and ends are many and cheap to
// list in a table. Scenarios cover how the core uses it, and the scenario
// harness checks every stored outcome against it (testing/verdict-check.ts).

import { describe, expect, test } from "vitest";
import type { Occurrence } from "./occurrences.ts";
import { verdictOf, type EvidenceFact, type OccurrenceFacts, type Verdict } from "./verdict.ts";

/** Wall-clock times in New York (UTC−5) in the week of Mon 5 Jan 2026: "Mon 18:00", "Tue 00:00". */
function at(when: string): Date {
  const [day, time] = when.split(" ");
  const date = 5 + ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon+1"].indexOf(day!);
  return new Date(`2026-01-${String(date).padStart(2, "0")}T${time}:00-05:00`);
}

const PENALTY = 500;
const RECIPIENT = "recipient-1";

/** Monday 5 Jan as a Camera day due at midnight. */
const MONDAY: Occurrence = {
  date: "2026-01-05",
  opensAt: at("Mon 00:00"),
  dueAt: at("Tue 00:00"),
  closesAt: at("Tue 00:00"),
};
/** The week of Mon 5 Jan, due at the midnight ending its Sunday. */
const WEEK: Occurrence = {
  date: "2026-01-05",
  opensAt: at("Mon 00:00"),
  dueAt: at("Mon+1 00:00"),
  closesAt: at("Mon+1 00:00"),
};
/** Monday night 5 Jan, in bed by 23:00, closing 18:00 Tuesday. */
const NIGHT: Occurrence = {
  date: "2026-01-05",
  opensAt: at("Mon 18:00"),
  dueAt: at("Mon 23:00"),
  closesAt: at("Tue 18:00"),
};

function evidence(
  submitted: string,
  decision?: "approved" | "rejected",
  decided?: string,
  day = "2026-01-05",
): EvidenceFact {
  return { day, submittedAt: at(submitted), decision: decision ?? null, decidedAt: decided ? at(decided) : null };
}

function cover(state: "waiting" | "approved", approved?: string): OccurrenceFacts["cover"] {
  return { id: "cover-1", kind: "excuse", state, approvedAt: approved ? at(approved) : null };
}

function cameraDay(over: Partial<OccurrenceFacts> = {}): OccurrenceFacts {
  return {
    occurrence: MONDAY,
    terms: { schedule: { kind: "fixed-days", days: ["mon"] }, penaltyCents: PENALTY, recipientId: RECIPIENT },
    pactEndedAt: null,
    evidence: [],
    automatic: null,
    cover: null,
    ...over,
  };
}

function week(over: Partial<OccurrenceFacts> = {}): OccurrenceFacts {
  return cameraDay({
    occurrence: WEEK,
    terms: { schedule: { kind: "weekly-count", target: 3 }, penaltyCents: PENALTY, recipientId: RECIPIENT },
    ...over,
  });
}

function night(sleep: { start: string; arrived: string } | null, over: Partial<OccurrenceFacts> = {}): OccurrenceFacts {
  return cameraDay({
    occurrence: NIGHT,
    automatic: {
      kind: "oura",
      inBedBy: "23:00",
      firstBedtimeStart: sleep?.start ?? null,
      arrivedAt: sleep ? at(sleep.arrived) : null,
    },
    ...over,
  });
}

/**
 * An Anki day: `finished`, when the check that found the deck finished
 * started, and when its answer was recorded (`recorded`, else at once);
 * `checks`, each check's start and answer ("running" while it hasn't come).
 */
function ankiDay(
  finished: string | null,
  checks: [string, string][] = [],
  over: Partial<OccurrenceFacts> = {},
  recorded?: string,
): OccurrenceFacts {
  return cameraDay({
    automatic: {
      kind: "anki",
      finishedAt: finished ? at(finished) : null,
      recordedAt: finished ? at(recorded ?? finished) : null,
      checks: checks.map(([started, answered]) => ({
        startedAt: at(started),
        finishedAt: answered === "running" ? null : at(answered),
      })),
    },
    ...over,
  });
}

const satisfied = (when: string): Verdict => ({ kind: "satisfied", at: at(when) });
const excused = (when: string): Verdict => ({ kind: "excused", at: at(when), coverId: "cover-1" });
const missed = (when: string, days = 1): Verdict => ({
  kind: "missed",
  at: at(when),
  penaltyCents: PENALTY * days,
  recipientId: RECIPIENT,
});

describe("a Camera day", () => {
  test.each<{ name: string; facts: OccurrenceFacts; now: string; verdict: Verdict }>([
    { name: "before its due time, with no evidence", facts: cameraDay(), now: "Mon 20:00", verdict: { kind: "open" } },
    { name: "at its due time, with no evidence", facts: cameraDay(), now: "Tue 00:00", verdict: missed("Tue 00:00") },
    {
      name: "with evidence waiting at its due time",
      facts: cameraDay({ evidence: [evidence("Mon 20:00")] }),
      now: "Tue 09:00",
      verdict: { kind: "waiting", on: "evidence" },
    },
    {
      name: "with evidence approved before its due time",
      facts: cameraDay({ evidence: [evidence("Mon 20:00", "approved", "Mon 21:00")] }),
      now: "Tue 09:00",
      verdict: satisfied("Tue 00:00"),
    },
    {
      name: "with evidence approved before its due time, before then",
      facts: cameraDay({ evidence: [evidence("Mon 20:00", "approved", "Mon 21:00")] }),
      now: "Mon 22:00",
      verdict: { kind: "open" },
    },
    {
      name: "with evidence approved after its due time",
      facts: cameraDay({ evidence: [evidence("Mon 20:00", "approved", "Tue 09:00")] }),
      now: "Tue 10:00",
      verdict: satisfied("Tue 09:00"),
    },
    {
      name: "with evidence rejected before its due time: Missed at once",
      facts: cameraDay({ evidence: [evidence("Mon 20:00", "rejected", "Mon 21:00")] }),
      now: "Mon 22:00",
      verdict: missed("Mon 21:00"),
    },
    {
      name: "with evidence rejected after its due time",
      facts: cameraDay({ evidence: [evidence("Mon 20:00", "rejected", "Tue 09:00")] }),
      now: "Tue 10:00",
      verdict: missed("Tue 09:00"),
    },
    {
      name: "with a cover approved before its due time",
      facts: cameraDay({ cover: cover("approved", "Mon 10:00") }),
      now: "Tue 09:00",
      verdict: excused("Tue 00:00"),
    },
    {
      name: "with a cover approved after it was Missed",
      facts: cameraDay({ cover: cover("approved", "Tue 09:00") }),
      now: "Tue 10:00",
      verdict: excused("Tue 09:00"),
    },
    {
      name: "with evidence approved before its due time and a cover approved after it: Satisfied stays",
      facts: cameraDay({
        cover: cover("approved", "Tue 09:00"),
        evidence: [evidence("Mon 20:00", "approved", "Mon 21:00")],
      }),
      now: "Tue 10:00",
      verdict: satisfied("Tue 00:00"),
    },
    {
      name: "with evidence approved after its due time and a cover approved after that: Satisfied stays",
      facts: cameraDay({
        cover: cover("approved", "Tue 10:00"),
        evidence: [evidence("Mon 20:00", "approved", "Tue 09:00")],
      }),
      now: "Tue 11:00",
      verdict: satisfied("Tue 09:00"),
    },
    {
      name: "with a cover waiting: Missed, its penalty held",
      facts: cameraDay({ cover: cover("waiting") }),
      now: "Tue 10:00",
      verdict: missed("Tue 00:00"),
    },
    {
      name: "with a cover approved and evidence approved: approved evidence beats the cover",
      facts: cameraDay({
        cover: cover("approved", "Mon 10:00"),
        evidence: [evidence("Mon 20:00", "approved", "Mon 21:00")],
      }),
      now: "Tue 09:00",
      verdict: satisfied("Tue 00:00"),
    },
    {
      name: "with a cover approved and evidence rejected before its due time",
      facts: cameraDay({
        cover: cover("approved", "Mon 10:00"),
        evidence: [evidence("Mon 20:00", "rejected", "Mon 21:00")],
      }),
      now: "Tue 09:00",
      verdict: excused("Tue 00:00"),
    },
    {
      name: "with a cover approved and evidence waiting at its due time: Excused",
      facts: cameraDay({ cover: cover("approved", "Mon 10:00"), evidence: [evidence("Mon 20:00")] }),
      now: "Tue 09:00",
      verdict: excused("Tue 00:00"),
    },
    {
      name: "Excused, then its waiting evidence approved: Satisfied (vacation spec)",
      facts: cameraDay({
        cover: cover("approved", "Mon 10:00"),
        evidence: [evidence("Mon 20:00", "approved", "Tue 09:00")],
      }),
      now: "Tue 10:00",
      verdict: satisfied("Tue 09:00"),
    },
    {
      name: "with evidence waiting and a cover approved after its due time",
      facts: cameraDay({ cover: cover("approved", "Tue 08:00"), evidence: [evidence("Mon 20:00")] }),
      now: "Tue 10:00",
      verdict: excused("Tue 08:00"),
    },
    {
      name: "due after the pact Ended",
      facts: cameraDay({ pactEndedAt: at("Mon 12:00") }),
      now: "Tue 10:00",
      verdict: { kind: "not-the-pacts" },
    },
    {
      name: "due after the pact Ended, its evidence rejected before the end",
      facts: cameraDay({ pactEndedAt: at("Mon 12:00"), evidence: [evidence("Mon 08:00", "rejected", "Mon 09:00")] }),
      now: "Tue 10:00",
      verdict: missed("Mon 09:00"),
    },
    {
      name: "due before the pact Ended, its evidence approved after the end",
      facts: cameraDay({ pactEndedAt: at("Tue 06:00"), evidence: [evidence("Mon 20:00", "approved", "Tue 09:00")] }),
      now: "Tue 10:00",
      verdict: satisfied("Tue 09:00"),
    },
  ])("$name", ({ facts, now, verdict }) => {
    expect(verdictOf(facts, at(now))).toEqual(verdict);
  });
});

describe("a Weekly count week of 3", () => {
  const approvedOn = (...days: string[]) => days.map((day) => evidence("Mon 10:00", "approved", "Mon 11:00", day));
  test.each<{ name: string; facts: OccurrenceFacts; now: string; verdict: Verdict }>([
    {
      name: "before its due time",
      facts: week({ evidence: approvedOn("2026-01-05") }),
      now: "Sun 12:00",
      verdict: { kind: "open" },
    },
    {
      name: "at its target",
      facts: week({ evidence: approvedOn("2026-01-05", "2026-01-06", "2026-01-07") }),
      now: "Mon+1 09:00",
      verdict: satisfied("Mon+1 00:00"),
    },
    {
      name: "above its target",
      facts: week({ evidence: approvedOn("2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08") }),
      now: "Mon+1 09:00",
      verdict: satisfied("Mon+1 00:00"),
    },
    {
      name: "one day short: one penalty",
      facts: week({ evidence: approvedOn("2026-01-05", "2026-01-06") }),
      now: "Mon+1 09:00",
      verdict: missed("Mon+1 00:00"),
    },
    {
      name: "with no evidence: a penalty for each day short",
      facts: week(),
      now: "Mon+1 09:00",
      verdict: missed("Mon+1 00:00", 3),
    },
    {
      name: "short with evidence waiting: judging waits",
      facts: week({
        evidence: [
          ...approvedOn("2026-01-05", "2026-01-06"),
          evidence("Sun 10:00", undefined, undefined, "2026-01-11"),
        ],
      }),
      now: "Mon+1 09:00",
      verdict: { kind: "waiting", on: "evidence" },
    },
    {
      name: "at its target with evidence waiting: Satisfied, not held",
      facts: week({
        evidence: [
          ...approvedOn("2026-01-05", "2026-01-06", "2026-01-07"),
          evidence("Sun 10:00", undefined, undefined, "2026-01-11"),
        ],
      }),
      now: "Mon+1 09:00",
      verdict: satisfied("Mon+1 00:00"),
    },
    {
      name: "above its target with evidence waiting: Satisfied, not held",
      facts: week({
        evidence: [
          ...approvedOn("2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"),
          evidence("Sun 10:00", undefined, undefined, "2026-01-11"),
        ],
      }),
      now: "Mon+1 09:00",
      verdict: satisfied("Mon+1 00:00"),
    },
    {
      name: "short, then its waiting evidence approved: Satisfied then",
      facts: week({
        evidence: [
          ...approvedOn("2026-01-05", "2026-01-06"),
          evidence("Sun 10:00", "approved", "Mon+1 09:00", "2026-01-11"),
        ],
      }),
      now: "Mon+1 10:00",
      verdict: satisfied("Mon+1 09:00"),
    },
    {
      name: "short, then its waiting evidence rejected: Missed then",
      facts: week({
        evidence: [
          ...approvedOn("2026-01-05", "2026-01-06"),
          evidence("Sun 10:00", "rejected", "Mon+1 09:00", "2026-01-11"),
        ],
      }),
      now: "Mon+1 10:00",
      verdict: missed("Mon+1 09:00"),
    },
    {
      name: "rejected evidence before its due time doesn't judge it",
      facts: week({ evidence: [evidence("Mon 10:00", "rejected", "Mon 11:00")] }),
      now: "Mon 12:00",
      verdict: { kind: "open" },
    },
    {
      name: "short with evidence waiting under an approved cover: Excused",
      facts: week({
        cover: cover("approved", "Mon 09:00"),
        evidence: [
          ...approvedOn("2026-01-05", "2026-01-06"),
          evidence("Sun 10:00", undefined, undefined, "2026-01-11"),
        ],
      }),
      now: "Mon+1 09:00",
      verdict: excused("Mon+1 00:00"),
    },
  ])("$name", ({ facts, now, verdict }) => {
    expect(verdictOf(facts, at(now))).toEqual(verdict);
  });
});

describe("a bedtime night, in bed by 23:00", () => {
  const onTime = { start: "2026-01-05T22:30:00-05:00", arrived: "Tue 08:00" };
  const late = { start: "2026-01-05T23:40:00-05:00", arrived: "Tue 08:00" };
  const lateAfterClose = { start: "2026-01-05T23:40:00-05:00", arrived: "Tue 19:00" };
  test.each<{ name: string; facts: OccurrenceFacts; now: string; verdict: Verdict }>([
    { name: "on time", facts: night(onTime), now: "Tue 09:00", verdict: satisfied("Tue 08:00") },
    { name: "late", facts: night(late), now: "Tue 09:00", verdict: missed("Tue 08:00") },
    {
      name: "with no data before it closes",
      facts: night(null),
      now: "Tue 09:00",
      verdict: { kind: "waiting", on: "oura" },
    },
    { name: "with no data when it closes", facts: night(null), now: "Tue 18:00", verdict: missed("Tue 18:00") },
    {
      name: "late, arriving on the first look after it closed: judged by it then",
      facts: night(lateAfterClose),
      now: "Tue 20:00",
      verdict: missed("Tue 19:00"),
    },
    {
      name: "on time under an approved cover",
      facts: night(onTime, { cover: cover("approved", "Mon 10:00") }),
      now: "Tue 09:00",
      verdict: satisfied("Tue 08:00"),
    },
    {
      name: "late under an approved cover",
      facts: night(late, { cover: cover("approved", "Mon 10:00") }),
      now: "Tue 09:00",
      verdict: excused("Tue 08:00"),
    },
    {
      name: "with no data under an approved cover, before it closes",
      facts: night(null, { cover: cover("approved", "Mon 10:00") }),
      now: "Tue 09:00",
      verdict: { kind: "waiting", on: "oura" },
    },
    {
      name: "with no data under an approved cover, when it closes",
      facts: night(null, { cover: cover("approved", "Mon 10:00") }),
      now: "Tue 18:00",
      verdict: excused("Tue 18:00"),
    },
    {
      name: "late, arriving on the first look after it closed, under an approved cover",
      facts: night(lateAfterClose, { cover: cover("approved", "Mon 10:00") }),
      now: "Tue 20:00",
      verdict: excused("Tue 19:00"),
    },
    {
      name: "late, then a cover approved",
      facts: night(late, { cover: cover("approved", "Tue 12:00") }),
      now: "Tue 13:00",
      verdict: excused("Tue 12:00"),
    },
  ])("$name", ({ facts, now, verdict }) => {
    expect(verdictOf(facts, at(now))).toEqual(verdict);
  });
});

describe("an Anki day", () => {
  test.each<{ name: string; facts: OccurrenceFacts; now: string; verdict: Verdict }>([
    {
      name: "finished before its due time",
      facts: ankiDay("Mon 20:00"),
      now: "Mon 21:00",
      verdict: satisfied("Mon 20:00"),
    },
    { name: "unfinished before its due time", facts: ankiDay(null), now: "Mon 21:00", verdict: { kind: "open" } },
    { name: "unfinished at its due time", facts: ankiDay(null), now: "Tue 00:00", verdict: missed("Tue 00:00") },
    {
      name: "with a check running that started before its due time",
      facts: ankiDay(null, [["Mon 23:59", "running"]]),
      now: "Tue 00:01",
      verdict: { kind: "waiting", on: "anki-check" },
    },
    {
      name: "with a check running at its due time that finds the deck finished: Satisfied as of the check",
      facts: ankiDay("Mon 23:59", [["Mon 23:59", "Tue 00:01"]], {}, "Tue 00:01"),
      now: "Tue 00:02",
      verdict: satisfied("Mon 23:59"),
    },
    {
      name: "with a check running at its due time that finds cards left: Missed at its due time",
      facts: ankiDay(null, [["Mon 23:59", "Tue 00:01"]]),
      now: "Tue 00:02",
      verdict: missed("Tue 00:00"),
    },
    {
      name: "with a check running so long it's given up",
      facts: ankiDay(null, [["Mon 23:59", "running"]]),
      now: "Tue 00:05",
      verdict: missed("Tue 00:00"),
    },
    {
      name: "with a check that finds the deck finished answering after it was given up: still Missed",
      facts: ankiDay("Mon 23:59", [["Mon 23:59", "Tue 00:05"]], {}, "Tue 00:05"),
      now: "Tue 00:06",
      verdict: missed("Tue 00:00"),
    },
    {
      name: "unfinished under an approved cover",
      facts: ankiDay(null, [], { cover: cover("approved", "Mon 10:00") }),
      now: "Tue 09:00",
      verdict: excused("Tue 00:00"),
    },
    {
      name: "finished under an approved cover",
      facts: ankiDay("Mon 20:00", [], { cover: cover("approved", "Mon 10:00") }),
      now: "Tue 09:00",
      verdict: satisfied("Mon 20:00"),
    },
  ])("$name", ({ facts, now, verdict }) => {
    expect(verdictOf(facts, at(now))).toEqual(verdict);
  });
});
