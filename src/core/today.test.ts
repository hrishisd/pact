import { describe, expect, test } from "vitest";
import type { NewPact, Weekday } from "../shared/types.ts";
import { ankiPact, ownerWithAnki } from "./testing/anki-pact.ts";
import { bedtimePact } from "./testing/bedtime-pact.ts";
import { MON_WED_FRI, photo } from "./testing/camera-pact.ts";
import { scenario, type Scenario } from "./testing/scenario.ts";
import { ok } from "./testing/queries.ts";

const DAILY: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** An owner with one friend, "reviewer", and one saved recipient, "Sam". */
async function ownerWithReviewer(s: Scenario, timezone = "America/New_York") {
  const owner = await s.signIn("owner");
  await owner.setTimezone(timezone);
  const reviewer = await s.befriend(owner, "reviewer");
  const added = ok(await owner.addRecipient({ name: "Sam" }));
  const createPact = async (name: string, days: Weekday[], penaltyCents = 500) => {
    const pact: NewPact = {
      evidenceKind: "camera",
      name,
      description: `A photo of ${name}`,
      schedule: { kind: "fixed-days", days },
      penaltyCents,
      recipientId: added.recipient.id,
      reviewerIds: [reviewer.id],
    };
    const created = ok(await owner.createPact(pact));
    return created.pactId;
  };
  return { owner, createPact };
}

describe("Today", () => {
  test("a new account has nothing to do right now", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.setTimezone("America/New_York");

    expect(owner.today()).toEqual({ hasPacts: false, alerts: [], sections: [], waiting: [], yesterday: [] });
  });

  test("an owner with a pact but nothing open today isn't a new account", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewer(s);
    s.setClockTo("Mon 09:00");
    await createPact("Gym", ["mon"]);

    s.setClockTo("Tue 10:00");
    expect(owner.today()).toEqual({
      hasPacts: true,
      alerts: [],
      sections: [],
      waiting: [],
      yesterday: [expect.objectContaining({ name: "Gym", occurrenceDate: "2026-01-05" })],
    });
  });

  test("lists an open pact as To do and a not-yet-open one as Coming up", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewer(s);
    s.setClockTo("Mon 09:00");
    const gym = await createPact("Gym", DAILY, 500);
    s.setClockTo("Mon 23:30");
    // Monday's midnight is under an hour away, so this one opens Tuesday.
    const stretch = await createPact("Stretch", DAILY, 300);

    expect(owner.today()).toEqual({
      hasPacts: true,
      alerts: [],
      sections: [
        {
          kind: "to-do",
          cards: [
            {
              kind: "evidence",
              pactId: gym,
              name: "Gym",
              penaltyCents: 500,
              editWindowClosesAt: null,
              occurrenceDate: "2026-01-05",
              dueAt: s.at("Tue 00:00"),
              dueBy: null,
            },
          ],
        },
        {
          kind: "coming-up",
          cards: [
            {
              pactId: stretch,
              name: "Stretch",
              penaltyCents: 300,
              editWindowClosesAt: s.at("Mon 23:40"),
              opensOn: "2026-01-06",
              startDate: null,
            },
          ],
        },
      ],
      waiting: [],
      yesterday: [],
    });
  });

  test("leaves out a Mon/Wed/Fri pact on Tuesday", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewer(s);
    s.setClockTo("Mon 09:00");
    const gym = await createPact("Gym", ["mon", "wed", "fri"]);
    const stretch = await createPact("Stretch", DAILY);

    s.setClockTo("Tue 10:00");
    expect(owner.today().sections).toEqual([
      {
        kind: "to-do",
        cards: [
          {
            kind: "evidence",
            pactId: stretch,
            name: "Stretch",
            penaltyCents: 500,
            editWindowClosesAt: null,
            occurrenceDate: "2026-01-06",
            dueAt: s.at("Wed 00:00"),
            dueBy: null,
          },
        ],
      },
    ]);

    s.setClockTo("Wed 10:00");
    expect(owner.today().sections).toEqual([
      {
        kind: "to-do",
        cards: [
          {
            kind: "evidence",
            pactId: gym,
            name: "Gym",
            penaltyCents: 500,
            editWindowClosesAt: null,
            occurrenceDate: "2026-01-07",
            dueAt: s.at("Thu 00:00"),
            dueBy: null,
          },
          {
            kind: "evidence",
            pactId: stretch,
            name: "Stretch",
            penaltyCents: 500,
            editWindowClosesAt: null,
            occurrenceDate: "2026-01-07",
            dueAt: s.at("Thu 00:00"),
            dueBy: null,
          },
        ],
      },
    ]);
  });

  test("days are the owner's: in Auckland it is already Tuesday", async () => {
    const s = scenario();
    // Mon 09:00 in New York is Tue 03:00 in Auckland (UTC+13 in January).
    const { owner, createPact } = await ownerWithReviewer(s, "Pacific/Auckland");
    s.setClockTo("Mon 09:00");
    const tuesday = await createPact("Tuesday pact", ["tue"]);
    const monday = await createPact("Monday pact", ["mon"]);

    expect(owner.today().sections).toEqual([
      {
        kind: "to-do",
        // Midnight ending Tuesday in Auckland.
        cards: [
          {
            kind: "evidence",
            pactId: tuesday,
            name: "Tuesday pact",
            penaltyCents: 500,
            editWindowClosesAt: s.at("Mon 09:10"),
            occurrenceDate: "2026-01-06",
            dueAt: new Date("2026-01-06T11:00:00Z"),
            dueBy: null,
          },
        ],
      },
      {
        kind: "coming-up",
        cards: [
          {
            pactId: monday,
            name: "Monday pact",
            penaltyCents: 500,
            editWindowClosesAt: s.at("Mon 09:10"),
            opensOn: "2026-01-12",
            startDate: null,
          },
        ],
      },
    ]);
  });
});

