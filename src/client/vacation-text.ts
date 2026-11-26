// How a vacation's dates, pacts and reviewers are written on Profile, in
// Plan a vacation and on its review item.

import type { Json } from "../shared/api.ts";
import { isBedtimeKind } from "../shared/evidence-kinds.ts";
import { periodKindOfSchedule } from "../shared/schedules.ts";
import type {
  EvidenceKind,
  LocalDate,
  PeriodKind,
  Schedule,
  VacationOccurrence,
  VacationPacts,
} from "../shared/types.ts";
import { dateSpan, formatDate, listNames, monthDay, periodName, periodWord } from "./format.ts";

/** "All pacts", "All recurring pacts", or the ticked pacts' names. */
export function pactsText(pacts: Json<VacationPacts>): string {
  switch (pacts.kind) {
    case "all":
      return "All pacts";
    case "all-recurring":
      return "All recurring pacts";
    case "some":
      return listNames(pacts.names);
  }
}

/** "1 day", "14 days". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Sam", from "Sam Rivera". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** What a pact on vacation gives up: its head line and a line per period that runs past the dates. */
export function coveredText(
  pact: { evidenceKind: EvidenceKind; schedule: Json<Schedule> },
  covered: Json<VacationOccurrence>[],
  from: LocalDate,
  to: LocalDate,
): { head: string; lines: string[] } {
  const { schedule } = pact;
  const first = covered[0];
  const last = covered.at(-1);
  if (schedule.kind === "one-time") {
    return first
      ? { head: `Deadline ${formatDate(schedule.deadline)} excused`, lines: ["The pact ends."] }
      : { head: `Deadline ${formatDate(schedule.deadline)} isn't during your vacation`, lines: [] };
  }
  const kind = periodKindOfSchedule(schedule);
  if (kind) {
    return {
      head:
        first && last
          ? `${periodsText(kind, covered.length)} off · ${dateSpan(first.date, last.through ?? last.date)}`
          : `No whole ${kind === "once-a-month" ? "months" : "weeks"} off`,
      lines: covered
        .filter((period) => period.date < from || (period.through ?? period.date) > to)
        .map((period) => `${periodLabel(kind, period.date)}: whole ${periodWord(kind)} off`),
    };
  }
  const [one, many] = occurrenceNames(pact.evidenceKind);
  return {
    head:
      first && last
        ? `${plural(covered.length, one, many)} off · ${dateSpan(first.date, last.date)}`
        : `No ${many} in these days`,
    lines: [],
  };
}

/** What a pact's occurrences are called, one and many: nights, Anki days, or days. */
export function occurrenceNames(kind: EvidenceKind): [string, string] {
  if (isBedtimeKind(kind)) return ["night", "nights"];
  switch (kind) {
    case "anki":
      return ["Anki day", "Anki days"];
    case "camera":
      return ["day", "days"];
  }
}

/** "Week of Dec 14". */
export function weekOf(date: LocalDate): string {
  return `Week of ${monthDay(date)}`;
}

/**
 * An occurrence on a vacation's or a review's lines: "Week of Dec 14",
 * "Nov 30 – Dec 13" or "December" for a period of `kind`, else the day.
 */
export function periodLabel(kind: PeriodKind | undefined, date: LocalDate): string {
  if (kind === undefined) return formatDate(date);
  return kind === "weekly-count" ? weekOf(date) : periodName(kind, date);
}

/** `count` periods of `kind`, in weeks or months: "1 week", "4 weeks" (two lots of 2), "3 months". */
export function periodsText(kind: PeriodKind, count: number): string {
  switch (kind) {
    case "weekly-count":
      return plural(count, "week", "weeks");
    case "every-2-weeks":
      return `${2 * count} weeks`;
    case "once-a-month":
      return plural(count, "month", "months");
  }
}
