import { describe, expect, test } from "vitest";
import type { NewPact } from "../shared/types.ts";
import { ankiPact, ownerWithAnki } from "./testing/anki-pact.ts";
import { bedtimePact } from "./testing/bedtime-pact.ts";
import { cameraPact, EVERY_DAY, MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import { scenario } from "./testing/scenario.ts";
import { ok } from "./testing/queries.ts";

describe("Today", () => {
  test("a new account has nothing to do right now", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.setTimezone("America/New_York");

    expect(owner.today()).toEqual({ hasPacts: false, alerts: [], sections: [], waiting: [], yesterday: [] });
  });

  test("an owner with a pact but nothing open today isn't a new account", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Mon 09:00");
    await createPact("Gym", ["mon"]);

    s.setClockTo("Tue 10:00");
    expect(owner.today()).toEqual({
      hasPacts: true,
      alerts: [],
      sections: [],
      waiting: [],
      yesterday: [expect.objectContaining({ name: "Gym", occurrenceDate: s.date("Mon") })],
    });
  });

  test("lists an open pact as To do and a not-yet-open one as Coming up", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Mon 09:00");
    const gym = await createPact("Gym", EVERY_DAY);
    s.setClockTo("Mon 23:30");
    // Monday's midnight is under an hour away, so this one opens Tuesday.
    const stretch = await createPact("Stretch", EVERY_DAY, { penaltyCents: 300 });

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
              occurrenceDate: s.date("Mon"),
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
              opensOn: s.date("Tue"),
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
    const { owner, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Mon 09:00");
    const gym = await createPact("Gym", ["mon", "wed", "fri"]);
    const stretch = await createPact("Stretch", EVERY_DAY);

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
            occurrenceDate: s.date("Tue"),
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
            occurrenceDate: s.date("Wed"),
            dueAt: s.at("Thu 00:00"),
            dueBy: null,
          },
          {
            kind: "evidence",
            pactId: stretch,
            name: "Stretch",
            penaltyCents: 500,
            editWindowClosesAt: null,
            occurrenceDate: s.date("Wed"),
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
    const { owner, createPact } = await ownerWithReviewers(s, { timezone: "Pacific/Auckland" });
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
            occurrenceDate: s.date("Tue"),
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
            opensOn: s.date("Mon+1"),
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
    const gym = await create(
      cameraPact("Gym", ["mon"], {
        recipientId: sam.id,
        reviewers: [reviewer],
        penaltyCents: 700,
        dates: { startDate: s.date("Mon+1") },
      }),
    );
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
            opensOn: s.date("Tue"),
            startDate: null,
          },
          {
            pactId: bed,
            name: "In bed by midnight",
            penaltyCents: 300,
            editWindowClosesAt: s.at("Mon 09:10"),
            opensOn: s.date("Wed"),
            startDate: null,
          },
          {
            pactId: gym,
            name: "Gym",
            penaltyCents: 700,
            editWindowClosesAt: s.at("Mon 09:10"),
            opensOn: s.date("Mon+1"),
            startDate: s.date("Mon+1"),
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
    const gym = await create(cameraPact("Gym", MON_WED_FRI, { recipientId: sam.id, reviewers: [reviewer] }));
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
