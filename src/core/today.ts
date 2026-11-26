// Today: the owner's alerts, the sections each Active pact's card goes in,
// Waiting for approval, and yesterday.

import { addDays } from "../shared/calendar.ts";
import { isBedtimeKind } from "../shared/evidence-kinds.ts";
import { isPeriodSchedule } from "../shared/schedules.ts";
import type {
  AccountId,
  ConnectionService,
  EvidenceKind,
  LocalDate,
  MissedDetail,
  Today,
  TodayAlert,
  TodayAnkiCard,
  TodayAutomaticCard,
  TodayBillCard,
  TodayComingUpCard,
  TodayMissedCard,
  TodayNoSleepDataCard,
  TodaySection,
  TodayToDoCard,
  TodayWaitingItem,
} from "../shared/types.ts";
import { localDateOf } from "./calendar.ts";
import { activePactsUsing } from "./connections.ts";
import type { CoreContext } from "./context.ts";
import { coveredSql, excusableUntil, excuseWindowOpensSql, onApprovedVacation } from "./covers.ts";
import { rejectedDayAlerts, rejectedEvidenceAlerts } from "./evidence.ts";
import { rejectedExcuseAlertStandsSql, rejectedExcuseAlerts } from "./excuses.ts";
import { ankiCheckOf, yesterdayEntries } from "./history.ts";
import { billsForToday } from "./money.ts";
import { evidenceDecision, MISSED_THROUGH_REJECTION, occurrenceView, periodProgress } from "./occurrence-state.ts";
import type { Occurrence } from "./occurrences.ts";
import { wallClock } from "./night-clock.ts";
import { EXCUSE_WINDOW_MS } from "./pact-rules.ts";
import { activePacts, type ActivePact } from "./pacts.ts";
import { rejectedVacationAlerts, vacationsOnNow } from "./vacations.ts";
import {
  accountRow,
  ankiDeckMissing,
  ankiDeckName,
  ankiDeckOn,
  connectionProblem,
  lastAnkiCheck,
  mergeByTime,
  occurrencesOf,
  scheduleOf,
  termsOn,
} from "./rows.ts";
import { thread } from "./requests.ts";
import { reminderWindow, tripAhead } from "./trips.ts";
import { waitingFor } from "./waiting.ts";

export function todayPage(ctx: CoreContext, accountId: AccountId): Today {
  const { timezone } = accountRow(ctx, accountId);
  const { alerts, sections } = todayCards(ctx, accountId, timezone);
  const hasPacts = ctx.db.prepare(`SELECT 1 FROM pact WHERE owner_account_id = ?`).get(accountId) !== undefined;
  const yesterday = yesterdayEntries(ctx, accountId, timezone);
  const vacations = vacationsOnNow(ctx, accountId, timezone, localDateOf(ctx.clock.now(), timezone));
  return {
    hasPacts,
    alerts,
    sections,
    waiting: waitingFor(ctx, accountId, {}),
    yesterday,
    ...(vacations.length > 0 && { vacations }),
  };
}

/**
 * Alerts for the owner's items still waiting for a decision whose latest
 * comment is a reviewer's question, with when it was asked.
 */
export function questionAlerts(ctx: CoreContext, ownerId: AccountId): { at: Date; alert: TodayAlert }[] {
  return waitingFor(ctx, ownerId, {}).flatMap((item) => {
    const { comments, waitingOnReply } = thread(ctx, item.id, true);
    const question = comments.at(-1);
    if (!waitingOnReply || !question) return [];
    return [
      {
        at: question.sentAt,
        alert: {
          kind: "reviewer-question",
          item,
          reviewerName: question.authorName,
          question: question.text,
          askedAt: question.sentAt,
        },
      },
    ];
  });
}

/** Today's alerts and sections for the owner, as `todayAlerts` and `todaySections` put them. */
function todayCards(
  ctx: CoreContext,
  ownerId: AccountId,
  timezone: string,
): { alerts: TodayAlert[]; sections: TodaySection[] } {
  const now = ctx.clock.now();
  const bills = billsForToday(ctx, ownerId, now);
  return {
    alerts: todayAlerts(ctx, ownerId, now, bills.alerts),
    sections: todaySections(ctx, ownerId, timezone, now, bills.cards),
  };
}

