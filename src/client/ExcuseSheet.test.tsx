import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ExcusePreviewResponse, Json, PactResponse } from "../shared/api.ts";
import { WEEKDAYS, type ExcuseDay, type PactTerms } from "../shared/types.ts";
import { ExcuseSheet } from "./ExcuseSheet.tsx";
import { cameraPact, renderWithUser, stubApi } from "./testing/render.tsx";

// Mon Jan 5 2026, 10am in New York.
const NOW = "2026-01-05T15:00:00Z";
const TIMEZONE = "America/New_York";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
});

function pactAnswer(pact = cameraPact()): () => Promise<PactResponse> {
  return async () => ({ ok: true, pact });
}

/** The sheet's text once the preview has come and its footer says what the excuse covers. */
async function sheetText(): Promise<string> {
  const sheet = await screen.findByRole("dialog");
  await within(sheet).findByText(/^Covers /);
  return sheet.textContent ?? "";
}

describe("ExcuseSheet", () => {
  test("opened on a Missed day, that day is the one shown, with its held penalty and the time left to file", async () => {
    // Sun Jan 4, judged Missed at midnight; the excuse window runs 48 hours from then.
    const preview: ExcusePreviewResponse = {
      ok: true,
      preview: {
        covered: [
          {
            date: "2026-01-04",
            status: {
              kind: "missed",
              penaltyCents: 500,
              excusableUntil: "2026-01-07T05:00:00Z",
              cover: null,
              phase: "past-due",
            },
          },
        ],
        skipped: [],
        heldCents: 500,
      },
    };
    const everyDay = { ...cameraPact(), schedule: { kind: "fixed-days" as const, days: [...WEEKDAYS] } };
    const api = stubApi({ pact: pactAnswer(everyDay), excusePreview: async () => preview });

    renderWithUser(
      <ExcuseSheet
        pactId="gym"
        pactName="Gym"
        day="2026-01-04"
        timezone={TIMEZONE}
        onClose={() => undefined}
        onFiled={() => undefined}
      />,
    );

    const text = await sheetText();
    screen.getByRole("heading", { name: "Excuse Gym, Sun Jan 4" });
    expect(api.excusePreview).toHaveBeenCalledWith("gym", { from: "2026-01-04", to: "2026-01-04" });
    expect(text).toContain("Gym is every day · $5 per miss");
    expect(text).toContain("Sun Jan 4Missed");
    expect(text).toContain("$5 held while Ana decides");
    expect(text).toContain("38h left to file an excuse");
    expect(text).toContain("Covers 1 day. You won't owe the $5 for this day unless the excuse is rejected.");
  });

  test("opened on a day of a Weekly count pact, its week is the one shown, and excusing it excuses the week", async () => {
    // Opened on Wed Jan 7; the core dates the week by its Monday.
    const preview: ExcusePreviewResponse = {
      ok: true,
      preview: {
        covered: [
          {
            date: "2026-01-05",
            through: "2026-01-11",
            status: {
              kind: "not-judged",
              opensAt: "2026-01-05T05:00:00Z",
              dueAt: "2026-01-12T05:00:00Z",
              evidenceWaiting: false,
              cover: null,
              phase: "open",
            },
          },
        ],
        skipped: [],
        heldCents: 0,
      },
    };
    const api = stubApi({
      pact: pactAnswer({
        ...cameraPact(),
        evidenceKind: "camera",
        dueBy: null,
        schedule: { kind: "weekly-count", target: 3 },
        history: { kind: "periods", periods: [] },
      }),
      excusePreview: async () => preview,
    });

    renderWithUser(
      <ExcuseSheet
        pactId="gym"
        pactName="Gym"
        day="2026-01-07"
        timezone={TIMEZONE}
        onClose={() => undefined}
        onFiled={() => undefined}
      />,
    );

    const text = await sheetText();
    expect(api.excusePreview).toHaveBeenCalledWith("gym", { from: "2026-01-07", to: "2026-01-07" });
    expect(text).toContain("Gym is 3× per week · $5 per miss. Excusing any day excuses the whole week.");
    expect(text).toContain("Week of Mon Jan 5");
    expect(text).toContain("Due by Sunday");
    expect(text).toContain("Covers 1 week.");
    expect(text).not.toContain("held");
  });

  test("on a Weekly count pact, the footer counts weeks", async () => {
    const week = (date: string, through: string) => ({
      date,
      through,
      status: {
        kind: "missed" as const,
        penaltyCents: 500,
        excusableUntil: "2026-01-06T05:00:00Z",
        cover: null,
        phase: "past-due" as const,
      },
    });
    stubApi({
      pact: pactAnswer({
        ...cameraPact(),
        evidenceKind: "camera",
        dueBy: null,
        schedule: { kind: "weekly-count", target: 3 },
        history: { kind: "periods", periods: [] },
      }),
      excusePreview: async () => ({
        ok: true,
        preview: { covered: [week("2025-12-29", "2026-01-04")], skipped: [], heldCents: 500 },
      }),
    });

    renderWithUser(
      <ExcuseSheet
        pactId="gym"
        pactName="Gym"
        day="2026-01-01"
        timezone={TIMEZONE}
        onClose={() => undefined}
        onFiled={() => undefined}
      />,
    );

    expect(await sheetText()).toContain(
      "Covers 1 week. You won't owe the $5 for this week unless the excuse is rejected.",
    );
  });

  describe("opened from the page of an Ended pact", () => {
    const ended: Json<PactTerms> = {
      ...cameraPact(),
      schedule: { kind: "fixed-days", days: [...WEEKDAYS] },
      stage: "ended",
      endedAt: "2026-01-05T05:00:00Z",
    };
    /** A day of Gym judged Missed at the end of it, so excusable for 48 hours from then. */
    const missed = (date: string, judged: string): Json<ExcuseDay> => ({
      date,
      status: {
        kind: "missed",
        penaltyCents: 500,
        excusableUntil: new Date(Date.parse(judged) + 48 * 3600_000).toISOString(),
        cover: null,
        phase: "past-due",
      },
    });
    const sunday = missed("2026-01-04", "2026-01-05T05:00:00Z");
    const saturday = missed("2026-01-03", "2026-01-04T05:00:00Z");
    const covering = (...days: Json<ExcuseDay>[]): ExcusePreviewResponse => ({
      ok: true,
      preview: { covered: days, skipped: [], heldCents: 500 * days.length },
    });
    const openSheet = () =>
      renderWithUser(
        <ExcuseSheet
          pactId="gym"
          pactName="Gym"
          timezone={TIMEZONE}
          onClose={() => undefined}
          onFiled={() => undefined}
        />,
      );

    test("with one day to excuse, it opens on that day, with no later days and no Days ahead", async () => {
      const api = stubApi({
        pact: pactAnswer(ended),
        excuseOptions: async () => ({
          ok: true,
          options: { today: "2026-01-05", daysAhead: false, recentDays: [sunday] },
        }),
        excusePreview: async () => covering(sunday),
      });
      openSheet();

      const text = await sheetText();
      screen.getByRole("heading", { name: "Excuse Gym, Sun Jan 4" });
      expect(api.excusePreview).toHaveBeenCalledWith("gym", { from: "2026-01-04", to: "2026-01-04" });
      expect(text).toContain("$5 held while Ana decides");
      expect(text).toContain("38h left to file an excuse");
      expect(text).toContain("Covers 1 day. You won't owe the $5 for this day unless the excuse is rejected.");
      expect(text).not.toContain("Which day?");
      expect(text).not.toContain("Days ahead");
      expect(screen.queryByRole("button", { name: /Later days too/ })).toBeNull();
    });

    test("with several days, it asks which, with no Days ahead", async () => {
      stubApi({
        pact: pactAnswer(ended),
        excuseOptions: async () => ({
          ok: true,
          options: { today: "2026-01-05", daysAhead: false, recentDays: [sunday, saturday] },
        }),
        excusePreview: async () => covering(sunday),
      });
      openSheet();

      const text = await sheetText();
      screen.getByRole("heading", { name: "Excuse Gym" });
      expect(text).toContain("Which day?");
      expect(screen.getAllByRole("radio")).toHaveLength(2);
      expect(text).toContain("$5 · 14h left to file an excuse");
      expect(text).not.toContain("Days ahead");
    });

    test("with no day left to excuse, it says so", async () => {
      stubApi({
        pact: pactAnswer(ended),
        excuseOptions: async () => ({ ok: true, options: { today: "2026-01-05", daysAhead: false, recentDays: [] } }),
      });
      openSheet();

      expect(await screen.findByText("No day of this pact can be excused now.")).toBeTruthy();
    });
  });

  test("opened from an Active pact's page, it offers Days ahead, and a footer for several days says these days", async () => {
    const api = stubApi({
      pact: pactAnswer({ ...cameraPact(), schedule: { kind: "fixed-days", days: [...WEEKDAYS] } }),
      excuseOptions: async () => ({ ok: true, options: { today: "2026-01-05", daysAhead: true, recentDays: [] } }),
      excusePreview: async () => ({
        ok: true,
        preview: {
          covered: [
            {
              date: "2026-01-04",
              status: {
                kind: "missed",
                penaltyCents: 500,
                excusableUntil: "2026-01-07T05:00:00Z",
                cover: null,
                phase: "past-due",
              },
            },
            {
              date: "2026-01-03",
              status: {
                kind: "missed",
                penaltyCents: 500,
                excusableUntil: "2026-01-06T05:00:00Z",
                cover: null,
                phase: "past-due",
              },
            },
          ],
          skipped: [],
          heldCents: 1000,
        },
      }),
    });
    renderWithUser(
      <ExcuseSheet
        pactId="gym"
        pactName="Gym"
        timezone={TIMEZONE}
        onClose={() => undefined}
        onFiled={() => undefined}
      />,
    );

    const text = await sheetText();
    expect(api.excusePreview).toHaveBeenCalledWith("gym", { from: "2026-01-05", to: "2026-01-05" });
    expect(text).toContain("Days ahead");
    expect(text).toContain("Covers 2 days. You won't owe the $10 for these days unless the excuse is rejected.");
  });
});
