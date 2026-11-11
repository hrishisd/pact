// Today: the owner's alerts, the sections each Active pact's card goes in,
// Waiting for approval, and yesterday.

import { addDays } from "../shared/calendar.ts";
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
  TodayNoOuraDataCard,
  TodaySection,
  TodayToDoCard,
  TodayWaitingItem,
} from "../shared/types.ts";
import { localDateOf } from "./calendar.ts";
import { activePactsUsing } from "./connections.ts";
import type { CoreContext } from "./context.ts";
import { coveredSql, excusableUntil, excuseWindowOpensSql, onApprovedVacation } from "./covers.ts";
import { rejectedDayAlerts, rejectedEvidenceAlerts, waitingEvidence } from "./evidence.ts";
import { rejectedExcuseAlerts, waitingExcuses } from "./excuses.ts";
import { ankiCheckOf, yesterdayEntries } from "./history.ts";
import { billsForToday, waitingPayments } from "./money.ts";
import { evidenceDecision, MISSED_THROUGH_REJECTION, occurrenceView, weekProgress } from "./occurrence-state.ts";
import type { Occurrence } from "./occurrences.ts";
import { wallClock } from "./oura-clock.ts";
import { EXCUSE_WINDOW_MS } from "./pact-rules.ts";
import { activePacts, waitingSince, type ActivePact } from "./pacts.ts";
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
  thread,
  waitingChangeRequests,
} from "./rows.ts";

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
    waiting: waiting(ctx, accountId),
    yesterday,
    ...(vacations.length > 0 && { vacations }),
  };
}

/**
 * Alerts for the owner's items still waiting for a decision whose latest
 * comment is a reviewer's question, with when it was asked.
 */