/**
 * Today's alerts: connection problems while an Active pact is judged from
 * the connection, then `billAlerts`, then occurrences Missed through a
 * rejection, and rejected excuses and vacations, until accepted or excused
 * again, and
 * reviewer questions until the owner replies or the item is decided;
 * newest first.
 */
function todayAlerts(ctx: CoreContext, ownerId: AccountId, now: Date, billAlerts: TodayAlert[]): TodayAlert[] {
  const alerts = [
    ...rejectedEvidenceAlerts(ctx, ownerId),
    ...rejectedDayAlerts(ctx, ownerId),
    ...rejectedExcuseAlerts(ctx, ownerId, now),
    ...rejectedVacationAlerts(ctx, ownerId),
    ...questionAlerts(ctx, ownerId),
  ];
  // A connection matters only while an Active pact is judged from it.
  const problemWith = (service: ConnectionService) =>
    activePactsUsing(ctx, ownerId, service) > 0 ? connectionProblem(ctx, ownerId, service) : null;
  const connectionAlerts = (["oura", "anki"] as const).flatMap((service): TodayAlert[] => {
    const status = problemWith(service);
    return status ? [{ kind: "connection", service, status }] : [];
  });
  return [
    ...connectionAlerts,
    ...billAlerts,
    ...mergeByTime(({ at }) => at, "newest-first", alerts).map(({ alert }) => alert),
  ];
}

/**
 * Today's sections. No sleep data: bedtime nights past their deadline whose
 * sleep hasn't arrived. To do: pacts with an occurrence open now that still
 * needs evidence, and `billCards`. Later: Every 2 weeks and Once a month
 * periods that still need evidence before their reminder window. Missed: other occurrences judged Missed
 * in the last 48 hours and not accepted. Automatic: bedtime nights open
 * now. Coming up: pacts whose first occurrence hasn't opened yet. A pact on
 * a day it isn't due appears in neither To do nor Coming up. Empty sections
 * are left out.
 */
function todaySections(
  ctx: CoreContext,
  ownerId: AccountId,
  timezone: string,
  now: Date,
  billCards: TodayBillCard[],
): TodaySection[] {
  const toDo: (TodayToDoCard | TodayAnkiCard | TodayBillCard)[] = [];
  const later: TodayToDoCard[] = [];
  const automatic: TodayAutomaticCard[] = [];
  const noSleepData: TodayNoSleepDataCard[] = [];
  const comingUp: TodayComingUpCard[] = [];
  for (const pact of activePacts(ctx, ownerId)) {
    const placed = pactToday(ctx, ownerId, pact, timezone, now);
    if (placed === null) continue;
    switch (placed.section) {
      case "to-do":
        toDo.push(placed.card);
        break;
      case "later":
        later.push(placed.card);
        break;
      case "automatic":
        automatic.push(placed.card);
        break;
      case "no-sleep-data":
        noSleepData.push(placed.card);
        break;
      case "coming-up":
        // A first occurrence an approved vacation covers isn't coming up: the owner is off that day.
        if (!onApprovedVacation(ctx, pact.id, placed.card.opensOn)) comingUp.push(placed.card);
        break;
    }
  }
  toDo.push(...billCards);
  // Rows come sorted by name, and the sorts are stable.
  const byDueAt = (a: { dueAt: Date }, b: { dueAt: Date }) => a.dueAt.getTime() - b.dueAt.getTime();
  toDo.sort(byDueAt);
  later.sort(byDueAt);
  automatic.sort(byDueAt);
  noSleepData.sort((a, b) => a.closesAt.getTime() - b.closesAt.getTime());
  comingUp.sort((a, b) => a.opensOn.localeCompare(b.opensOn, "en-US"));
  const sections: TodaySection[] = [];
  if (noSleepData.length > 0) sections.push({ kind: "no-sleep-data", cards: noSleepData });
  if (toDo.length > 0) sections.push({ kind: "to-do", cards: toDo });
  if (later.length > 0) sections.push({ kind: "later", cards: later });
  const missed = recentlyMissed(ctx, ownerId, timezone, now);
  if (missed.length > 0) sections.push({ kind: "missed", cards: missed });
  if (automatic.length > 0) sections.push({ kind: "automatic", cards: automatic });
  if (comingUp.length > 0) sections.push({ kind: "coming-up", cards: comingUp });
  return sections;
}

