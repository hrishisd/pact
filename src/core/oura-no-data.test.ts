// Ticket 09: a bedtime night Oura hasn't reported yet. Today shows it first,
// as No Oura data, and checking Oura now is cheap but rate-limited. At 15:00
// the next day a night still not judged sends one push. A broken connection
// marks it Needs reconnecting once, raises an alert and a notification, and
// stops polling until the owner reconnects; the night waits until 18:00.

import { describe, expect, test } from "vitest";
import { ownerWithOura, sleep } from "./testing/bedtime-pact.ts";
import { scenario, type AccountHandle, type Scenario } from "./testing/scenario.ts";

const TUE = "2026-01-06";
const WED = "2026-01-07";

/** The night of `date` as the pact's heat map shows it. */
function judged(owner: AccountHandle, pactId: string, date: string) {
  const result = owner.pact(pactId);
  if (!result.ok) throw new Error(result.reason);
  const { history } = result.pact;
  if (history.kind !== "fixed-days") throw new Error(`a ${history.kind} heat map`);
  return history.days.find((day) => day.date === date)?.occurrence?.status.kind;
}

function connectionProblems(s: Scenario, owner: AccountHandle) {
  return s.notifier.sentTo(owner).filter((n) => n.kind === "connection-problem");
}

/** An owner whose Mon night was Satisfied, so Tue night is the one waiting on Oura. */
async function tueNightWaiting(s: Scenario) {
  const setUp = await ownerWithOura(s);
  const pactId = await setUp.createPact("00:00");
  s.ouraSource.addSleep(setUp.owner.id, sleep("Mon 23:00"));
  await s.advanceTo("Tue 07:00");
  return { ...setUp, pactId };
}

describe("the No Oura data card", () => {
  test("Wed 09:00, Tue night not judged: Today shows it first, with the 18:00 cutoff and tonight's deadline", async () => {
    const s = scenario();
    const { owner, pactId } = await tueNightWaiting(s);
    await s.advanceTo("Wed 09:00");

    expect(owner.today().sections).toEqual([
      {
        kind: "no-oura-data",
        cards: [
          {
            pactId,
            name: "In bed by midnight",
            penaltyCents: 500,
            occurrenceDate: TUE,
            closesAt: s.at("Wed 18:00"),
            tonight: { occurrenceDate: WED, dueAt: s.at("Thu 00:00"), inBedBy: "00:00" },
          },
        ],
      },
    ]);
  });

  test("it comes before every other section", async () => {
    const s = scenario();
    const { owner, createPact } = await tueNightWaiting(s);
    s.setClockTo("Tue 08:00");
    await createPact("00:00", ["thu"]);
    await s.advanceTo("Wed 09:00");
    expect(owner.today().sections.map((section) => section.kind)).toEqual(["no-oura-data", "coming-up"]);
  });

  test("shows from the in-bed-by time until the night is judged; a night with no pact tonight carries no deadline", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    await createPact("00:00", ["tue"]);
    await s.advanceTo("Tue 23:59");
    expect(owner.today().sections.map((section) => section.kind)).toEqual(["automatic"]);

    await s.advanceTo("Wed 00:00");
    expect(owner.today().sections).toEqual([
      { kind: "no-oura-data", cards: [expect.objectContaining({ occurrenceDate: TUE, tonight: null })] },
    ]);

    s.ouraSource.addSleep(owner.id, sleep("Tue 23:30"));
    await s.advanceTo("Wed 08:00");
    expect(owner.today().sections).toEqual([]);
  });

  test("at 18:00 it becomes a Missed card", async () => {
    const s = scenario();
    const { owner } = await tueNightWaiting(s);
    await s.advanceTo("Wed 18:00");
    expect(owner.today().sections.map((section) => section.kind)).toEqual(["missed", "automatic"]);
  });

  test("an excuse filed for the night from the card moves it to Waiting for approval", async () => {
    const s = scenario();
    const { owner, pactId } = await tueNightWaiting(s);
    await s.advanceTo("Wed 09:00");

    const filed = await owner.fileExcuse(pactId, { from: TUE, to: TUE, reason: "Ring was charging" }, []);
    if (!filed.ok) throw new Error(filed.reason);

    const today = owner.today();
    expect(today.sections.map((section) => section.kind)).toEqual(["automatic"]);
    expect(today.waiting).toEqual([
      expect.objectContaining({ kind: "excuse", id: filed.excuseId, pactId, firstDate: TUE, lastDate: TUE }),
    ]);
  });
});

