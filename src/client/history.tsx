// History: the pact page's heat map and Today's Yesterday rows. Both show
// occurrences the core has already judged (or not); this only says how they
// look. The UI never says "pending": a day past due that isn't judged yet is
// "Not judged yet".

import { useEffect, useRef, useState } from "react";
import type { Json } from "../shared/api.ts";
import type {
  HeatMapDay,
  HeatMapPeriod,
  LocalDate,
  OccurrenceRecord,
  PactTerms,
  PeriodKind,
  TodayYesterdayEntry,
} from "../shared/types.ts";
import { addDays, parseLocalDate } from "../shared/calendar.ts";
import { periodKindOfSchedule } from "../shared/schedules.ts";
import {
  Chip,
  DayChip,
  presentOccurrence,
  type OccurrencePresentation,
  type PresentOptions,
  type Square,
} from "./excuse-days.tsx";
import {
  ankiMissText,
  clockText,
  clockTime,
  dateSpan,
  formatDate,
  listNames,
  monthDay,
  money,
  NIGHT_CLOSES_TEXT,
  periodName,
  periodWord,
} from "./format.ts";

type Occurrence = Json<OccurrenceRecord>;
type Day = Json<HeatMapDay>;
type Week = Json<HeatMapPeriod>;

/** A week's square shows no count when nothing was counted toward it: Excused, Vacation or not open yet. */
const UNCOUNTED: Square[] = ["excused", "vac", "ahead"];

/** An occurrence's square and chip, as `presentOccurrence` has them; no square for a day with no occurrence. */
function present(record: Occurrence | null, now: number, options: PresentOptions) {
  return record === null ? null : presentOccurrence(record.status, now, options);
}

/**
 * The line under an occurrence: who decided it and why, when Oura saw the
 * owner get into bed or Pact saw the deck finished (in `timezone`, the
 * profile's), and what a miss cost. `reviewerNames` names who a photo waits
 * for; without it the chip says enough.
 */
function occurrenceLine(record: Occurrence, timezone: string, reviewerNames: string[] = []): string {
  const { status, detail } = record;
  const bed =
    detail?.kind === "night"
      ? detail.inBedAt === null
        ? `No sleep data had synced by ${NIGHT_CLOSES_TEXT}.`
        : `In bed at ${clockText(detail.inBedAt)}.`
      : undefined;
  switch (status.kind) {
    case "satisfied":
      if (bed) return bed;
      if (detail?.kind === "anki" && detail.lastCheck)
        return `Finished by ${clockTime(detail.lastCheck.checkedAt, timezone)}.`;
      return status.approvedBy !== null ? `Photo approved by ${status.approvedBy}.` : "";
    case "missed": {
      const cost = missedCost(status);
      if (status.rejection)
        return `${status.rejection.reviewerName} rejected the photo: “${sentence(status.rejection.reason)}” ${cost}`;
      if (detail?.kind === "anki") return `${ankiMissText(detail.lastCheck, timezone)}. ${cost}`;
      return `${bed ?? "No photo."} ${cost}`;
    }
    case "excused":
    case "not-judged":
      if (status.vacation)
        return `Excused for your vacation, ${dateSpan(status.vacation.from, status.vacation.to)}. No penalty.`;
      if (status.excuseApproval)
        return `Excuse approved by ${status.excuseApproval.reviewerName}: “${sentence(status.excuseApproval.reason)}”`;
      if (status.kind === "not-judged" && status.evidenceWaiting && reviewerNames.length > 0)
        return `Photo waiting for ${listNames(reviewerNames, "or")}.`;
      return "";
  }
}

/** What a Missed occurrence cost: held while an excuse or vacation waits, else paid to its recipient. */
function missedCost(status: Extract<Occurrence["status"], { kind: "missed" }>): string {
  return status.cover?.state === "waiting"
    ? `${money(status.penaltyCents)} held.`
    : `${money(status.penaltyCents)} to ${status.recipientName ?? "your recipient"}.`;
}