/** The Active pact's card on Today and the section it goes in, or null when it has none now. */
function pactToday(
  ctx: CoreContext,
  ownerId: AccountId,
  pact: ActivePact,
  timezone: string,
  now: Date,
): TodayPlacement | null {
  if (isBedtimeKind(pact.evidenceKind)) return bedtimeToday(ctx, pact, timezone, now);
  switch (pact.evidenceKind) {
    case "anki":
      return ankiToday(ctx, ownerId, pact, timezone, now);
    case "camera":
      return cameraToday(ctx, pact, timezone, now);
  }
}

/**
 * A bedtime pact on Today: Coming up before its first night opens; then
 * last night under No sleep data, else tonight under Automatic. A night with
 * an excuse filed is under Waiting for approval instead; one on a vacation
 * waiting for approval stays.
 */
function bedtimeToday(ctx: CoreContext, pact: ActivePact, timezone: string, now: Date): TodayPlacement | null {
  const { first, between } = occurrencesOf(ctx, pact.id, timezone);
  if (now.getTime() < first.opensAt.getTime()) {
    return { section: "coming-up", card: comingUpCard(ctx, pact, first) };
  }
  const today = localDateOf(now, timezone);
  // Nights the owner needn't hear about: judged, or with an excuse filed (a waiting vacation keeps them).
  const open = (night: Occurrence) => occurrenceView(ctx, pact.id, night).toDo;
  // After a move west, a night open in the timezone moved from may be dated tomorrow here.
  const nights = between(addDays(today, -2), addDays(today, 1));
  // Tonight: the night open now whose deadline hasn't passed. Past midnight that may be last night's.
  const tonight = nights.find(
    (night) => night.opensAt.getTime() <= now.getTime() && now.getTime() < night.dueAt.getTime() && open(night),
  );
  // Last night: past its deadline, and its sleep hasn't arrived before it closes.
  const lastNight = nights.find(
    (night) => night.dueAt.getTime() <= now.getTime() && now.getTime() < night.closesAt.getTime() && open(night),
  );
  const tonightCard = tonight && {
    occurrenceDate: tonight.date,
    dueAt: tonight.dueAt,
    inBedBy: termsOn(ctx, pact.id, tonight.date).in_bed_by!,
  };
  if (lastNight) {
    // Tonight's deadline rides on this card.
    return {
      section: "no-sleep-data",
      card: {
        ...cardOn(ctx, pact, lastNight.date),
        occurrenceDate: lastNight.date,
        closesAt: lastNight.closesAt,
        tonight: tonightCard ?? null,
      },
    };
  }
  if (tonightCard) {
    return {
      section: "automatic",
      card: {
        ...cardOn(ctx, pact, tonightCard.occurrenceDate),
        editWindowClosesAt: pact.editWindowClosesAt,
        ...tonightCard,
      },
    };
  }
  return null;
}

/**
 * An Anki pact on Today: its day open now under To do until it's judged
 * (Satisfied the moment Pact sees the deck finished) or past its due time,
 * unless an excuse or an approved vacation covers it; Coming up before its
 * first day opens.
 */
function ankiToday(
  ctx: CoreContext,
  ownerId: AccountId,
  pact: ActivePact,
  timezone: string,
  now: Date,
): TodayPlacement | null {
  const { first, openAt } = occurrencesOf(ctx, pact.id, timezone);
  const open = openAt(now);
  if (open) {
    return occurrenceView(ctx, pact.id, open).toDo
      ? { section: "to-do", card: ankiCard(ctx, pact, ownerId, open) }
      : null;
  }
  if (now.getTime() < first.opensAt.getTime()) {
    return { section: "coming-up", card: comingUpCard(ctx, pact, first) };
  }
  return null;
}

/**
 * A Camera pact on Today: its occurrence open now under To do while it
 * still needs evidence, or an Every 2 weeks or Once a month period under
 * Later until its reminder window; Coming up before its first occurrence opens.
 */
