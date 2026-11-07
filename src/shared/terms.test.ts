import { describe, expect, test } from "vitest";
import { termsOf } from "./terms.ts";
import {
  EVIDENCE_KINDS,
  type CurrentTerms,
  type EvidenceKind,
  type PactChange,
  type PactTerms,
  type Schedule,
} from "./types.ts";

type FullPact = CurrentTerms & Pick<PactTerms, "reminders">;

/**
 * Which evidence kinds' changes carry each term. It names every key of
 * `PactChange`, so a new term won't compile until it's listed here.
 */
const KINDS_WITH: { [K in keyof Required<PactChange>]: EvidenceKind[] } = {
  name: ["camera", "oura", "anki"],
  description: ["camera", "oura", "anki"],
  inBedBy: ["oura"],
  dueBy: ["camera", "anki"],
  ankiDeckId: ["anki"],
  startDate: ["camera", "oura", "anki"],
  endDate: ["camera", "oura", "anki"],
  reminders: ["camera", "oura", "anki"],
  schedule: ["camera", "oura", "anki"],
  penaltyCents: ["camera", "oura", "anki"],
  recipientId: ["camera", "oura", "anki"],
  reviewerIds: ["camera", "oura", "anki"],
  // The owner's words for the reviewers, never a term of the pact.
  note: [],
};

const shared = {
  name: "Gym",
  description: "A photo of Gym",
  startDate: "2026-01-05",
  endDate: "2026-03-01",
  penaltyCents: 500,
  recipient: { id: "recipient-1", name: "Sam" },
  reviewers: [
    { id: "account-2", name: "Ana" },
    { id: "account-3", name: "Ben" },
  ],
  reminders: ["18:00", "21:30"],
};
const days: Extract<Schedule, { kind: "fixed-days" }> = { kind: "fixed-days", days: ["mon", "wed"] };

/** A pact of each kind with every optional term set. */
const FULL = {
  camera: { ...shared, evidenceKind: "camera", schedule: days, dueBy: "21:00" },
  oura: { ...shared, evidenceKind: "oura", schedule: days, inBedBy: "23:00" },
  anki: {
    ...shared,
    evidenceKind: "anki",
    schedule: days,
    dueBy: "02:00",
    anki: { deckId: "1700000000001", deckName: "Spanish", deckMissing: false, rolloverHour: 4 },
  },
} satisfies Record<EvidenceKind, FullPact>;

describe("termsOf", () => {
  test.each([...EVIDENCE_KINDS])("copies every term of a %s pact", (kind) => {
    const expected = Object.entries(KINDS_WITH)
      .filter(([, kinds]) => kinds.includes(kind))
      .map(([key]) => key)
      .sort();
    expect(Object.keys(termsOf(FULL[kind])).sort()).toEqual(expected);
  });

  test("copies each term's value", () => {
    const common = {
      name: "Gym",
      description: "A photo of Gym",
      startDate: "2026-01-05",
      endDate: "2026-03-01",
      penaltyCents: 500,
      recipientId: "recipient-1",
      reviewerIds: ["account-2", "account-3"],
      reminders: ["18:00", "21:30"],
      schedule: days,
    };
    expect(termsOf(FULL.camera)).toEqual({ ...common, dueBy: "21:00" });
    expect(termsOf(FULL.oura)).toEqual({ ...common, inBedBy: "23:00" });
    expect(termsOf(FULL.anki)).toEqual({ ...common, dueBy: "02:00", ankiDeckId: "1700000000001" });
  });

  test("leaves out the dates and due-by time a pact doesn't have", () => {
    const terms = termsOf({ ...FULL.camera, startDate: null, endDate: null, dueBy: null });
    expect(terms).not.toHaveProperty("startDate");
    expect(terms).not.toHaveProperty("endDate");
    expect(terms).not.toHaveProperty("dueBy");
  });
});
