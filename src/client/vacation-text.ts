// How a vacation's dates, pacts and reviewers are written on Profile, in
// Plan a vacation and on its review item.

import type { Json } from "../shared/api.ts";
import type { EvidenceKind, LocalDate, Schedule, VacationOccurrence, VacationPacts } from "../shared/types.ts";
import { listNames } from "./change-terms.tsx";
import { dateSpan, formatDate, monthDay } from "./format.ts";

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

/** What a pact on vacation gives up: its head line and a line per week that runs past the dates. */
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
  if (schedule.kind === "weekly-count") {
    return {
      head:
        first && last
          ? `${plural(covered.length, "week", "weeks")} off · ${dateSpan(first.date, last.through ?? last.date)}`
          : "No whole weeks off",
      lines: covered
        .filter((week) => week.date < from || (week.through ?? week.date) > to)
        .map((week) => `${weekOf(week.date)}: whole week off`),
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
  switch (kind) {
    case "oura":
      return ["night", "nights"];
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
