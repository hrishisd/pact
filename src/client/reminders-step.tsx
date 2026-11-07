// The Reminders step: a pact's reminders, each a time of day (on One-time, a
// date and time, which goes off once), with Remove and "+ Add reminder". The create form, Request change and the pact page's
// own Change all show it. The core decides when each goes off.

import { addDays, parseClockTime } from "../shared/calendar.ts";
import { MAX_REMINDERS, type CreatePactRefusal } from "../shared/types.ts";
import type { Form } from "./CreatePact.tsx";
import { clockText } from "./format.ts";

/** What the step needs from the pact form: the kind and due time decide the copy and a new reminder's time. */
type RemindersForm = Pick<
  Form,
  "kind" | "weekly" | "oneTime" | "deadline" | "inBedBy" | "dueByOn" | "dueBy" | "reminders"
>;

/** The core's refusals about reminders, in the owner's words. */
export const REMINDER_PROBLEMS = {
  "invalid-reminders": "Pick a time for each reminder, or remove it.",
  "reminder-after-due-time": "A reminder is at or after the due time, so it would never go off. Make it earlier.",
} satisfies Partial<Record<CreatePactRefusal, string>>;

/**
 * A new reminder's time: half an hour before the due time, or 8:00pm with
 * none; on One-time, on the deadline's date (or the day before, for a
 * deadline before 12:30am).
 */
function suggestedReminder(form: RemindersForm): string {
  const due = form.kind === "oura" ? form.inBedBy : form.dueByOn ? form.dueBy : "";
  const { hour, minute } = due === "" ? { hour: 20, minute: 30 } : parseClockTime(due);
  const before = hour * 60 + minute - 30;
  const minutes = (before + 24 * 60) % (24 * 60);
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  if (!oneTime(form)) return time;
  if (form.deadline === "") return "";
  return `${before < 0 ? addDays(form.deadline, -1) : form.deadline}T${time}`;
}

function oneTime(form: RemindersForm): boolean {
  return form.kind === "camera" && form.oneTime;
}

export function RemindersStep({
  form,
  onReminders,
  hint,
}: {
  form: RemindersForm;
  onReminders: (reminders: string[]) => void;
  /** A line after the default one, such as what changing them does. */
  hint?: string;
}) {
  const { reminders } = form;
  const oura = form.kind === "oura";
  const due = oura
    ? `your in-bed-by time${form.inBedBy === "" ? "" : `, ${clockText(form.inBedBy)}`}`
    : form.dueByOn && form.dueBy !== ""
      ? `the due-by time, ${clockText(form.dueBy)}`
      : "midnight";
  const set = (index: number, time: string) => onReminders(reminders.map((r, i) => (i === index ? time : r)));
  const dated = oneTime(form);
  return (
    <>
      <h2>Reminders</h2>
      <div className="field">
        <span>Push notification at</span>
        {reminders.length === 0 && <small>No reminders yet.</small>}
        {reminders.map((time, index) => (
          <div key={index} className="remrow">
            <input
              className={dated ? "inp" : "inp time-inp"}
              type={dated ? "datetime-local" : "time"}
              aria-label={`Reminder ${index + 1}`}
              value={time}
              max={dated && form.deadline !== "" ? `${form.deadline}T23:59` : undefined}
              onChange={(e) => set(index, e.target.value)}
            />
            <button className="btn sm" onClick={() => onReminders(reminders.filter((_, i) => i !== index))}>
              Remove
            </button>
          </div>
        ))}
      </div>
      {reminders.length < MAX_REMINDERS && (
        <button className="btn sm self-start" onClick={() => onReminders([...reminders, suggestedReminder(form)])}>
          + Add reminder
        </button>
      )}
      <small className="muted">
        {oura
          ? `They go off every scheduled night before ${due}, even if you're already in bed. Pact can't tell until your ring syncs, usually the next morning.`
          : form.kind === "anki"
            ? `They go off on scheduled days before ${due}, only while the deck isn't finished as of Pact's last check, and say how many cards are left.`
            : dated
              ? `Each goes off once, on its date, before ${due} on the deadline, only if you haven't submitted a photo yet.`
              : form.weekly
                ? `They go off each day before ${due} that you haven't submitted a photo, until the week's target is met.`
                : `They go off on scheduled days before ${due}, only if you haven't submitted a photo yet.`}
        {hint && ` ${hint}`}
      </small>
    </>
  );
}
