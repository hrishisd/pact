// History: the pact page's heat map and Today's Yesterday rows. Both show
// occurrences the core has already judged (or not); this only says how they
// look. The UI never says "pending": a day past due that isn't judged yet is
// "Not judged yet".

import { useEffect, useRef, useState } from "react";
import type { Json } from "../shared/api.ts";
import type {
  EvidenceKind,
  HeatMapDay,
  HeatMapWeek,
  OccurrenceRecord,
  PactTerms,
  TodayYesterdayEntry,
} from "../shared/types.ts";
import { DayChip } from "./excuse-days.tsx";
import { listNames } from "./change-terms.tsx";
import { ankiMissText, clockText, clockTime, dateIn, formatDate, money } from "./format.ts";

type Occurrence = Json<OccurrenceRecord>;
type Day = Json<HeatMapDay>;
type Week = Json<HeatMapWeek>;

/** How a square looks: an outcome, or for a day not judged yet whether it's ahead, open now or past due. */
type Square = "satisfied" | "missed" | "excused" | "not-judged" | "open" | "ahead" | "none";

function squareOf(record: Occurrence | null, now: number): Square {
  if (record === null) return "none";
  const { status } = record;
  if (status.kind !== "not-judged") return status.kind;
  if (status.excuse === "approved") return "excused";
  if (Date.parse(status.opensAt) > now) return "ahead";
  return Date.parse(status.dueAt) > now ? "open" : "not-judged";
}

/**
 * An occurrence's chip: as on excuses, except that a bedtime night past its
 * due time and not judged yet is waiting on Oura.
 */
function OccurrenceChip({
  record,
  evidenceKind,
  now,
}: {
  record: Occurrence;
  evidenceKind: EvidenceKind;
  now: number;
}) {
  return <DayChip status={record.status} now={now} oura={evidenceKind === "oura"} />;
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
        ? "No sleep data by 6pm."
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
      if (status.excuseApproval)
        return `Excuse approved by ${status.excuseApproval.reviewerName}: “${sentence(status.excuseApproval.reason)}”`;
      if (status.kind === "not-judged" && status.evidenceWaiting && reviewerNames.length > 0)
        return `Photo waiting for ${listNames(reviewerNames, "or")}.`;
      return "";
  }
}

