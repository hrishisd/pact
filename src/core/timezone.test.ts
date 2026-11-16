import { describe, expect, test } from "vitest";
import { EVERY_DAY, MON_WED_FRI, ownerWithReviewers, photo, submit } from "./testing/camera-pact.ts";
import { cards, owed, statusOn } from "./testing/queries.ts";
import { scenario } from "./testing/scenario.ts";

describe("account timezone", () => {
  test("changing the timezone shows up in the profile", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    expect(await owner.setTimezone("America/Chicago")).toEqual({ ok: true, timezone: "America/Chicago" });

    expect(owner.profile().timezone).toBe("America/Chicago");
  });

  test("a zone is stored, and answered, under its canonical name", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    expect(await owner.setTimezone("america/chicago")).toEqual({ ok: true, timezone: "America/Chicago" });

    expect(owner.profile().timezone).toBe("America/Chicago");
  });

  test("changing it later replaces it, and survives a restart", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.setTimezone("America/New_York");

    await owner.setTimezone("Europe/London");
    await s.restart();

    expect(owner.profile().timezone).toBe("Europe/London");
  });

  test.each(["Mars/Olympus_Mons", "", "EST5EDT nonsense", "+05:00"])(
    "an invalid timezone (%j) is rejected and the old one kept",
    async (bad) => {
      const s = scenario();
      const owner = await s.signIn("owner");
      await owner.setTimezone("America/Chicago");

      expect(await owner.setTimezone(bad)).toEqual({ ok: false, reason: "invalid-timezone" });

      expect(owner.profile().timezone).toBe("America/Chicago");
    },
  );
});

// A timezone change applies only to occurrences that haven't opened: one open
// or past keeps the timezone it opened in. Scenario times are New York's.
describe("a timezone change and the owner's days", () => {
  test("a Missed day stays Missed, and off To do, after a move west puts it back in the afternoon", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s, { timezone: "Europe/London" });
    const gym = await createPact("Gym", MON_WED_FRI);
    // Monday ends at midnight in London, 19:00 in New York.
    await s.advanceTo("Mon 19:00");
    expect(statusOn(owner, gym, s.date("Mon"))).toBe("missed");

    s.setClockTo("Mon 19:30");
    // 16:30 on Monday in Los Angeles.
    await owner.setTimezone("America/Los_Angeles");
    await s.advanceTo("Mon 20:00");

    expect(statusOn(owner, gym, s.date("Mon"))).toBe("missed");
    expect(cards(owner, "to-do")).toEqual([]);
    expect(owed(owner)).toBe(500);
    expect(await owner.submitEvidence(gym, [photo()])).toEqual({ ok: false, reason: "not-open" });
  });

  test("an open day keeps its due time after a move west", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");

    await owner.setTimezone("America/Los_Angeles");

    expect(cards(owner, "to-do")).toEqual([
      expect.objectContaining({ pactId: gym, occurrenceDate: s.date("Mon"), dueAt: s.at("Tue 00:00") }),
    ]);
    await s.advanceTo("Tue 00:00");
    expect(statusOn(owner, gym, s.date("Mon"))).toBe("missed");
  });

  test("an open day keeps its due time after a move east, and takes evidence past midnight in the new timezone", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");

    // 23:00 on Monday in London.
    await owner.setTimezone("Europe/London");

    expect(cards(owner, "to-do")).toEqual([
      expect.objectContaining({ pactId: gym, occurrenceDate: s.date("Mon"), dueAt: s.at("Tue 00:00") }),
    ]);
    await s.advanceTo("Mon 20:00");
    expect(statusOn(owner, gym, s.date("Mon"))).toBe("not-judged");
    await submit(owner, gym);
    await s.advanceTo("Tue 00:00");
    expect(statusOn(owner, gym, s.date("Mon"))).toBe("not-judged");
    expect(owed(owner)).toBe(0);
  });

  test("the first day not open at a move west is due in the new timezone", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    await owner.setTimezone("America/Los_Angeles");

    // Wednesday ends at midnight in Los Angeles, 03:00 Thursday in New York.
    await s.advanceTo("Thu 02:59");
    expect(statusOn(owner, gym, s.date("Wed"))).toBe("not-judged");
    await s.advanceTo("Thu 03:00");
    expect(statusOn(owner, gym, s.date("Wed"))).toBe("missed");
  });

  test("after a move east the open day stays the owner's to do until it's due, then the next day, in the new timezone", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    s.setClockTo("Mon 18:00");
    await owner.setTimezone("Europe/London");

    // Tuesday opened in London at 19:00 New York time, while Monday is still open.
    await s.advanceTo("Mon 20:00");
    expect(cards(owner, "to-do")).toEqual([expect.objectContaining({ occurrenceDate: s.date("Mon") })]);

    await s.advanceTo("Tue 00:00");
    expect(statusOn(owner, gym, s.date("Mon"))).toBe("missed");
    expect(cards(owner, "to-do")).toEqual([
      expect.objectContaining({ occurrenceDate: s.date("Tue"), dueAt: s.at("Tue 19:00") }),
    ]);
    await s.advanceTo("Tue 19:00");
    expect(statusOn(owner, gym, s.date("Tue"))).toBe("missed");
  });

  test("a move east never makes a day due before the move: today in the new timezone keeps the old one", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY, { dates: { dueBy: "09:00" } });
    s.setClockTo("Mon 20:00");

    // 10:00 on Tuesday in Tokyo: Tuesday's 09:00 there has passed, but Tuesday is due at 09:00 in New York.
    await owner.setTimezone("Asia/Tokyo");

    await s.advanceTo("Tue 08:59");
    expect(statusOn(owner, gym, s.date("Tue"))).toBe("not-judged");
    expect(cards(owner, "to-do")).toEqual([
      expect.objectContaining({ occurrenceDate: s.date("Tue"), dueAt: s.at("Tue 09:00") }),
    ]);
    await s.advanceTo("Tue 09:00");
    expect(statusOn(owner, gym, s.date("Tue"))).toBe("missed");
    // Wednesday is Tokyo's: due at 09:00 there, 19:00 on Tuesday in New York.
    await s.advanceTo("Tue 19:00");
    expect(statusOn(owner, gym, s.date("Wed"))).toBe("missed");
  });

  test("a Weekly count week that is open keeps its end, and its Sunday, after a move east", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", { kind: "weekly-count", target: 2 });
    s.setClockTo("Sun+1 18:00");
    // 23:00 on Sunday in London.
    await owner.setTimezone("Europe/London");

    // 01:00 on Monday in London, still Sunday for the week.
    await s.advanceTo("Sun+1 20:00");
    await reviewer.decide(await submit(owner, piano), { kind: "approve" });
    await s.advanceTo("Sun+1 23:59");
    expect(owed(owner)).toBe(0);

    await s.advanceTo("Mon+2 00:00");
    expect(owed(owner)).toBe(500);
  });
});
