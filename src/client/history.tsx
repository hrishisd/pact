// History: the pact page's heat map and Today's Yesterday rows. Both show
// occurrences the core has already judged (or not); this only says how they
// look. The UI never says "pending": a day past due that isn't judged yet is
// "Not judged yet".

import { useEffect, useRef, useState } from "react";
import type { Json } from "../shared/api.ts";
import type { EvidenceKind, HeatMapDay, OccurrenceRecord, PactTerms, TodayYesterdayEntry } from "../shared/types.ts";
import { DayChip } from "./excuse-days.tsx";
import { listNames } from "./change-terms.tsx";
import { clockText, formatDate, money } from "./format.ts";

type Occurrence = Json<OccurrenceRecord>;
type Day = Json<HeatMapDay>;

/** How a square looks: an outcome, or for a day not judged yet whether it's ahead, open now or past due. */
type Square = "kept" | "missed" | "excused" | "not-judged" | "open" | "ahead" | "none";

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
  const { status } = record;
  if (
    evidenceKind === "oura" &&
    status.kind === "not-judged" &&
    status.excuse === null &&
    Date.parse(status.dueAt) <= now
  ) {
    return <span className="chip c-soon">No Oura data</span>;
  }
  return <DayChip status={status} now={now} />;
}

/**
 * The line under an occurrence: who decided it and why, when Oura saw the
 * owner get into bed, and what a miss cost. `reviewerNames` names who a
 * photo waits for; without it the chip says enough.
 */
function occurrenceLine(record: Occurrence, reviewerNames: string[] = []): string {
  const { status, decidedBy, recipientName, night } = record;
  const bed = night && (night.inBedAt === null ? "No sleep data by 6pm." : `In bed at ${clockText(night.inBedAt)}.`);
  switch (status.kind) {
    case "kept":
      if (bed) return bed;
      return decidedBy?.kind === "evidence-approved" ? `Photo approved by ${decidedBy.reviewerName}.` : "";
    case "missed": {
      const cost = status.held
        ? `${money(status.penaltyCents)} held.`
        : `${money(status.penaltyCents)} to ${recipientName ?? "your recipient"}.`;
      if (decidedBy?.kind === "evidence-rejected")
        return `${decidedBy.reviewerName} rejected the photo: “${sentence(decidedBy.reason)}” ${cost}`;
      return `${bed ?? "No photo."} ${cost}`;
    }
    case "excused":
    case "not-judged":
      if (decidedBy?.kind === "excuse-approved")
        return `Excuse approved by ${decidedBy.reviewerName}: “${sentence(decidedBy.reason)}”`;
      if (status.kind === "not-judged" && status.evidenceWaiting && reviewerNames.length > 0)
        return `Photo waiting for ${listNames(reviewerNames, "or")}.`;
      return "";
  }
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
  kept: "Kept",
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
export function HeatMap({ pact, now }: { pact: Json<PactTerms>; now: number }) {
  const { days } = pact.history;
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
      <div className="legend">
        <span>
          <i className="cell kept" />
          Kept
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
  now,
  onOpenPact,
}: {
  entries: Json<TodayYesterdayEntry>[];
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
          const line = occurrenceLine(entry.occurrence);
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
