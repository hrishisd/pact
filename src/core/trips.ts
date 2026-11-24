// A period's reminder window, and the trip ahead that moves it: when an Every
// 2 weeks or Once a month period goes from quiet to the owner's to do.

import { addDays } from "../shared/calendar.ts";
import { isOncePerPeriod, lastDayOf, type PeriodSchedule } from "../shared/schedules.ts";
import type { LocalDate, Schedule, TripAhead } from "../shared/types.ts";
import { laterDate } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { coveredSql } from "./covers.ts";

/** How many days a period's reminder window runs. */
const REMINDER_WINDOW_DAYS = 7;

/**
 * The trip ahead of the pact's period dated `period` on `schedule`, while
 * its day to do it by is `today` or later (see `TripAhead`). Null with none.
 */
export function tripAhead(
  ctx: CoreContext,
  pactId: string,
  schedule: Schedule,
  period: LocalDate,
  today: LocalDate,
): TripAhead | null {
  const trip = periodTrip(ctx, pactId, schedule, period);
  return trip && trip.doItBy >= today ? trip : null;
}

/**
 * The trip that moves the reminder window of the pact's period dated
 * `period` on `schedule`, whether or not it has started: the earliest-
 * starting vacation filed for the pact, waiting or approved, that doesn't
 * cover the period and is a trip ahead of it from its first day. Null with
 * none, and on any other schedule.
 */
function periodTrip(ctx: CoreContext, pactId: string, schedule: Schedule, period: LocalDate): TripAhead | null {
  if (!isOncePerPeriod(schedule)) return null;
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
    const ahead = tripAheadOf(schedule, period, trip.first_day, trip.last_day, period);
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
  if (!isOncePerPeriod(schedule)) return null;
  const last = lastDayOf(schedule, period);
  const ahead =
    firstDay > laterDate(period, today) && firstDay <= last && lastDay > addDays(last, -REMINDER_WINDOW_DAYS);
  return ahead ? { period, firstDay, lastDay, doItBy: addDays(firstDay, -1) } : null;
}

/**
 * The reminder window of the pact's period dated `period` on `schedule`: the
 * days from `first` to the period's last day, but for those of its trip
 * (`away`), that its reminders go off on. From `first` on, Today shows it
 * under To do. Every day of a Weekly count week; on Every 2 weeks and Once a
 * month, from 7 days before the period's trip, else the period's last 7 days.
 */
export function reminderWindow(
  ctx: CoreContext,
  pactId: string,
  schedule: PeriodSchedule,
  period: LocalDate,
): { first: LocalDate; last: LocalDate; away: TripAhead | null } {
  const away = periodTrip(ctx, pactId, schedule, period);
  const last = lastDayOf(schedule, period);
  return { first: addDays(away?.doItBy ?? last, 1 - REMINDER_WINDOW_DAYS), last, away };
}
