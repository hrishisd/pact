// How an excuse's days are written, wherever they show: the File excuse
// sheet, the excuse page and the Excuse review item. The UI never says
// "pending".

import type { Json } from "../shared/api.ts";
import type { ExcuseDay, ExcuseSkipReason, OccurrenceStatus } from "../shared/types.ts";
import { dueClockText, EXCUSE_WINDOW_TEXT, formatDate, money } from "./format.ts";

type Status = Json<OccurrenceStatus>;

/**
 * A day's chip as of `now` (ms): Satisfied, Excused, Missed (with "· excuse
 * waiting for approval" while one is), "Excuse waiting for approval" for a
 * day not judged yet with one waiting, and otherwise Due today (This week,
 * for a Weekly count `week`), Coming up or Not judged yet (No Oura data for
 * an `oura` night). A day ahead with an approved excuse already reads
 * Excused. `compact` drops the excuse wording, and the chip of a day not
 * judged yet.
 */
export function DayChip({
  status,
  now,
  compact = false,
  week = false,
  oura = false,
}: {
  status: Status;
  now: number;
  compact?: boolean;
  week?: boolean;
  /** A bedtime pact's night: one past its in-bed-by time is waiting on Oura. */
  oura?: boolean;
}) {
  // Compact, as in a review item's rows, where the line under the day says what's held.
  if (compact && status.kind === "missed") return <span className="chip c-missed">Missed</span>;
  if (compact && status.kind === "not-judged") return null;
  switch (status.kind) {
    case "satisfied":
      return <span className="chip c-ok">Satisfied</span>;
    case "excused":
      return <span className="chip c-excused">Excused</span>;
    case "missed":
      return (
        <span className="chip c-missed">
          {status.cover?.state === "waiting" ? `Missed · ${heldBy(status)} waiting for approval` : "Missed"}
        </span>
      );
    case "not-judged":
      if (status.cover?.state === "approved") return <span className="chip c-excused">Excused</span>;
      if (status.cover?.kind === "excuse" && status.cover.state === "waiting")
        return <span className="chip c-wait">Excuse waiting for approval</span>;
      if (status.evidenceWaiting) return <span className="chip c-wait">Waiting for approval</span>;
      if (Date.parse(status.opensAt) > now) return <span className="chip c-soon">Coming up</span>;
      if (Date.parse(status.dueAt) > now)
        return <span className="chip c-todo">{week ? "This week" : "Due today"}</span>;
      return <span className="chip c-soon">{oura ? "No Oura data" : "Not judged yet"}</span>;
  }
}

/** What holds a Missed day's penalty: an excuse or a vacation waiting for approval. */
function heldBy(status: Extract<Status, { kind: "missed" }>): string {
  return status.cover?.kind === "vacation" ? "vacation" : "excuse";
}

/**
 * The small line under a covered day: "$5 held", "Not open yet", "Due at
 * midnight" or at its due time in `timezone` (the profile's), "Due by
 * Sunday" for a Weekly count `week`, "Not judged yet" ("No Oura data" for an
 * `oura` night), or nothing.
 */
export function dayNote(status: Status, now: number, timezone: string, week = false, oura = false): string {
  switch (status.kind) {
    case "missed":
      return status.cover?.state === "waiting"
        ? `${money(status.penaltyCents)} held`
        : `${money(status.penaltyCents)} to be held`;
    case "not-judged":
      if (Date.parse(status.opensAt) > now) return "Not open yet";
      if (Date.parse(status.dueAt) > now)
        return week ? "Due by Sunday" : `Due at ${dueClockText(status.dueAt, timezone)}`;
      return oura ? "No Oura data" : "Not judged yet";
    case "satisfied":
    case "excused":
      return "";
  }
}

/** Why a day in the dates is skipped, as the sheet's Skipped rows say it. */
export const SKIP_REASON_TEXT: Record<ExcuseSkipReason, string> = {
  satisfied: "Satisfied",
  excused: "Already Excused",
  "on-waiting-excuse": "Already on an excuse waiting for approval",
  "on-waiting-vacation": "On a vacation waiting for approval",
  "window-closed": `Missed more than ${EXCUSE_WINDOW_TEXT} ago`,
};

/** "Mon Nov 2", or "Mon Nov 2 – Wed Nov 4" when the first and last days differ. */
export function datesText(first: string, last: string): string {
  return first === last ? formatDate(first) : `${formatDate(first)} – ${formatDate(last)}`;
}

/** "Mon Nov 2" or "Mon Nov 2 – Wed Nov 4", for an excuse's days, oldest first; "Week of Mon Nov 2" for weeks. */
export function excuseDatesText(days: Json<ExcuseDay>[]): string {
  const first = days[0]?.date;
  const last = days.at(-1)?.date;
  if (first === undefined || last === undefined) return "";
  return days[0]?.through === undefined ? datesText(first, last) : `Week of ${datesText(first, last)}`;
}

/** One of an excuse's days: "Mon Nov 2", or for a Weekly count week, "Week of Mon Nov 2". */
export function excuseDayText(day: Pick<Json<ExcuseDay>, "date" | "through">): string {
  return day.through === undefined ? formatDate(day.date) : `Week of ${formatDate(day.date)}`;
}
