import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ExcusePreviewResponse, PactResponse } from "../shared/api.ts";
import { WEEKDAYS } from "../shared/types.ts";
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
    expect(text).toContain("Covers 1 day. $5 is held off what you owe until it's decided.");
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
        history: { kind: "weekly-count", weeks: [] },
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
    expect(text).not.toContain("held");
  });
});
