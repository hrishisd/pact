// Bill arithmetic: when bills are made and fall due, and what's Overdue.

import { addDays } from "../shared/calendar.ts";
import type { LocalDate } from "../shared/types.ts";
import { localDateOf, wallTime, weekdayOf } from "./calendar.ts";
import { EXCUSE_WINDOW_MS } from "./pact-rules.ts";

/** How long after its Wednesday a bill is due. */
export const BILL_TERM_DAYS = 7;

/** Bills are made on Wednesdays at this time, in the owner's timezone, and fall due at it. */
const BILL_TIME = { hour: 18, minute: 0 } as const;

export const BILL_CLOCK = `${String(BILL_TIME.hour).padStart(2, "0")}:${String(BILL_TIME.minute).padStart(2, "0")}`;

/** A bill as the ledger, Today and overdue reminders read it. */
export interface BillState {
  id: string;
  /** The Wednesday it was made, "YYYY-MM-DD" in the owner's timezone. */
  billedOn: LocalDate;
  dueAt: Date;
  /** Its penalties less what approved payments have paid of them. */
  unpaidCents: number;
  /** `unpaidCents` less what payments awaiting approval cover. */
  uncoveredCents: number;
}

/**
 * What's Overdue at `now`: the uncovered part of bills past due, and the
 * oldest such bill. `spellStartedAt` is when the current spell of being
 * Overdue began: the due time of the oldest bill past due that approved
 * payments haven't paid, covered or not. Null when nothing is Overdue.
 * Bills are oldest first.
 */
export function overdueOf(
  bills: BillState[],
  now: Date,
): { cents: number; billedOn: LocalDate; dueAt: Date; spellStartedAt: Date } | null {
  const pastDue = bills.filter((bill) => bill.dueAt.getTime() <= now.getTime());
  const overdue = pastDue.filter((bill) => bill.uncoveredCents > 0);
  const [oldest] = overdue;
  if (!oldest) return null;
  // An uncovered bill is unpaid too, so there's always one.
  const spellStart = pastDue.find((bill) => bill.unpaidCents > 0)!;
  return {
    cents: sum(overdue.map((bill) => bill.uncoveredCents)),
    billedOn: oldest.billedOn,
    dueAt: oldest.dueAt,
    spellStartedAt: spellStart.dueAt,
  };
}

/**
 * What's billed and not due yet at `now`, less payments awaiting approval:
 * that part, and the soonest due bill's due time and Wednesday. Null when
 * there's none. Bills are oldest first.
 */
export function billDueOf(
  bills: BillState[],
  now: Date,
): { amountCents: number; dueAt: Date; billedOn: LocalDate } | null {
  const due = bills.filter((bill) => bill.dueAt.getTime() > now.getTime() && bill.uncoveredCents > 0);
  const [soonest] = due;
  if (!soonest) return null;
  return { amountCents: sum(due.map((bill) => bill.uncoveredCents)), dueAt: soonest.dueAt, billedOn: soonest.billedOn };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Wednesday `date` (or any day) at the bill time, in `timezone`. */
export function billInstant(date: LocalDate, timezone: string): Date {
  return wallTime(date, BILL_TIME.hour, BILL_TIME.minute, timezone);
}

/** The Wednesdays whose bill time falls after `from` and by `to`, in `timezone`. */
export function billDays(from: Date, to: Date, timezone: string): LocalDate[] {
  const days: LocalDate[] = [];
  const last = localDateOf(to, timezone);
  for (let date = localDateOf(from, timezone); date <= last; date = addDays(date, 1)) {
    if (weekdayOf(date) !== "wed") continue;
    const at = billInstant(date, timezone).getTime();
    if (at > from.getTime() && at <= to.getTime()) days.push(date);
  }
  return days;
}

/**
 * The Wednesday whose bill a penalty whose excuse window opens at
 * `windowOpens` goes on, if nothing excuses it: the first bill time after
 * both its 48-hour window and `now`.
 */
export function nextBillDay(windowOpens: Date, now: Date, timezone: string): LocalDate {
  const after = Math.max(windowOpens.getTime() + EXCUSE_WINDOW_MS - 1, now.getTime());
  let date = localDateOf(new Date(after), timezone);
  while (weekdayOf(date) !== "wed" || billInstant(date, timezone).getTime() <= after) date = addDays(date, 1);
  return date;
}
