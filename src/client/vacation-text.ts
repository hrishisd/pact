// How a vacation's dates, pacts and reviewers are written, on Profile and
// in Plan a vacation.

import type { Json } from "../shared/api.ts";
import type { LocalDate, VacationPacts } from "../shared/types.ts";
import { listNames } from "./change-terms.tsx";
import { formatDate } from "./format.ts";

/** "Dec 20", from `formatDate`'s "Sun Dec 20". */
export function monthDay(date: LocalDate): string {
  return formatDate(date).slice(4);
}

/** "Dec 20 – Jan 2", "Dec 20 – 26" within one month, or "Dec 20" for one day. */
export function dateSpan(from: LocalDate, to: LocalDate): string {
  if (from === to) return monthDay(from);
  const [toMonth, toDay] = monthDay(to).split(" ");
  return monthDay(from).startsWith(`${toMonth} `)
    ? `${monthDay(from)} – ${toDay}`
    : `${monthDay(from)} – ${monthDay(to)}`;
}

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