describe("checking Oura now", () => {
  test("judges the night at once when the ring has synced", async () => {
    const s = scenario();
    const { owner, pactId } = await tueNightWaiting(s);
    await s.advanceTo("Wed 09:00");
    s.ouraSource.addSleep(owner.id, sleep("Tue 23:30"));

    s.setClockTo("2026-01-07T09:00:20-05:00");
    await owner.checkOura();

    expect(judged(owner, pactId, TUE)).toBe("satisfied");
    expect(owner.today().sections.map((section) => section.kind)).toEqual(["automatic"]);
  });

  test("two checks 10 s apart make one Oura call; 16 s apart, two", async () => {
    const s = scenario();
    const { owner } = await tueNightWaiting(s);
    await s.advanceTo("Wed 09:00");
    const calls = s.ouraSource.calls.length;

    s.setClockTo("2026-01-07T09:00:20-05:00");
    await owner.checkOura();
    s.setClockTo("2026-01-07T09:00:30-05:00");
    await owner.checkOura();
    expect(s.ouraSource.calls.length - calls).toBe(1);

    s.setClockTo("2026-01-07T09:00:46-05:00");
    await owner.checkOura();
    expect(s.ouraSource.calls.length - calls).toBe(2);
  });

  test("the limit is per account", async () => {
    const s = scenario();
    const { owner, reviewer } = await tueNightWaiting(s);
    const theirs = await ownerWithOura(s, reviewer);
    await theirs.createPact("00:00");
    await s.advanceTo("Wed 09:00");
    const calls = s.ouraSource.calls.length;

    s.setClockTo("2026-01-07T09:00:20-05:00");
    await owner.checkOura();
    await reviewer.checkOura();
    expect(s.ouraSource.calls.slice(calls).map((call) => call.account)).toEqual([owner.id, reviewer.id]);
  });

  test("with no night waiting on Oura, or no connection, it makes no call", async () => {
    const s = scenario();
    const { owner } = await ownerWithOura(s);
    await owner.checkOura();
    const other = await s.befriend(owner, "other");
    await other.checkOura();
    expect(s.ouraSource.calls).toEqual([]);
  });

  test("a failing Oura call leaves the night as it was and doesn't throw", async () => {
    const s = scenario();
    const { owner, pactId } = await tueNightWaiting(s);
    await s.advanceTo("Wed 09:00");
    s.ouraSource.sleepPeriods = async () => {
      throw new Error("Oura sleep request failed: HTTP 503");
    };

    s.setClockTo("2026-01-07T09:00:20-05:00");
    await owner.checkOura();

    expect(judged(owner, pactId, TUE)).toBe("not-judged");
    expect(owner.profile().connections).toEqual([expect.objectContaining({ status: "connected" })]);
  });
});

