// How an excuse's days are written, wherever they show: the File excuse
// sheet, the excuse page and the Excuse review item. The UI never says
// "pending".

import type { Json } from "../shared/api.ts";
import { periodKindOfSpan } from "../shared/schedules.ts";
import type { ExcuseDay, ExcuseSkipReason, LocalDate, OccurrenceStatus, PeriodKind } from "../shared/types.ts";
import {
  dateIn,
  dueDayOf,
  dueClockText,
  EXCUSE_WINDOW_TEXT,
  formatDate,
  money,
  periodName,
  thisPeriod,
} from "./format.ts";

type Status = Json<OccurrenceStatus>;

/**
 * How a heat map square looks: an outcome, a day an approved vacation
 * excuses ("vac"), or for a day not judged yet whether it's ahead, open now
 * or past due.
 */
export type Square = "satisfied" | "missed" | "excused" | "vac" | "not-judged" | "open" | "ahead";

/** A chip's colour: its `c-*` class. */
type Tone = "ok" | "excused" | "vac" | "missed" | "wait" | "todo" | "soon";

/** One occurrence as every screen shows it: its chip, its heat map square and the small line under it. */
export interface OccurrencePresentation {
  /** Null for a `compact` day not judged yet. */
  chip: { text: string; tone: Tone } | null;
  /** The chip's words, even where `compact` drops the chip: a square's label, so it says what the chip does. */
  label: string;
  square: Square;
  /** "$5 held", "Not open yet", "Due at midnight", "Not judged yet", or "". */
  note: string;
}

export interface PresentOptions {
  /** The profile's timezone, for the due time. */
  timezone: string;
  /** Compact, as in a review item's rows, where the line under the day says what's held: drops the cover wording, and the chip of a day not judged yet. */
  compact?: boolean;
  /** A period schedule's period, of this kind. */
  period?: PeriodKind;
  /** A bedtime pact's night: one past its in-bed-by time is waiting on its sleep. */
  bedtime?: boolean;
  /** A One-time pact's date: open on another day (Submit anytime), it's due on that date, not today. */
  dueOn?: LocalDate;
}

/**
 * Where an occurrence stands as of `now` (ms), the one order every screen
 * uses: its outcome; for a day not judged yet, an approved cover (Excused, or
 * Vacation), then a cover waiting for approval, then evidence waiting, then
 * where it is in time. A Missed day says which cover holds its penalty. The
 * core says where it stands; the browser clock only moves a day not judged
 * yet from Coming up to Due today to Not judged yet while the screen is open.
 */
export function presentOccurrence(status: Status, now: number, options: PresentOptions): OccurrencePresentation {
  const { timezone, compact = false, period, bedtime = false, dueOn } = options;
  const { cover } = status;
  const chip = (text: string, tone: Tone) => ({ text, tone });
  const coveredSquare: Square = cover?.kind === "vacation" ? "vac" : "excused";
  const coveredChip = cover?.kind === "vacation" ? chip("Vacation", "vac") : chip("Excused", "excused");
  switch (status.kind) {
    case "satisfied":
      return { chip: chip("Satisfied", "ok"), label: "Satisfied", square: "satisfied", note: "" };
    case "excused":
      return { chip: coveredChip, label: coveredChip.text, square: coveredSquare, note: "" };
    case "missed": {
      const held = cover?.state === "waiting";
      const label = held ? `Missed · ${cover.kind} waiting for approval` : "Missed";
      return {
        chip: chip(compact ? "Missed" : label, "missed"),
        label,
        square: "missed",
        note: held ? `${money(status.penaltyCents)} held` : `${money(status.penaltyCents)} to be held`,
      };
    }
    case "not-judged": {
      // The core's phase, moved on by the browser clock while the screen is open, never back.
      const clockPhase =
        Date.parse(status.opensAt) > now ? "ahead" : Date.parse(status.dueAt) > now ? "open" : "past-due";
      const phase = PHASES.indexOf(clockPhase) > PHASES.indexOf(status.phase) ? clockPhase : status.phase;
      const square: Square = phase === "ahead" ? "ahead" : phase === "open" ? "open" : "not-judged";
      const note =
        phase === "ahead"
          ? "Not open yet"
          : phase === "open"
            ? period === "weekly-count"
              ? "Due by Sunday"
              : period
                ? `Due by ${formatDate(dueDayOf(status.dueAt, timezone))}`
                : `Due at ${dueClockText(status.dueAt, timezone)}`
            : bedtime
              ? "No Oura data"
              : "Not judged yet";
      const shown = (c: { text: string; tone: Tone }, s: Square = square) => ({
        chip: compact ? null : c,
        label: c.text,
        square: s,
        note,
      });
      if (cover?.state === "approved") return shown(coveredChip, coveredSquare);
      if (cover?.state === "waiting")
        return shown(chip(`${cover.kind === "vacation" ? "Vacation" : "Excuse"} waiting for approval`, "wait"));
      if (status.evidenceWaiting) return shown(chip("Waiting for approval", "wait"));
      if (phase === "ahead") return shown(chip("Coming up", "soon"));
      if (phase === "open") {
        if (dueOn !== undefined && dateIn(now, timezone) !== dueOn)
          return shown(chip(`Due ${formatDate(dueOn)}`, "todo"));
        return shown(chip(period ? capitalized(thisPeriod(period)) : "Due today", "todo"));
      }
      return shown(chip(bedtime ? "No Oura data" : "Not judged yet", "soon"));
    }
  }
}

/** "This month", from "this month". */
function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A day not judged yet's phases, in the order time moves it through them. */
const PHASES: Status["phase"][] = ["ahead", "open", "past-due"];

/** An occurrence's chip, as `presentOccurrence` words it, or nothing. */
export function DayChip({ status, now, ...options }: { status: Status; now: number } & PresentOptions) {
  return <Chip chip={presentOccurrence(status, now, options).chip} />;
}

/** A presented occurrence's chip, or nothing. */
export function Chip({ chip }: { chip: OccurrencePresentation["chip"] }) {
  return chip && <span className={`chip c-${chip.tone}`}>{chip.text}</span>;
}

/** Why a day in the dates is skipped, as the sheet's Skipped rows say it. */
export const SKIP_REASON_TEXT: Record<ExcuseSkipReason, string> = {
  satisfied: "Satisfied",
  excused: "Already excused",
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
  const first = days[0];
  const last = days.at(-1);
  if (first === undefined || last === undefined) return "";
  const kind = periodKindOfSpan(first.date, first.through);
  return kind ? periodName(kind, first.date, last.date) : datesText(first.date, last.date);
}

/** One of an excuse's days: "Mon Nov 2", or for a period, its name: "Week of Mon Nov 2", "December". */
export function excuseDayText(day: Pick<Json<ExcuseDay>, "date" | "through">): string {
  const kind = periodKindOfSpan(day.date, day.through);
  return kind ? periodName(kind, day.date) : formatDate(day.date);
}