describe("Today across evidence kinds", () => {
  test("a pact of each kind not open yet has a Coming up card, soonest first", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithAnki(s);
    await owner.connectOura();
    const create = async (pact: NewPact) => {
      const created = ok(await owner.createPact(pact));
      return created.pactId;
    };
    const gym = await create({
      evidenceKind: "camera",
      name: "Gym",
      description: "A photo of Gym",
      schedule: { kind: "fixed-days", days: ["mon"] },
      startDate: "2026-01-12",
      penaltyCents: 700,
      recipientId: sam.id,
      reviewerIds: [reviewer.id],
    });
    const bed = await create({ ...bedtimePact(sam.id, reviewer, "23:00", ["wed"]), penaltyCents: 300 });
    const spanish = await create({ ...ankiPact(sam.id, reviewer, { days: ["tue"] }), penaltyCents: 200 });

    expect(owner.today().sections).toEqual([
      {
        kind: "coming-up",
        cards: [
          {
            pactId: spanish,
            name: "Spanish",
            penaltyCents: 200,
            editWindowClosesAt: s.at("Mon 09:10"),
            opensOn: "2026-01-06",
            startDate: null,
          },
          {
            pactId: bed,
            name: "In bed by midnight",
            penaltyCents: 300,
            editWindowClosesAt: s.at("Mon 09:10"),
            opensOn: "2026-01-07",
            startDate: null,
          },
          {
            pactId: gym,
            name: "Gym",
            penaltyCents: 700,
            editWindowClosesAt: s.at("Mon 09:10"),
            opensOn: "2026-01-12",
            startDate: "2026-01-12",
          },
        ],
      },
    ]);
  });

  test("alerts: Oura's connection, then AnkiWeb's, then overdue bills, then the rest", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithAnki(s);
    await owner.connectOura();
    const create = async (pact: NewPact) => {
      const created = ok(await owner.createPact(pact));
      return created.pactId;
    };
    const gym = await create({
      evidenceKind: "camera",
      name: "Gym",
      description: "A photo of Gym",
      schedule: { kind: "fixed-days", days: MON_WED_FRI },
      penaltyCents: 500,
      recipientId: sam.id,
      reviewerIds: [reviewer.id],
    });
    await create(bedtimePact(sam.id, reviewer));
    await create(ankiPact(sam.id, reviewer));
    await owner.disconnectOura();
    await owner.disconnectAnki();
    await s.advanceTo("Wed+2 12:00");
    const submitted = ok(await owner.submitEvidence(gym, [photo()]));
    await reviewer.decide(submitted.evidenceId, { kind: "reject", reason: "Blurry" });
    await s.advanceTo("Wed+2 18:00");

    const kinds = owner.today().alerts.map((alert) => (alert.kind === "connection" ? alert.service : alert.kind));
    expect(kinds).toEqual(["oura", "anki", "bill-overdue", "evidence-rejected"]);
  });
});