function questionAlerts(ctx: CoreContext, ownerId: AccountId): { at: Date; alert: TodayAlert }[] {
  return waiting(ctx, ownerId).flatMap((item) => {
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

/** The owner's evidence, excuses and payments still waiting for a decision, newest first. */
function waiting(ctx: CoreContext, ownerId: AccountId): TodayWaitingItem[] {
  return mergeByTime(
    waitingSince,
    "newest-first",
    waitingChangeRequests(ctx, ownerId),
    waitingEvidence(ctx, ownerId),
    waitingExcuses(ctx, ownerId),
    waitingPayments(ctx, ownerId),
  );
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
 * Today's sections. No Oura data: bedtime nights past their deadline that
 * Oura hasn't reported. To do: pacts with an occurrence open now that still
 * needs evidence, and `billCards`. Missed: other occurrences judged Missed
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
  const automatic: TodayAutomaticCard[] = [];
  const noOuraData: TodayNoOuraDataCard[] = [];
  const comingUp: TodayComingUpCard[] = [];
  for (const pact of activePacts(ctx, ownerId)) {
    const placed = pactToday(ctx, ownerId, pact, timezone, now);
    if (placed === null) continue;
    switch (placed.section) {
      case "to-do":
        toDo.push(placed.card);
        break;
      case "automatic":
        automatic.push(placed.card);
        break;
      case "no-oura-data":
        noOuraData.push(placed.card);
        break;
      case "coming-up":
        // A first occurrence an approved vacation covers isn't coming up: the owner is off that day.
        if (!onApprovedVacation(ctx, pact.id, placed.card.opensOn)) comingUp.push(placed.card);
        break;
    }
  }
  toDo.push(...billCards);
  // Rows come sorted by name, and the sorts are stable.
  toDo.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  automatic.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  noOuraData.sort((a, b) => a.closesAt.getTime() - b.closesAt.getTime());
  comingUp.sort((a, b) => a.opensOn.localeCompare(b.opensOn, "en-US"));
  const sections: TodaySection[] = [];
  if (noOuraData.length > 0) sections.push({ kind: "no-oura-data", cards: noOuraData });
  if (toDo.length > 0) sections.push({ kind: "to-do", cards: toDo });
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
  switch (pact.evidenceKind) {
    case "oura":
      return bedtimeToday(ctx, pact, timezone, now);
    case "anki":
      return ankiToday(ctx, ownerId, pact, timezone, now);
    case "camera":
      return cameraToday(ctx, pact, timezone, now);
  }
}

/**
 * A bedtime pact on Today: Coming up before its first night opens; then
 * last night under No Oura data, else tonight under Automatic. A night with
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
  const nights = between(addDays(today, -2), today);
  // Tonight: the night open now whose deadline hasn't passed. Past midnight that may be last night's.
  const tonight = nights.find(
    (night) => night.opensAt.getTime() <= now.getTime() && now.getTime() < night.dueAt.getTime() && open(night),
  );
  // Last night: past its deadline, and Oura hasn't reported it before it closes.
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
      section: "no-oura-data",
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
 * still needs evidence; Coming up before its first occurrence opens.
 */
function cameraToday(ctx: CoreContext, pact: ActivePact, timezone: string, now: Date): TodayPlacement | null {
  const { first, openAt, dayDueAt } = occurrencesOf(ctx, pact.id, timezone);
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
  if (pact.terms.schedule.kind === "weekly-count") {
    const today = localDateOf(now, timezone);
    const week = weekToDo(ctx, pact.id, open, today, dayDueAt(today)!, now);
    if (!week) return null;
    return {
      section: "to-do",
      card: { kind: "evidence", ...cardOn(ctx, pact, open.date), editWindowClosesAt, ...week },
    };
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
 * The To do card of a Weekly count week that is the owner's to do, as of
 * `now`, when `today` still takes evidence (before `todayDueAt`) and has
 * none; else null.
 */
function weekToDo(
  ctx: CoreContext,
  pactId: string,
  week: Occurrence,
  today: LocalDate,
  todayDueAt: Date,
  now: Date,
): Pick<TodayToDoCard, "occurrenceDate" | "dueAt" | "dueBy" | "week"> | null {
  if (now.getTime() >= todayDueAt.getTime()) return null;
  if (evidenceDecision(ctx, pactId, today, "day") !== "none") return null;
  const progress = weekProgress(ctx, pactId, week.date);
  const { due_by: dueBy } = termsOn(ctx, pactId, week.date);
  return { occurrenceDate: week.date, dueAt: week.dueAt, dueBy, week: progress };
}

/**
 * SQL: an excuse or vacation waiting, or an excuse rejected after the miss
 * (its alert shows the miss), hides it from Missed. A vacation rejected
 * after the miss doesn't: its alert says until when the day can be excused,
 * and the day's card files the excuse (R3).
 */
const COVER_HIDES_MISS = `(cover.decision IS NULL
  OR (cover.kind = 'excuse' AND cover.decision = 'rejected' AND cover.decided_at >= occurrence.judged_at))`;

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
    const weekly = scheduleOf(row.schedule).kind === "weekly-count";
    const dueBy = row.date === today && !weekly ? termsOn(ctx, row.id, row.date).due_by : null;
    return {
      pactId: row.id,
      name: row.name,
      penaltyCents: row.amount_cents,
      occurrenceDate: row.date,
      missedAt: new Date(row.judged_at),
      excusableUntil: excusableUntil(row.excuse_window_opens),
      detail: missedDetail(ctx, row, dueBy, weekly),
    };
  });
}

/**
 * What a Missed card's line says beyond its day: Closed at today's due-by
 * time, how far a Weekly count week got, the Anki check that decided it, or
 * when Oura saw the owner get into bed.
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
  weekly: boolean,
): MissedDetail | null {
  if (dueBy !== null && row.evidence_kind !== "anki") return { kind: "closed", dueBy };
  if (weekly) return { kind: "week", progress: weekProgress(ctx, row.id, row.date) };
  if (row.evidence_kind === "anki") return { kind: "anki", lastCheck: ankiCheckOf(row) };
  if (row.evidence_kind === "oura") {
    return { kind: "night", inBedAt: row.bedtime_start === null ? null : wallClock(row.bedtime_start).slice(11) };
  }
  return null;
}

/** A pact's card on Today and the section it goes in. */
type TodayPlacement =
  | { section: "to-do"; card: TodayToDoCard | TodayAnkiCard }
  | { section: "automatic"; card: TodayAutomaticCard }
  | { section: "no-oura-data"; card: TodayNoOuraDataCard }
  | { section: "coming-up"; card: TodayComingUpCard };