describe("the 15:00 push", () => {
  test("still no data at 15:00: exactly one Connection problem push, also across a restart", async () => {
    const s = scenario();
    const { owner } = await tueNightWaiting(s);
    await s.advanceTo("Wed 14:59");
    expect(connectionProblems(s, owner)).toEqual([]);

    await s.advanceTo("Wed 15:00");
    await s.advanceTo("Wed 15:01");
    await s.restart();
    await s.advanceTo("Wed 15:02");
    await s.advanceTo("Wed 17:00");

    expect(connectionProblems(s, owner)).toEqual([
      {
        recipient: owner.id,
        kind: "connection-problem",
        channel: "push",
        payload: {
          occurrenceDate: TUE,
          title: "No Oura data",
          body: "No Oura data for Tue night yet. Sync your ring before 6pm or it counts as missed.",
          url: "/",
        },
      },
    ]);
  });

  test("data arrives at 14:00 instead: no push", async () => {
    const s = scenario();
    const { owner } = await tueNightWaiting(s);
    await s.advanceTo("Wed 13:59");
    s.ouraSource.addSleep(owner.id, sleep("Tue 23:30"));
    await s.advanceTo("Wed 14:00");
    await s.advanceTo("Wed 15:00");
    expect(connectionProblems(s, owner)).toEqual([]);
  });

  test("one push for the night, however many bedtime pacts wait on it", async () => {
    const s = scenario();
    const { owner, createPact } = await tueNightWaiting(s);
    s.setClockTo("Tue 08:00");
    await createPact("23:30");
    await s.advanceTo("Wed 15:00");
    expect(connectionProblems(s, owner)).toHaveLength(1);
  });

  test("a night with an excuse filed gets no push", async () => {
    const s = scenario();
    const { owner, pactId } = await tueNightWaiting(s);
    s.setClockTo("Wed 09:00");
    const filed = await owner.fileExcuse(pactId, { from: TUE, to: TUE, reason: "Ring was charging" }, []);
    if (!filed.ok) throw new Error(filed.reason);
    await s.advanceTo("Wed 15:00");
    expect(connectionProblems(s, owner)).toEqual([]);
  });

  test("a traveller gets it at 15:00 on Oura's clock, three hours before the night closes there", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    await createPact("00:00");
    // Mon night in Paris: 15:00 Wed there is 09:00 in New York.
    s.ouraSource.addSleep(owner.id, sleep("2026-01-05T23:00:00+01:00"));
    await s.advanceTo("Tue 07:00");

    await s.advanceTo("Wed 08:59");
    expect(connectionProblems(s, owner)).toEqual([]);
    await s.advanceTo("Wed 09:00");
    expect(connectionProblems(s, owner)).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ title: "No Oura data", occurrenceDate: TUE }) }),
    ]);
  });

  test("the scheduler back after 18:00 judges the night Missed and sends no push", async () => {
    const s = scenario();
    const { owner } = await tueNightWaiting(s);
    await s.advanceTo("Wed 18:30");
    expect(connectionProblems(s, owner)).toEqual([]);
  });
});

