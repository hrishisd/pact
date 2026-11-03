// The Reminders step: a pact's reminders, each a time of day, with Remove
// and "+ Add reminder". The create form, Request change and the pact page's
// own Change all show it. The core decides when each goes off.

import { MAX_REMINDERS, type CreatePactRefusal } from "../shared/types.ts";
import type { Form } from "./CreatePact.tsx";
import { clockText } from "./format.ts";

/** What the step needs from the pact form: the kind and due time decide the copy and a new reminder's time. */
type RemindersForm = Pick<Form, "kind" | "inBedBy" | "dueByOn" | "dueBy" | "reminders">;

/** The core's refusals about reminders, in the owner's words. */
export const REMINDER_PROBLEMS = {
  "invalid-reminders": "Pick a time for each reminder, or remove it.",
  "reminder-after-due-time": "A reminder is at or after the due time, so it would never go off. Make it earlier.",
} satisfies Partial<Record<CreatePactRefusal, string>>;

/** A new reminder's time: half an hour before the due time, or 8:00pm with none. */
function suggestedReminder(form: RemindersForm): string {
  const due = form.kind === "oura" ? form.inBedBy : form.dueByOn ? form.dueBy : "";
  if (due === "") return "20:00";
  const [hour, minute] = due.split(":").map(Number) as [number, number];
  const minutes = (hour * 60 + minute - 30 + 24 * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
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
  return (
    <>
      <h2>Reminders</h2>
      <div className="field">
        <span>Push notification at</span>
        {reminders.length === 0 && <small>No reminders yet.</small>}
        {reminders.map((time, index) => (
          <div key={index} className="remrow">
            <input
              className="inp time-inp"
              type="time"
              aria-label={`Reminder ${index + 1}`}
              value={time}
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
          : `They go off on scheduled days before ${due}, only if you haven't submitted a photo yet.`}
        {hint && ` ${hint}`}
      </small>
    </>
  );
}
