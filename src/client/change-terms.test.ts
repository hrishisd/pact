import { describe, expect, test } from "vitest";
import type { ApprovalReason } from "../shared/types.ts";
import { effectText } from "./change-terms.tsx";

describe("effectText", () => {
  const friends = (...names: string[]) => names.map((name, i) => ({ id: `${name}-${i}`, name }));
  const reviewers = (added: string[], removed: string[]) => ({
    term: "reviewers" as const,
    before: [],
    after: [],
    added: friends(...added),
    removed: friends(...removed),
  });

  test.each<[ApprovalReason, string]>([
    ["defines-photo", "Needs approval: it defines what a photo must show"],
    ["deck-changed", "Needs approval: any change of deck"],
    ["later-time", "Needs approval: a later time"],
    ["due-at-midnight", "Needs approval: due at midnight instead"],
    ["fewer-days", "Needs approval: fewer days"],
    ["lower-target", "Needs approval: a lower target"],
    ["submit-anytime-on", "Needs approval: Submit anytime"],
    ["later-deadline", "Needs approval: a later deadline"],
    ["date-moved", "Needs approval: any change of date"],
    ["start-added", "Needs approval: adding a start date"],
    ["later-start", "Needs approval: a later start"],
    ["end-added", "Needs approval: adding an end date"],
    ["earlier-end", "Needs approval: an earlier end"],
    ["lower-penalty", "Needs approval: a lower penalty"],
    ["recipient-changed", "Needs approval: any change of recipient"],
  ])("%s reads %j", (reason, text) => {
    expect(effectText({ term: "penalty", before: 500, after: 200, effect: "needs-approval", reason })).toBe(text);
  });

  test("stricter and at-once terms", () => {
    expect(effectText({ term: "penalty", before: 500, after: 700, effect: "stricter" })).toBe("Stricter");
    expect(effectText({ term: "name", before: "Gym", after: "Run", effect: "at-once" })).toBe("Applies now");
  });

  test("reviewers: who's removed needs approval, and who's added joins or hears about it", () => {
    const removing = { effect: "needs-approval", reason: "reviewers-removed" } as const;
    expect(effectText({ ...reviewers(["Cy"], []), effect: "at-once" })).toBe("Applies now");
    expect(effectText({ ...reviewers(["Cy", "Di"], []), effect: "at-once" })).toBe("Applies now");
    expect(effectText({ ...reviewers([], ["Ann", "Bob", "Eve"]), ...removing })).toBe(
      "Needs approval: removing Ann, Bob, and Eve",
    );
    expect(effectText({ ...reviewers(["Cy"], ["Ann"]), ...removing })).toBe(
      "Needs approval: removing Ann. Cy joins now",
    );
    expect(effectText({ ...reviewers(["Cy", "Di"], ["Ann"]), ...removing })).toBe(
      "Needs approval: removing Ann. Cy and Di join now",
    );
  });
});