describe("a disconnected connection", () => {
  test("disconnected at 08:00: one alert and one notification, no more calls; reconnected at 12:00, the data judges the night", async () => {
    const s = scenario();
    const { owner, pactId } = await tueNightWaiting(s);
    await s.advanceTo("Wed 07:59");
    s.ouraSource.disconnect(owner.id);
    await s.advanceTo("Wed 08:00");
    const calls = s.ouraSource.calls.length;
    await s.advanceTo("Wed 08:01");
    await s.advanceTo("Wed 11:59");
    s.setClockTo("Wed 11:59");
    await owner.checkOura();

    expect(s.ouraSource.calls).toHaveLength(calls);
    expect(owner.profile().connections).toEqual([expect.objectContaining({ status: "needs-reconnecting" })]);
    expect(owner.today().alerts).toEqual([{ kind: "oura-connection", status: "needs-reconnecting" }]);
    expect(owner.pact(pactId)).toMatchObject({ ok: true, pact: { connectionProblem: "needs-reconnecting" } });
    expect(connectionProblems(s, owner)).toEqual([
      {
        recipient: owner.id,
        kind: "connection-problem",
        channel: "push",
        payload: {
          title: "Oura needs reconnecting",
          body: "A night with no data by 6pm counts as Missed. Reconnect before then.",
          url: "/",
        },
      },
    ]);
    expect(judged(owner, pactId, TUE)).toBe("not-judged");

    s.ouraSource.reconnect(owner.id);
    s.ouraSource.addSleep(owner.id, sleep("Tue 23:30"));
    s.setClockTo("Wed 12:00");
    await owner.connectOura();
    await s.advanceTo("Wed 12:01");

    expect(judged(owner, pactId, TUE)).toBe("satisfied");
    expect(owner.today().alerts).toEqual([]);
    expect(owner.pact(pactId)).toMatchObject({ ok: true, pact: { connectionProblem: null } });
    expect(connectionProblems(s, owner)).toHaveLength(1);
  });

  test("a check now that finds it disconnected marks it the same way", async () => {
    const s = scenario();
    const { owner } = await tueNightWaiting(s);
    await s.advanceTo("Wed 09:00");
    s.ouraSource.disconnect(owner.id);
    s.setClockTo("2026-01-07T09:00:20-05:00");
    await owner.checkOura();
    expect(owner.profile().connections).toEqual([expect.objectContaining({ status: "needs-reconnecting" })]);
    expect(connectionProblems(s, owner)).toHaveLength(1);
  });

  test("disconnected and never reconnected: Missed at 18:00", async () => {
    const s = scenario();
    const { owner, pactId } = await tueNightWaiting(s);
    s.ouraSource.disconnect(owner.id);
    await s.advanceTo("Wed 08:00");
    await s.advanceTo("Wed 17:59");
    expect(judged(owner, pactId, TUE)).toBe("not-judged");
    await s.advanceTo("Wed 18:00");
    expect(judged(owner, pactId, TUE)).toBe("missed");
  });

  test("a transient Oura failure doesn't count as disconnected", async () => {
    const s = scenario();
    const { owner } = await tueNightWaiting(s);
    s.ouraSource.sleepPeriods = async () => {
      throw new Error("The operation was aborted due to timeout");
    };
    await s.advanceTo("Wed 08:00");
    await s.advanceTo("Wed 08:01");
    expect(owner.profile().connections).toEqual([expect.objectContaining({ status: "connected" })]);
    expect(owner.today().alerts).toEqual([]);
    expect(connectionProblems(s, owner)).toEqual([]);
  });

  test("with a connection problem, the 15:00 push says to reconnect", async () => {
    const s = scenario();
    const { owner } = await tueNightWaiting(s);
    s.ouraSource.disconnect(owner.id);
    await s.advanceTo("Wed 08:00");
    await s.advanceTo("Wed 15:00");
    expect(connectionProblems(s, owner).map((n) => n.payload.body)).toEqual([
      "A night with no data by 6pm counts as Missed. Reconnect before then.",
      "No Oura data for Tue night yet. Reconnect Oura before 6pm or it counts as missed.",
    ]);
  });
});

describe("disconnecting Oura", () => {
  test("Profile reports how many Active pacts use the connection", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    expect(owner.profile().connections).toEqual([expect.objectContaining({ activePacts: 0 })]);
    await createPact("00:00");
    await createPact("23:00");
    expect(owner.profile().connections).toEqual([expect.objectContaining({ activePacts: 2 })]);
  });

  test("removes the connection: no calls, an alert to connect again, and the night is Missed at 18:00", async () => {
    const s = scenario();
    const { owner, pactId } = await tueNightWaiting(s);
    await owner.disconnectOura();

    expect(owner.profile().connections).toEqual([]);
    expect(owner.today().alerts).toEqual([{ kind: "oura-connection", status: "not-connected" }]);
    expect(owner.pact(pactId)).toMatchObject({ ok: true, pact: { connectionProblem: "not-connected" } });
    const calls = s.ouraSource.calls.length;
    await s.advanceTo("Wed 18:00");
    expect(s.ouraSource.calls).toHaveLength(calls);
    expect(judged(owner, pactId, TUE)).toBe("missed");
  });

  test("with no Active bedtime pact, no alert", async () => {
    const s = scenario();
    const { owner } = await ownerWithOura(s);
    await owner.disconnectOura();
    expect(owner.today().alerts).toEqual([]);
  });
});