function cameraToday(ctx: CoreContext, pact: ActivePact, timezone: string, now: Date): TodayPlacement | null {
  const { first, openAt, dayDueAt, timezoneOn } = occurrencesOf(ctx, pact.id, timezone);
  const open = openAt(now);
  if (!open) {
    return now.getTime() < first.opensAt.getTime()
      ? { section: "coming-up", card: comingUpCard(ctx, pact, first) }
      : null;
  }
  // Not the owner's to do: judged while still open (its evidence was rejected, so it's an alert),
  // past its due-by time (Missed, or the next tick judges it), its evidence in, or an excuse filed.
  if (!occurrenceView(ctx, pact.id, open).toDo) return null;
  const { editWindowClosesAt } = pact;
  const { schedule } = pact.terms;
  if (isPeriodSchedule(schedule)) {
    // The day it is where the period opened, which a move since leaves as it was.
    const today = localDateOf(now, timezoneOn(open.date));
    const period = periodToDo(ctx, pact.id, open, today, dayDueAt(today)!, now);
    if (!period) return null;
    const trip = tripAhead(ctx, pact.id, schedule, open.date, today);
    const window = reminderWindow(ctx, pact.id, schedule, open.date);
    const card: TodayToDoCard = {
      kind: "evidence",
      ...cardOn(ctx, pact, open.date),
      editWindowClosesAt,
      ...period,
      ...(trip && { tripAhead: trip }),
    };
    return { section: today < window.first ? "later" : "to-do", card };
  }
  return {
    section: "to-do",
    card: {
      kind: "evidence",
      ...cardOn(ctx, pact, open.date),
      editWindowClosesAt,
      occurrenceDate: open.date,
      dueAt: open.dueAt,
      dueBy: termsOn(ctx, pact.id, open.date).due_by,
    },
  };
}

/** What every pact card on Today shows: the terms of the occurrence on `date`, the one it's about. */
function cardOn(
  ctx: CoreContext,
  pact: ActivePact,
  date: LocalDate,
): Pick<TodayComingUpCard, "pactId" | "name" | "penaltyCents"> {
  return { pactId: pact.id, name: pact.name, penaltyCents: termsOn(ctx, pact.id, date).penalty_cents };
}

/** The pact's Coming up card, until its first occurrence `first` opens. */
function comingUpCard(ctx: CoreContext, pact: ActivePact, first: Occurrence): TodayComingUpCard {
  return {
    ...cardOn(ctx, pact, first.date),
    editWindowClosesAt: pact.editWindowClosesAt,
    opensOn: first.date,
    startDate: pact.startDate,
  };
}

/** An Anki pact's open day on Today: its due time, and how the deck stood at the last check. */
function ankiCard(ctx: CoreContext, pact: ActivePact, ownerId: AccountId, open: Occurrence): TodayAnkiCard {
  return {
    kind: "anki",
    ...cardOn(ctx, pact, open.date),
    editWindowClosesAt: pact.editWindowClosesAt,
    occurrenceDate: open.date,
    dueAt: open.dueAt,
    dueBy: termsOn(ctx, pact.id, open.date).due_by,
    deckName: ankiDeckName(ctx, ownerId, ankiDeckOn(ctx, pact.id, open.date)),
    deckMissing: ankiDeckMissing(ctx, ownerId, ankiDeckOn(ctx, pact.id, open.date)),
    lastCheck: lastAnkiCheck(ctx, pact.id, open.date),
  };
}

/**
 * The To do card of a period that is the owner's to do, as of `now`, when
 * `today` still takes evidence (before `todayDueAt`) and has none; else null.
 */
function periodToDo(
  ctx: CoreContext,
  pactId: string,
  period: Occurrence,
  today: LocalDate,
  todayDueAt: Date,
  now: Date,
): Pick<TodayToDoCard, "occurrenceDate" | "dueAt" | "dueBy" | "period"> | null {
  if (now.getTime() >= todayDueAt.getTime()) return null;
  if (evidenceDecision(ctx, pactId, today, "day") !== "none") return null;
  const progress = periodProgress(ctx, pactId, period.date);
  const { due_by: dueBy } = termsOn(ctx, pactId, period.date);
  return { occurrenceDate: period.date, dueAt: period.dueAt, dueBy, period: progress };
}

/**
 * SQL: an excuse or vacation waiting, or a rejected excuse whose alert
 * stands, hides the miss from Missed: the alert shows the day and files
 * another excuse for it, whether the day was judged before or after the
 * rejection. A rejected vacation doesn't: its alert says until when the day
 * can be excused, and the day's card files the excuse (R3).
 */
const COVER_HIDES_MISS = `(cover.decision IS NULL
  OR (cover.kind = 'excuse' AND EXISTS (SELECT 1 FROM excuse AS rejected
                                        WHERE rejected.id = cover.id AND ${rejectedExcuseAlertStandsSql("rejected")})))`;

