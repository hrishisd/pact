import { describe, expect, test } from "vitest";
import { termsOfForm, type Form } from "./pact-form.ts";

const FORM: Form = {
  kind: "camera",
  inBedBy: "",
  ankiDeckId: null,
  ankiDeckName: "",
  named: true,
  name: " Gym ",
  description: " Me at the gym ",
  scheduleKind: "fixed-days",
  days: ["mon", "wed"],
  target: 4,
  deadline: "2026-11-25",
  submitAnytime: true,
  dueByOn: true,
  dueBy: "21:00",
  startDate: "2026-11-10",
  endDate: "2026-12-31",
  penalty: "2.50",
  recipientId: "r1",
  reviewerIds: ["f1"],
  reminders: ["20:30"],
};

describe("termsOfForm: the terms Create, Save and Request change send", () => {
  test("a Camera pact on Fixed days sends every term it has, trimmed", () => {
    expect(termsOfForm(FORM)).toEqual({
      name: "Gym",
      description: "Me at the gym",
      dueBy: "21:00",
      startDate: "2026-11-10",
      endDate: "2026-12-31",
      schedule: { kind: "fixed-days", days: ["mon", "wed"] },
      penaltyCents: 250,
      recipientId: "r1",
      reviewerIds: ["f1"],
      reminders: ["20:30"],
    });
  });

  test("One-time has a due-by time but no start or end date", () => {
    const terms = termsOfForm({ ...FORM, scheduleKind: "one-time" });
    expect(terms).toMatchObject({
      dueBy: "21:00",
      schedule: { kind: "one-time", deadline: "2026-11-25", submitAnytime: true },
    });
    expect(terms).not.toHaveProperty("startDate");
    expect(terms).not.toHaveProperty("endDate");
  });

  test("Oura Ring has no due-by time or description, and Fixed days whatever Camera's schedule was", () => {
    const terms = termsOfForm({ ...FORM, kind: "oura", inBedBy: "23:00", scheduleKind: "weekly-count" });
    expect(terms).toMatchObject({
      description: "",
      inBedBy: "23:00",
      schedule: { kind: "fixed-days", days: ["mon", "wed"] },
      startDate: "2026-11-10",
    });
    expect(terms).not.toHaveProperty("dueBy");
  });

  test("Anki sends its deck once picked, and Fixed days whatever Camera's schedule was", () => {
    expect(termsOfForm({ ...FORM, kind: "anki", ankiDeckId: "2", scheduleKind: "one-time" })).toMatchObject({
      description: "",
      ankiDeckId: "2",
      dueBy: "21:00",
      schedule: { kind: "fixed-days", days: ["mon", "wed"] },
      endDate: "2026-12-31",
    });
    expect(termsOfForm({ ...FORM, kind: "anki" })).not.toHaveProperty("ankiDeckId");
  });

  test("an unset due-by and dates are left out", () => {
    const terms = termsOfForm({ ...FORM, dueByOn: false, startDate: "", endDate: "" });
    expect(terms).not.toHaveProperty("dueBy");
    expect(terms).not.toHaveProperty("startDate");
    expect(terms).not.toHaveProperty("endDate");
  });

  test("an amount that isn't one, or no recipient, stops them being sent", () => {
    expect(termsOfForm({ ...FORM, penalty: "five" })).toEqual({ problem: "no-amount" });
    expect(termsOfForm({ ...FORM, recipientId: null })).toEqual({ problem: "no-recipient" });
  });
});
