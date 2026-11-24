// The pact form's fields, as Create pact, Edit, Request change and the pact
// page's own Change on the reminders hold them, and how they turn into the
// terms the core takes.

import { parseDatedReminder } from "../shared/calendar.ts";
import type { Json } from "../shared/api.ts";
import type { EvidenceKind, PactChange, PactTerms, Schedule, Weekday } from "../shared/types.ts";
import { termsOfKind, type Term } from "./change-terms.tsx";
import { centsInputText, parseCents } from "./format.ts";

type Pact = Json<PactTerms>;

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

export const EMPTY_FORM: Form = {
  kind: "camera",
  inBedBy: "",
  ankiDeckId: null,
  ankiDeckName: "",
  named: false,
  name: "",
  description: "",
  scheduleKind: "fixed-days",
  days: [],
  target: 3,
  deadline: "",
  submitAnytime: false,
  dueByOn: false,
  dueBy: "",
  startDate: "",
  endDate: "",
  penalty: "",
  recipientId: null,
  reviewerIds: [],
  reminders: [],
};

export function formOf(pact: Pact): Form {
  const anki = pact.evidenceKind === "anki" ? pact.anki : null;
  return {
    kind: pact.evidenceKind,
    ...dueTimesForm(pact),
    ankiDeckId: anki?.deckId ?? null,
    ankiDeckName: anki?.deckName ?? "",
    named: true,
    name: pact.name,
    description: pact.description,
    scheduleKind: pact.schedule.kind,
    days: pact.schedule.kind === "fixed-days" ? pact.schedule.days : [],
    target: pact.schedule.kind === "weekly-count" ? pact.schedule.target : EMPTY_FORM.target,
    deadline: pact.schedule.kind === "one-time" ? pact.schedule.deadline : "",
    submitAnytime: pact.schedule.kind === "one-time" && pact.schedule.submitAnytime,
    startDate: pact.startDate ?? "",
    endDate: pact.endDate ?? "",
    penalty: centsInputText(pact.penaltyCents),
    recipientId: pact.recipient.id,
    reviewerIds: pact.reviewers.map((reviewer) => reviewer.id),
    reminders: pact.reminders,
  };
}

/** The form's in-bed-by and due-by fields, as a pact's terms have them. */
function dueTimesForm(terms: Pact): Pick<Form, "inBedBy" | "dueByOn" | "dueBy"> {
  if (terms.evidenceKind === "oura") return { inBedBy: terms.inBedBy, dueByOn: false, dueBy: "" };
  return { inBedBy: "", dueByOn: terms.dueBy !== null, dueBy: terms.dueBy ?? "" };
}

/** The form's schedule as the core takes it. */
export function scheduleOf(form: Form): Schedule {
  switch (scheduleKindOf(form)) {
    case "fixed-days":
      return { kind: "fixed-days", days: form.days };
    case "weekly-count":
      return { kind: "weekly-count", target: form.target };
    case "every-2-weeks":
      return { kind: "every-2-weeks" };
    case "once-a-month":
      return { kind: "once-a-month" };
    case "one-time":
      return { kind: "one-time", deadline: form.deadline, submitAnytime: form.submitAnytime };
  }
}

/** The terms the form's evidence kind and kind of schedule have. */
export function termsOfFormKind(form: Form): Term[] {
  return termsOfKind({ evidenceKind: form.kind, schedule: { kind: scheduleKindOf(form) } });
}

/** The form's optional times as the core takes them: each left out when it isn't set, or its pact doesn't have it. */
export function optionalTimes(form: Form): { dueBy?: string; startDate?: string; endDate?: string } {
  const terms = termsOfFormKind(form);
  return {
    ...(terms.includes("due-by") && form.dueByOn && { dueBy: form.dueBy }),
    ...(terms.includes("start-date") && form.startDate !== "" && { startDate: form.startDate }),
    ...(terms.includes("end-date") && form.endDate !== "" && { endDate: form.endDate }),
  };
}

/**
 * The form's terms as the core takes them, at Create, Save or Request
 * change, or what stops them being sent: an amount that isn't one, or no
 * recipient picked.
 */
export function termsOfForm(form: Form): Omit<PactChange, "note"> | { problem: "no-amount" | "no-recipient" } {
  const penaltyCents = parseCents(form.penalty);
  if (penaltyCents === null) return { problem: "no-amount" };
  if (form.recipientId === null) return { problem: "no-recipient" };
  return {
    name: form.name.trim(),
    description: form.kind === "camera" ? form.description.trim() : "",
    ...(form.kind === "oura" && { inBedBy: form.inBedBy }),
    ...(form.kind === "anki" && form.ankiDeckId !== null && { ankiDeckId: form.ankiDeckId }),
    ...optionalTimes(form),
    schedule: scheduleOf(form),
    penaltyCents,
    recipientId: form.recipientId,
    reviewerIds: form.reviewerIds,
    reminders: form.reminders,
  };
}

/**
 * The form's reminders as a schedule of kind `to` takes them: a One-time
 * pact's each have a date, the deadline's to start with.
 */
export function remindersAs(form: Form, to: Schedule["kind"]): string[] {
  const dated = to === "one-time";
  if (dated === (scheduleKindOf(form) === "one-time")) return form.reminders;
  if (!dated) return form.reminders.map((reminder) => parseDatedReminder(reminder).time);
  return form.deadline === "" ? [] : form.reminders.map((time) => (time === "" ? "" : `${form.deadline}T${time}`));
}