/** SQL: when the `occurrence` row's excuse window opens. */
const WINDOW_OPENS = excuseWindowOpensSql("occurrence.pact_id", "occurrence.date", "occurrence.judged_at");

/**
 * The owner's occurrences judged Missed whose excuse window is still open
 * at `now` (48 hours from the judging, or from a vacation's rejection or
 * withdrawal), latest first, but not accepted misses, nor those Missed
 * through a rejection or on a rejected excuse while its alert stands, nor
 * those on an excuse or vacation waiting for approval. Today's day of a
 * Camera pact with a due-by time is Closed.
 */
function recentlyMissed(ctx: CoreContext, ownerId: AccountId, timezone: string, now: Date): TodayMissedCard[] {
  const today = localDateOf(now, timezone);
  const since = new Date(now.getTime() - EXCUSE_WINDOW_MS);
  const rows = ctx.all<{
    id: string;
    name: string;
    evidence_kind: EvidenceKind;
    schedule: string;
    amount_cents: number;
    date: LocalDate;
    judged_at: string;
    excuse_window_opens: string;
    bedtime_start: string | null;
    anki_cards_left: number | null;
    anki_checked_at: string | null;
  }>(
    `SELECT pact.id, pact.name, pact.evidence_kind, pact.schedule, penalty.amount_cents, occurrence.date,
              occurrence.judged_at, ${WINDOW_OPENS} AS excuse_window_opens, occurrence.bedtime_start, occurrence.anki_cards_left, occurrence.anki_checked_at
       FROM occurrence
       JOIN pact ON pact.id = occurrence.pact_id
       JOIN penalty ON penalty.pact_id = occurrence.pact_id AND penalty.occurrence_date = occurrence.date
       WHERE pact.owner_account_id = ? AND occurrence.outcome = 'missed' AND ${WINDOW_OPENS} > ?
         AND occurrence.miss_accepted_at IS NULL AND NOT ${MISSED_THROUGH_REJECTION}
         AND NOT ${coveredSql("occurrence.pact_id", "occurrence.date", "any", COVER_HIDES_MISS)}
       ORDER BY occurrence.judged_at DESC, pact.name, pact.id`,
    ownerId,
    since.toISOString(),
  );
  return rows.map((row) => {
    const onPeriods = isPeriodSchedule(scheduleOf(row.schedule));
    const dueBy = row.date === today && !onPeriods ? termsOn(ctx, row.id, row.date).due_by : null;
    return {
      pactId: row.id,
      name: row.name,
      penaltyCents: row.amount_cents,
      occurrenceDate: row.date,
      missedAt: new Date(row.judged_at),
      excusableUntil: excusableUntil(row.excuse_window_opens),
      detail: missedDetail(ctx, row, dueBy, onPeriods),
    };
  });
}

/**
 * What a Missed card's line says beyond its day: Closed at today's due-by
 * time, how far a period got, the Anki check that decided it, or
 * when the owner got into bed.
 */
function missedDetail(
  ctx: CoreContext,
  row: {
    id: string;
    evidence_kind: EvidenceKind;
    date: LocalDate;
    bedtime_start: string | null;
    anki_cards_left: number | null;
    anki_checked_at: string | null;
  },
  dueBy: string | null,
  onPeriods: boolean,
): MissedDetail | null {
  if (dueBy !== null && row.evidence_kind !== "anki") return { kind: "closed", dueBy };
  if (onPeriods) return { kind: "period", progress: periodProgress(ctx, row.id, row.date) };
  if (row.evidence_kind === "anki") return { kind: "anki", lastCheck: ankiCheckOf(row) };
  if (isBedtimeKind(row.evidence_kind)) {
    return { kind: "night", inBedAt: row.bedtime_start === null ? null : wallClock(row.bedtime_start).slice(11) };
  }
  return null;
}

/** A pact's card on Today and the section it goes in. */
type TodayPlacement =
  | { section: "to-do"; card: TodayToDoCard | TodayAnkiCard }
  | { section: "later"; card: TodayToDoCard }
  | { section: "automatic"; card: TodayAutomaticCard }
  | { section: "no-sleep-data"; card: TodayNoSleepDataCard }
  | { section: "coming-up"; card: TodayComingUpCard };
