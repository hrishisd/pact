// A period's reminder window, and the trip ahead that moves it: when an Every
// 2 weeks or Once a month period goes from quiet to the owner's to do.

import { addDays } from "../shared/calendar.ts";
import { lastDayOf, type PeriodSchedule } from "../shared/schedules.ts";
import type { LocalDate, Schedule, TripAhead } from "../shared/types.ts";
import { laterDate } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { coveredSql } from "./covers.ts";

/** How many days a period's reminder window runs. */
const REMINDER_WINDOW_DAYS = 7;

/**
 * The trip ahead of the pact's period dated `period` on `schedule`, as of
 * `today` (see `TripAhead`). Null with none, and on any other schedule.
 */
export function tripAhead(
  ctx: CoreContext,
  pactId: string,
  schedule: Schedule,
  period: LocalDate,
  today: LocalDate,
): TripAhead | null {
  const trips = ctx.all<{ first_day: LocalDate; last_day: LocalDate }>(
    `SELECT vacation.first_day, vacation.last_day FROM vacation
       JOIN vacation_pact ON vacation_pact.vacation_id = vacation.id AND vacation_pact.pact_id = ?
       WHERE vacation.withdrawn_at IS NULL AND (vacation.decision IS NULL OR vacation.decision = 'approved')
         AND NOT ${coveredSql("vacation_pact.pact_id", "?", "any", "cover.kind = 'vacation' AND cover.id = vacation.id")}
       ORDER BY vacation.first_day, vacation.filed_at`,
    pactId,
    period,
  );
  for (const trip of trips) {
    const ahead = tripAheadOf(schedule, period, trip.first_day, trip.last_day, today);
    if (ahead) return ahead;
  }
  return null;
}

/**
 * The vacation from `firstDay` to `lastDay` as a trip ahead of the period on
 * `schedule` dated `period`, as of `today`, given it doesn't cover the
 * period: on Every 2 weeks or Once a month, when it starts after the period's
 * first day, and after today, so the day to do it by hasn't passed, and
 * overlaps the period's last 7 days. Else null.
 */
export function tripAheadOf(
  schedule: Schedule,
  period: LocalDate,
  firstDay: LocalDate,
  lastDay: LocalDate,
  today: LocalDate,
): TripAhead | null {
  if (schedule.kind !== "every-2-weeks" && schedule.kind !== "once-a-month") return null;
  const last = lastDayOf(schedule, period);
  const ahead =
    firstDay > laterDate(period, today) && firstDay <= last && lastDay > addDays(last, -REMINDER_WINDOW_DAYS);
  return ahead ? { period, firstDay, lastDay, doItBy: addDays(firstDay, -1) } : null;
}

/**
 * The days of the period on `schedule` dated `period` that its reminders go
 * off on and its To do card shows: every day of a Weekly count week. On Every
 * 2 weeks and Once a month, its reminder window: the 7 days up to and
 * including `trip`'s do-it-by day with a trip ahead, else its last 7 days.
 */
export function reminderWindow(
  schedule: PeriodSchedule,
  period: LocalDate,
  trip: TripAhead | null,
): { first: LocalDate; last: LocalDate } {
  if (schedule.kind === "weekly-count") return { first: period, last: lastDayOf(schedule, period) };
  const last = trip?.doItBy ?? lastDayOf(schedule, period);
  return { first: addDays(last, 1 - REMINDER_WINDOW_DAYS), last };
}

/** Whether `day`, a day of the pact's period dated `period` on `schedule`, is in its reminder window. */
export function inReminderWindow(
  ctx: CoreContext,
  pactId: string,
  schedule: PeriodSchedule,
  period: LocalDate,
  day: LocalDate,
): boolean {
  const { first, last } = reminderWindow(schedule, period, tripAhead(ctx, pactId, schedule, period, day));
  return first <= day && day <= last;
}