/** `text` ending in a full stop, unless it already ends a sentence. */
function sentence(text: string): string {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Row labels, Monday first, as GitHub labels every other row. */
const ROW_LABELS = ["M", "", "W", "", "F", "", "S"];

/** A Mon–Sun week of the heat map: its Monday, and its days with blanks for those before the first. */
interface HeatMapColumn {
  monday: LocalDate;
  days: (Day | null)[];
}

/** Mon–Sun weeks of `days` (which start on any weekday), with blanks before the first. */
export function weeksOf(days: Day[]): HeatMapColumn[] {
  const first = days[0];
  if (!first) return [];
  const { year, month, day } = parseLocalDate(first.date);
  const lead = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  const firstMonday = addDays(first.date, -lead);
  const cells: (Day | null)[] = [...Array<null>(lead).fill(null), ...days];
  const weeks: HeatMapColumn[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push({ monday: addDays(firstMonday, i), days: cells.slice(i, i + 7) });
  }
  return weeks;
}

/**
 * Each week's month label: a week whose Monday is in the first 7 days of a
 * month, and the first week unless the next one is labelled already.
 */
export function monthLabels(weeks: HeatMapColumn[]): string[] {
  const monthOf = (week: HeatMapColumn) => MONTHS[parseLocalDate(week.monday).month - 1]!;
  const labels = weeks.map((week) => (parseLocalDate(week.monday).day <= 7 ? monthOf(week) : ""));
  const first = weeks[0];
  if (first && labels[0] === "" && !labels[1]) labels[0] = monthOf(first);
  return labels;
}

/**
 * The pact page's History: a GitHub-style grid, a column per week since the
 * first occurrence and a row per weekday, scrolled to now. Tapping a square
 * shows its day below the legend.
 */
export function HeatMap({ pact, timezone, now }: { pact: Json<PactTerms>; timezone: string; now: number }) {
  const { history } = pact;
  switch (history.kind) {
    case "periods":
      return (
        <PeriodHeatMap
          kind={periodKindOfSchedule(pact.schedule) ?? "weekly-count"}
          periods={history.periods}
          timezone={timezone}
          now={now}
        />
      );
    case "one-time":
      return <OneTimeHistory pact={pact} day={history.day} timezone={timezone} now={now} />;
    case "fixed-days":
      return <DailyHeatMap pact={pact} days={history.days} timezone={timezone} now={now} />;
  }
}

/**
 * A One-time pact's History: its one square, the deadline's date, with how
 * it went (or what it's waiting for) beside it. With Submit anytime, an open
 * occurrence is due on that date, not today.
 */
function OneTimeHistory({
  pact,
  day,
  timezone,
  now,
}: {
  pact: Json<PactTerms>;
  day: Day;
  timezone: string;
  now: number;
}) {
  const record = day.occurrence;
  if (record === null) return null;
  // Open before its date, with Submit anytime: it's due on the deadline's date, not today.
  const { chip, square } = presentOccurrence(record.status, now, {
    timezone,
    oura: pact.evidenceKind === "oura",
    dueOn: day.date,
  });
  const line = occurrenceLine(
    record,
    timezone,
    pact.reviewers.map((r) => r.name),
  );
  return (
    <section className="card">
      <h3>History</h3>
      <div className="hmdetail one" role="status">
        <span className={`cell ${square}`} aria-hidden="true" />
        <span className="rt">
          <span className="spread">
            <b>{formatDate(day.date)}</b>
            <Chip chip={chip} />
          </span>
          {line && <span className="small muted">{line}</span>}
        </span>
      </div>
      <Legend />
    </section>
  );
}

function DailyHeatMap({
  pact,
  days,
  timezone,
  now,
}: {
  pact: Json<PactTerms>;
  days: Day[];
  timezone: string;
  now: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const scroller = useScrolledToEnd(days.length);
  const weeks = weeksOf(days);
  const months = monthLabels(weeks);
  const picked = days.find((day) => day.date === selected && day.occurrence !== null);
  const line = picked?.occurrence
    ? occurrenceLine(
        picked.occurrence,
        timezone,
        pact.reviewers.map((r) => r.name),
      )
    : "";

  return (
    <section className="card">
      <h3>History</h3>
      <div className="hm-scroll" ref={scroller}>
        <div className="hm">
          <div className="hm-col" aria-hidden="true">
            <div className="hm-lbl" />
            {ROW_LABELS.map((label, i) => (
              <div key={i} className="hm-lbl">
                {label}
              </div>
            ))}
          </div>
          {weeks.map((week, w) => (
            <div key={week.monday} className="hm-col">
              <div className="hm-lbl mo">{months[w]}</div>
              {week.days.map((day, i) =>
                day === null ? (
                  <div key={i} />
                ) : (
                  <HeatMapSquare
                    key={day.date}
                    day={day}
                    presented={present(day.occurrence, now, { timezone, oura: pact.evidenceKind === "oura" })}
                    selected={day.date === selected}
                    onSelect={() => setSelected(day.date)}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <Legend />
      {picked?.occurrence ? (
        <div className="hmdetail" role="status">
          <div className="spread">
            <b>
              {formatDate(picked.date)}
              {pact.evidenceKind === "oura" && " night"}
            </b>
            <DayChip
              status={picked.occurrence.status}
              now={now}
              timezone={timezone}
              oura={pact.evidenceKind === "oura"}
            />
          </div>
          {line && <span className="small muted">{line}</span>}
        </div>
      ) : (
        <p className="small muted">Tap a day to see what happened.</p>
      )}
    </section>
  );
}

/** A ref for a scroller kept scrolled to its end, now, whenever `length` changes. */
function useScrolledToEnd(length: number) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [length]);
  return scroller;
}

function Legend() {
  return (
    <div className="legend">
      <span>
        <i className="cell satisfied" />
        Satisfied
      </span>
      <span>
        <i className="cell missed" />
        Missed
      </span>
      <span>
        <i className="cell excused" />
        Excused
      </span>
      <span>
        <i className="cell vac" />
        Vacation
      </span>
      <span>
        <i className="cell not-judged" />
        Not judged yet
      </span>
    </div>
  );
}

/**
 * A period schedule pact's History: one square per period since the first,
 * each with the number of days that counted, scrolled to now. Tapping one
 * shows the period below the legend. A month's square is labelled by its
 * month, 2 weeks' by their first Monday ("Nov 30"), and a week's by the
 * month that starts in it.
 */
function PeriodHeatMap({
  kind,
  periods,
  timezone,
  now,
}: {
  kind: PeriodKind;
  periods: Week[];
  timezone: string;
  now: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const scroller = useScrolledToEnd(periods.length);
  const picked = periods.find((week) => week.date === selected && week.occurrence !== null);
  const noun = kind === "once-a-month" ? "month" : kind === "weekly-count" ? "week" : "square";

  return (
    <section className="card">
      <h3>History</h3>
      <div className="hm-scroll" ref={scroller}>
        <div className="hm-weeks">
          {periods.map((week, i) => {
            const presented = present(week.occurrence, now, { timezone, period: kind });
            const { month: number, day } = parseLocalDate(week.date);
            const month =
              kind === "every-2-weeks"
                ? monthDay(week.date)
                : kind === "once-a-month" || day <= 7 || i === 0
                  ? MONTHS[number - 1]
                  : "";
            return (
              <div key={week.date} className="hm-wcol">
                <span className="hm-lbl">{month}</span>
                {presented === null ? (
                  <div className="cell wk none" />
                ) : (
                  <button
                    className={`cell wk ${presented.square}${week.date === selected ? " sel" : ""}`}
                    aria-label={`${periodName(kind, week.date)}: ${presented.label}, ${weekText(week)}`}
                    aria-pressed={week.date === selected}
                    onClick={() => setSelected(week.date)}
                  >
                    {UNCOUNTED.includes(presented.square) ? "" : week.progress.sessions}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="small muted">One square per {periodWord(kind)}, with how many days counted.</p>
      <Legend />
      {picked?.occurrence ? (
        <div className="hmdetail" role="status">
          <div className="spread">
            <b>{periodName(kind, picked.date)}</b>
            <DayChip status={picked.occurrence.status} now={now} timezone={timezone} period={kind} />
          </div>
          <span className="small muted">{weekLine(picked, timezone)}</span>
        </div>
      ) : (
        <p className="small muted">Tap a {noun} to see what happened.</p>
      )}
    </section>
  );
}

/** "2 of 3", with "so far" while the period runs and how many photos wait. */
function weekText({ progress, occurrence }: Week): string {
  const { sessions, waiting, target } = progress;
  const running = occurrence?.status.kind === "not-judged";
  return [
    `${sessions} of ${target}${running ? " so far" : ""}`,
    ...(waiting > 0 ? [`${waiting} waiting for approval`] : []),
  ].join(" · ");
}

/** The line under a tapped period: how far it got, and what a short one cost or the excuse that covered it. */
function weekLine(week: Week, timezone: string): string {
  const record = week.occurrence;
  if (record === null) return "";
  const { status } = record;
  if (status.kind === "missed") {
    const short = week.progress.target - week.progress.sessions;
    // A month or 2 weeks have one day to do: no photo approved is the whole story.
    if (week.progress.target === 1 && week.progress.sessions === 0) return `No photo approved. ${missedCost(status)}`;
    return `${weekText(week)}. ${short} short: ${missedCost(status)}`;
  }
  const excused = occurrenceLine(record, timezone);
  if (status.kind === "excused" || excused !== "") return excused;
  return `${weekText(week)}.`;
}

function HeatMapSquare({
  day,
  presented,
  selected,
  onSelect,
}: {
  day: Day;
  presented: OccurrencePresentation | null;
  selected: boolean;
  onSelect: () => void;
}) {
  if (presented === null) return <div className="cell none" />;
  return (
    <button
      className={`cell ${presented.square}${selected ? " sel" : ""}`}
      aria-label={`${formatDate(day.date)}: ${presented.label}`}
      aria-pressed={selected}
      onClick={onSelect}
    />
  );
}

/** Yesterday, last on Today: one row per pact due yesterday with its chip and a short line, opening the pact. */
export function Yesterday({
  entries,
  timezone,
  now,
  onOpenPact,
}: {
  entries: Json<TodayYesterdayEntry>[];
  /** The profile's timezone, for when AnkiWeb was checked. */
  timezone: string;
  now: number;
  onOpenPact: (id: string, name: string) => void;
}) {
  const date = entries[0]?.occurrenceDate;
  if (date === undefined) return null;
  return (
    <section className="stack">
      <div className="label">Yesterday · {formatDate(date)}</div>
      <div className="cards">
        {entries.map((entry) => {
          const line = occurrenceLine(entry.occurrence, timezone);
          return (
            <button key={entry.pactId} className="rowbtn" onClick={() => onOpenPact(entry.pactId, entry.name)}>
              <span className="rt">
                <b>{entry.name}</b>
                {line && <small>{line}</small>}
              </span>
              <DayChip
                status={entry.occurrence.status}
                now={now}
                timezone={timezone}
                oura={entry.evidenceKind === "oura"}
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
