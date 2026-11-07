// The pact form's fields, as Create pact, Edit, Request change and the pact
// page's own Change on the reminders hold them.

import type { EvidenceKind, Schedule, Weekday } from "../shared/types.ts";

export interface Form {
  kind: EvidenceKind;
  /** Oura Ring: "HH:MM" as the time field gives it, or "" until picked. */
  inBedBy: string;
  /** Anki only: the deck's id, or null until picked, and its full name as the deck list gave it. */
  ankiDeckId: string | null;
  ankiDeckName: string;
  /** Whether the owner typed the name; until then a bedtime pact's name follows its in-bed-by time, an Anki pact's its deck. */
  named: boolean;
  name: string;
  description: string;
  /**
   * The kind of schedule picked on Camera. It stays as picked when the
   * evidence kind changes, so going back to Camera finds it; read it through
   * `scheduleKindOf`.
   */
  scheduleKind: Schedule["kind"];
  /** Fixed days: the days picked. */
  days: Weekday[];
  /** Weekly count: the days a week. */
  target: number;
  /** One-time: "YYYY-MM-DD" as the date field gives it, or "" until picked. */
  deadline: string;
  /** One-time only: evidence counts from creation until the deadline, rather than on its date only. */
  submitAnytime: boolean;
  /** Camera and Anki: whether evidence is due by a set time instead of midnight. */
  dueByOn: boolean;
  /** "HH:MM" as the time field gives it, or "" until picked. */
  dueBy: string;
  /** "YYYY-MM-DD" as the date field gives it, or "" for none. */
  startDate: string;
  endDate: string;
  /** As typed, in dollars: "5" or "2.50". */
  penalty: string;
  recipientId: string | null;
  reviewerIds: string[];
  /** "HH:MM" each as the time field gives it (on One-time, "YYYY-MM-DDTHH:MM"), or "" until picked. */
  reminders: string[];
}

/** The kind of schedule the form makes: Weekly count and One-time are Camera only, so the others make Fixed days. */
export function scheduleKindOf(form: Pick<Form, "kind" | "scheduleKind">): Schedule["kind"] {
  return form.kind === "camera" ? form.scheduleKind : "fixed-days";
}