/** What a Missed occurrence cost: held while an excuse waits, else paid to its recipient. */
function missedCost(status: Extract<Occurrence["status"], { kind: "missed" }>): string {
  return status.held
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

/** Mon–Sun weeks of `days` (which start on any weekday), with blanks before the first. */
function weeksOf(days: Day[]): (Day | null)[][] {
  const first = days[0];
  if (!first) return [];
  const [year, month, date] = first.date.split("-").map(Number) as [number, number, number];
  const lead = (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
  const cells: (Day | null)[] = [...Array<null>(lead).fill(null), ...days];
  const weeks: (Day | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Each week's month label: a week whose Monday is in the first 7 days of a
 * month, and the first week unless the next one is labelled already.
 */
function monthLabels(weeks: (Day | null)[][]): string[] {
  const monday = (week: (Day | null)[], i: number) => {
    const [year, month, date] = (week.find((day) => day !== null)?.date ?? "").split("-").map(Number) as number[];
    return new Date(Date.UTC(year!, month! - 1, date! - (i === 0 ? week.findIndex((day) => day !== null) : 0)));
  };
  const labels = weeks.map((week, i) => {
    const start = monday(week, i);
    return start.getUTCDate() <= 7 ? MONTHS[start.getUTCMonth()]! : "";
  });
  const first = weeks[0];
  if (first && labels[0] === "" && !labels[1]) labels[0] = MONTHS[monday(first, 0).getUTCMonth()]!;
  return labels;
}

const SQUARE_TEXT: Record<Exclude<Square, "none">, string> = {
  satisfied: "Satisfied",
  missed: "Missed",
  excused: "Excused",
  "not-judged": "Not judged yet",
  open: "Due today",
  ahead: "Not open yet",
};

/**
 * The pact page's History: a GitHub-style grid, a column per week since the
 * first occurrence and a row per weekday, scrolled to now. Tapping a square
 * shows its day below the legend.
 */
export function HeatMap({ pact, timezone, now }: { pact: Json<PactTerms>; timezone: string; now: number }) {
  const { history } = pact;
  switch (history.kind) {
    case "weekly-count":
      return <WeeklyHeatMap weeks={history.weeks} timezone={timezone} now={now} />;
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
  const square = squareOf(record, now);
  const line = occurrenceLine(
    record,
    timezone,
    pact.reviewers.map((r) => r.name),
  );
  // Open before its date, with Submit anytime: it's due on the deadline's date, not today.
  const { status } = record;
  const dueOn =
    status.kind === "not-judged" &&
    !status.evidenceWaiting &&
    status.excuse === null &&
    square === "open" &&
    dateIn(now, timezone) !== day.date;
  return (
    <section className="card">
      <h3>History</h3>
      <div className="hmdetail one" role="status">
        <span className={`cell ${square === "none" ? "none" : square}`} aria-hidden="true" />
        <span className="rt">
          <span className="spread">
            <b>{formatDate(day.date)}</b>
            {dueOn ? (
              <span className="chip c-todo">Due {formatDate(day.date)}</span>
            ) : (
              <OccurrenceChip record={record} evidenceKind={pact.evidenceKind} now={now} />
            )}
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
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [days.length]);
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
            <div key={week.find((day) => day !== null)?.date ?? w} className="hm-col">
              <div className="hm-lbl mo">{months[w]}</div>
              {week.map((day, i) =>
                day === null ? (
                  <div key={i} />
                ) : (
                  <HeatMapSquare
                    key={day.date}
                    day={day}
                    square={squareOf(day.occurrence, now)}
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
            <OccurrenceChip record={picked.occurrence} evidenceKind={pact.evidenceKind} now={now} />
          </div>
          {line && <span className="small muted">{line}</span>}
        </div>
      ) : (
        <p className="small muted">Tap a day to see what happened.</p>
      )}
    </section>
  );
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
        <i className="cell not-judged" />
        Not judged yet
      </span>
    </div>
  );
}

/**
 * A Weekly count pact's History: one square per week since the first, each
 * with the number of days that counted, scrolled to now. Tapping one shows
 * the week below the legend.
 */
function WeeklyHeatMap({ weeks, timezone, now }: { weeks: Week[]; timezone: string; now: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks.length]);
  const picked = weeks.find((week) => week.date === selected && week.occurrence !== null);

  return (
    <section className="card">
      <h3>History</h3>
      <div className="hm-scroll" ref={scroller}>
        <div className="hm-weeks">
          {weeks.map((week, i) => {
            const square = squareOf(week.occurrence, now);
            const monday = new Date(`${week.date}T00:00:00Z`);
            const month = monday.getUTCDate() <= 7 || i === 0 ? MONTHS[monday.getUTCMonth()] : "";
            return (
              <div key={week.date} className="hm-wcol">
                <span className="hm-lbl">{month}</span>
                {square === "none" ? (
                  <div className="cell wk none" />
                ) : (
                  <button
                    className={`cell wk ${square}${week.date === selected ? " sel" : ""}`}
                    aria-label={`Week of ${formatDate(week.date)}: ${SQUARE_TEXT[square]}, ${weekText(week)}`}
                    aria-pressed={week.date === selected}
                    onClick={() => setSelected(week.date)}
                  >
                    {square === "excused" || square === "ahead" ? "" : week.progress.sessions}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="small muted">One square per week, with how many days counted.</p>
      <Legend />
      {picked?.occurrence ? (
        <div className="hmdetail" role="status">
          <div className="spread">
            <b>Week of {formatDate(picked.date)}</b>
            <DayChip status={picked.occurrence.status} now={now} week />
          </div>
          <span className="small muted">{weekLine(picked, timezone)}</span>
        </div>
      ) : (
        <p className="small muted">Tap a week to see what happened.</p>
      )}
    </section>
  );
}

/** "2 of 3", with "so far" while the week runs and how many photos wait. */
function weekText({ progress, occurrence }: Week): string {
  const { sessions, waiting, target } = progress;
  const running = occurrence?.status.kind === "not-judged";
  return [
    `${sessions} of ${target}${running ? " so far" : ""}`,
    ...(waiting > 0 ? [`${waiting} waiting for approval`] : []),
  ].join(" · ");
}

/** The line under a tapped week: how far it got, and what a short week cost or the excuse that covered it. */
function weekLine(week: Week, timezone: string): string {
  const record = week.occurrence;
  if (record === null) return "";
  const { status } = record;
  if (status.kind === "missed") {
    const short = week.progress.target - week.progress.sessions;
    return `${weekText(week)}. ${short} short: ${missedCost(status)}`;
  }
  const excused = occurrenceLine(record, timezone);
  if (status.kind === "excused" || excused !== "") return excused;
  return `${weekText(week)}.`;
}

function HeatMapSquare({
  day,
  square,
  selected,
  onSelect,
}: {
  day: Day;
  square: Square;
  selected: boolean;
  onSelect: () => void;
}) {
  if (square === "none") return <div className="cell none" />;
  return (
    <button
      className={`cell ${square}${selected ? " sel" : ""}`}
      aria-label={`${formatDate(day.date)}: ${SQUARE_TEXT[square]}`}
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
              <OccurrenceChip record={entry.occurrence} evidenceKind={entry.evidenceKind} now={now} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
