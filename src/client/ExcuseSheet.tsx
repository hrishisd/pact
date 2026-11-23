// The File excuse sheet (option A in the excuses prototype): one pact, opened
// from a day (that day as a card, optionally run on to later days) or from
// the pact page ("Which day?": a recent day, or a range of days ahead). A
// live preview lists the days the dates cover and skip, and the footer says
// what filing holds.

import { useEffect, useState } from "react";
import type { FileExcuseRequest, Json } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import {
  MAX_EXCUSE_PHOTOS,
  MAX_EXCUSE_SPAN_DAYS,
  MAX_TEXT_CHARS,
  type ExcuseDatesRefusal,
  type ExcuseDay,
  type ExcuseOptions,
  type ExcusePreview,
  type FileExcuseRefusal,
  type PactTerms,
} from "../shared/types.ts";
import { api, failureText, TEXT_TOO_LONG_TEXT, uploadFailureText } from "./api.ts";
import { Chip, DayChip, SKIP_REASON_TEXT, excuseDayText, presentOccurrence } from "./excuse-days.tsx";
import { EDIT_WINDOW_TEXT, formatDate, hoursLeft, listNames, money, scheduleText } from "./format.ts";
import { usePhotoPicks } from "./photos.ts";
import { Sheet, useNow, useSend } from "./ui.tsx";

export interface ExcuseSheetProps {
  pactId: string;
  pactName: string;
  /**
   * The day it was opened from ("YYYY-MM-DD"): a Missed card, a To do card, a
   * rejected-evidence or rejected-excuse alert. Left out when opened from the
   * pact page, where the sheet asks "Which day?".
   */
  day?: string;
  /** The profile's timezone, for when a day is due. */
  timezone: string;
  onClose: () => void;
  /** After the excuse is filed: the opener reloads. */
  onFiled: () => void;
}

type Pact = Json<PactTerms>;
type Preview = Json<ExcusePreview>;
type Day = Json<ExcuseDay>;
type Dates = { from: string; to: string };

/** How the sheet was opened: on a day, or from the pact page with the days it offers. */
type Opened = { from: "day"; day: string } | { from: "pact-page"; options: Json<ExcuseOptions> };

/** What the sheet needs before it can show the form. */
type Loaded =
  | { kind: "loading" }
  | { kind: "loaded"; pact: Pact; opened: Opened }
  | { kind: "refused"; text: string }
  | { kind: "failed"; error: unknown };

export function ExcuseSheet({ pactId, pactName, day, timezone, onClose, onFiled }: ExcuseSheetProps) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    const loading = api.pact(pactId);
    // From the pact page, the days it offers come with the pact; a refusal is the words for it.
    const opening: Promise<Opened | string> =
      day !== undefined
        ? Promise.resolve({ from: "day", day })
        : api
            .excuseOptions(pactId)
            .then((options) =>
              options.ok ? { from: "pact-page", options: options.options } : OPEN_REFUSAL_TEXT[options.reason],
            );
    Promise.all([loading, opening]).then(
      ([pact, opened]) => {
        if (!live) return;
        if (!pact.ok) return setLoaded({ kind: "refused", text: "This pact wasn't found." });
        if (typeof opened === "string") return setLoaded({ kind: "refused", text: opened });
        setLoaded({ kind: "loaded", pact: pact.pact, opened });
      },
      (error: unknown) => live && setLoaded({ kind: "failed", error }),
    );
    return () => {
      live = false;
    };
  }, [pactId, day]);

  const title = day === undefined ? `Excuse ${pactName}` : `Excuse ${pactName}, ${formatDate(day)}`;
  return (
    <Sheet title={title} closeLabel="Cancel" onClose={onClose}>
      {loaded.kind === "loaded" ? (
        <ExcuseForm pact={loaded.pact} opened={loaded.opened} timezone={timezone} onFiled={onFiled} />
      ) : loaded.kind === "refused" ? (
        <p className="error small">{loaded.text}</p>
      ) : loaded.kind === "failed" ? (
        <p className="error small">
          {failureText(loaded.error, "This couldn't load. Check your connection and try again.")}
        </p>
      ) : null}
    </Sheet>
  );
}

const OPEN_REFUSAL_TEXT: Record<"pact-not-found" | "edit-window-open", string> = {
  "pact-not-found": "This pact wasn't found.",
  "edit-window-open": `You can file excuses once the ${EDIT_WINDOW_TEXT} for editing are over.`,
};

/** The preview for some dates: `key` says which, so a stale one isn't taken for the current. */
type PreviewState = {
  key: string;
  result: { ok: true; preview: Preview } | { ok: false; reason: ExcuseDatesRefusal };
} | null;

/**
 * The core's preview of `dates`, asked for again when they change, once both
 * are picked. `current` is the answer for these dates (null until it comes);
 * `shown` is the last good preview, which stays on screen while the next one
 * loads; `failure` is why the last ask failed.
 */
function useExcusePreview(pactId: string, dates: Dates) {
  const key = `${dates.from}/${dates.to}`;
  const [preview, setPreview] = useState<PreviewState>(null);
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  useEffect(() => {
    let live = true;
    setFailure(null);
    if (dates.from === "" || dates.to === "") return;
    api.excusePreview(pactId, dates).then(
      (result) => live && setPreview({ key, result }),
      (error: unknown) => live && setFailure({ error }),
    );
    return () => {
      live = false;
    };
    // `key` stands for `dates`.
  }, [pactId, key]);
  return {
    current: preview?.key === key ? preview.result : null,
    shown: preview?.result.ok ? preview.result.preview : null,
    failure,
  };
}

/** What the day pickers show about the dates picked: the preview, and what stands in for it when there's none. */
interface Shown {
  /** The last good preview (`useExcusePreview`'s `shown`). */
  preview: Preview | null;
  /** Why there's no preview for these dates: the core refused them, or asking failed. */
  problem: string | null;
  now: number;
  timezone: string;
}

/** The dates a sheet opened on a day starts with, and the ones it starts with from the pact page. */
function firstDates(opened: Opened): Dates {
  return opened.from === "day" ? { from: opened.day, to: opened.day } : pactPageDates(firstChoice(opened.options));
}

function ExcuseForm({
  pact,
  opened,
  timezone,
  onFiled,
}: {
  pact: Pact;
  opened: Opened;
  timezone: string;
  onFiled: () => void;
}) {
  const now = useNow();
  const reviewers = listNames(
    pact.reviewers.map((r) => r.name),
    "or",
  );
  const [dates, setDates] = useState(() => firstDates(opened));
  const [reason, setReason] = useState("");
  const { busy, error, setError, run } = useSend(
    async (excuse: FileExcuseRequest, photoBlobs: Blob[]) => {
      const result = await api.fileExcuse(pact.id, excuse, photoBlobs);
      if (!result.ok) return FILE_REFUSAL_TEXT[result.reason];
      onFiled();
    },
    (failure) =>
      uploadFailureText(
        failure,
        "A photo was too large to send. Remove it and add it again.",
        "Couldn't send. Check your connection and try again.",
      ),
  );

  const { current, shown, failure } = useExcusePreview(pact.id, dates);
  const covered = current?.ok ? current.preview.covered.length : 0;
  const ready = covered > 0 && reason.trim() !== "" && !busy;

  const photos = usePhotoPicks({
    max: MAX_EXCUSE_PHOTOS,
    unreadable: "That photo couldn't be read. Choose another.",
    setError,
  });

  const send = () => {
    if (ready)
      run(
        { ...dates, reason: reason.trim() },
        photos.photos.map((p) => p.blob),
      );
  };

  const { schedule, weekly } = scheduleWords(pact);
  const problem =
    current && !current.ok
      ? DATES_REFUSAL_TEXT[current.reason]
      : failure !== null
        ? failureText(failure.error, "The days couldn't load. Check your connection.")
        : null;
  const picked: Shown = { preview: shown, problem, now, timezone };

  const held = current?.ok ? current.preview.heldCents : 0;
  return (
    <>
      <span className="meta excuse-sub">
        {pact.name} is {schedule} · {money(pact.penaltyCents)} per miss
        {weekly && ". Excusing any day excuses the whole week."}
      </span>
      {opened.from === "day" ? (
        <DayDates pact={pact} day={opened.day} reviewers={reviewers} shown={picked} onDates={setDates} />
      ) : (
        <PactPageDates pact={pact} options={opened.options} shown={picked} onDates={setDates} />
      )}
      <label className="field">
        <span>Reason</span>
        <textarea
          className="inp"
          maxLength={MAX_TEXT_CHARS}
          value={reason}
          placeholder="e.g. Sick with the flu"
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="field">
        <span>Photos (optional)</span>
        <input ref={photos.input} type="file" accept="image/*" multiple hidden onChange={photos.onChange} />
        <div className="photos">
          {photos.photos.map((photo, i) => (
            <div key={photo.url} className="thumb">
              <img src={photo.url} alt={`Photo ${i + 1}`} />
              <button className="remove" aria-label={`Remove photo ${i + 1}`} onClick={() => photos.remove(photo)}>
                ×
              </button>
            </div>
          ))}
          {photos.photos.length < MAX_EXCUSE_PHOTOS && (
            <button className="ph-add" aria-label="Add a photo" onClick={photos.choose}>
              +
            </button>
          )}
        </div>
      </div>
      <div className="footbar excuse-foot">
        {current?.ok && (
          <span className="meta">
            {covered === 0
              ? "Pick at least one day that can be excused."
              : `Covers ${covered} ${covered === 1 ? "day" : "days"}.${held > 0 ? ` You won't owe the ${money(held)} for these days unless the excuse is rejected.` : ""}`}
          </span>
        )}
        {error && <p className="error small">{error}</p>}
        <button className="btn primary block" disabled={!ready} onClick={send}>
          {busy ? "Sending…" : `Send to ${reviewers}`}
        </button>
      </div>
    </>
  );
}

/** "Gym is Mon, Wed, Fri", "Read is every day", or "Piano is 3× per week": the schedule's words, and whether it's Weekly count. */
function scheduleWords(pact: Pact): { schedule: string; weekly: boolean } {
  return {
    schedule: scheduleText(pact.schedule).replace("Every day", "every day"),
    weekly: pact.schedule.kind === "weekly-count",
  };
}

/** What a range with no days (or weeks) of the pact says. */
function noDaysText(pact: Pact, from: string, to: string): string {
  const { schedule, weekly } = scheduleWords(pact);
  return `The pact has no ${weekly ? "weeks" : "days"} ${from === to ? `on ${formatDate(from)}` : `between ${formatDate(from)} and ${formatDate(to)}`}. Its schedule is ${schedule}.`;
}

/**
 * Opened on a day: that day as a card, then "+ Later days too", which runs
 * the excuse on through a later date once picked. Reports the dates up.
 */
function DayDates({
  pact,
  day,
  reviewers,
  shown: { preview, problem, now, timezone },
  onDates,
}: {
  pact: Pact;
  day: string;
  reviewers: string;
  shown: Shown;
  onDates: (dates: Dates) => void;
}) {
  const [more, setMore] = useState(false);
  const [through, setThrough] = useState("");
  const weekly = pact.schedule.kind === "weekly-count";
  const oura = pact.evidenceKind === "oura";
  const later = preview ? onlyAfter(preview, day) : null;
  return (
    <>
      <DayCard
        day={day}
        weekly={weekly}
        oura={oura}
        preview={preview}
        reviewers={reviewers}
        timezone={timezone}
        now={now}
      />
      {more ? (
        <>
          <label className="field">
            <span>Also excuse {pact.name} through</span>
            <input
              className="inp"
              type="date"
              value={through}
              min={day}
              onChange={(e) => {
                const picked = e.target.value;
                setThrough(picked);
                onDates({ from: day, to: picked !== "" ? picked : day });
              }}
            />
          </label>
          {through !== "" &&
            through > day &&
            (problem ??
              (later && (
                <DayList
                  preview={later}
                  weekly={weekly}
                  oura={oura}
                  timezone={timezone}
                  now={now}
                  empty={noDaysText(pact, addDays(day, 1), through)}
                />
              )))}
          {through !== "" && through < day && <p className="error small">Pick {formatDate(day)} or a later day.</p>}
        </>
      ) : (
        <button className="btn sm self-start" onClick={() => setMore(true)}>
          + Later days too, e.g. still sick
        </button>
      )}
    </>
  );
}

/** On the pact page: a recent day's date, or "ahead" with its own range. */
interface PageChoice {
  choice: string;
  aheadFrom: string;
  aheadTo: string;
}

/** The newest recent day, or Days ahead from today when there's none. */
function firstChoice(options: Json<ExcuseOptions>): PageChoice {
  return { choice: options.recentDays[0]?.date ?? "ahead", aheadFrom: options.today, aheadTo: options.today };
}

function pactPageDates({ choice, aheadFrom, aheadTo }: PageChoice): Dates {
  return choice === "ahead" ? { from: aheadFrom, to: aheadTo } : { from: choice, to: choice };
}

/**
 * Opened from the pact page: "Which day?", a recent day or Days ahead, which
 * picks a range from today on. Reports the dates up.
 */
function PactPageDates({
  pact,
  options,
  shown: { preview, problem, now, timezone },
  onDates,
}: {
  pact: Pact;
  options: Json<ExcuseOptions>;
  shown: Shown;
  onDates: (dates: Dates) => void;
}) {
  const [picked, setPicked] = useState(() => firstChoice(options));
  const { choice, aheadFrom, aheadTo } = picked;
  const change = (next: Partial<PageChoice>) => {
    const changed = { ...picked, ...next };
    setPicked(changed);
    onDates(pactPageDates(changed));
  };
  const weekly = pact.schedule.kind === "weekly-count";
  const oura = pact.evidenceKind === "oura";
  return (
    <>
      <div className="field">
        <span>Which day?</span>
        <div className="stack">
          {options.recentDays.map((d) => (
            <label key={d.date} className="opt">
              <input
                type="radio"
                name="excuse-day"
                checked={choice === d.date}
                onChange={() => change({ choice: d.date })}
              />
              <span className="rt">
                <b>{excuseDayText(d)}</b>
                <small>{recentNote(d, now, timezone, weekly, oura)}</small>
              </span>
              <DayChip status={d.status} now={now} timezone={timezone} week={weekly} oura={oura} />
            </label>
          ))}
          <label className="opt">
            <input
              type="radio"
              name="excuse-day"
              checked={choice === "ahead"}
              onChange={() => change({ choice: "ahead" })}
            />
            <span className="rt">
              <b>Days ahead</b>
              <small>A trip, or anything you know is coming</small>
            </span>
          </label>
        </div>
      </div>
      {choice === "ahead" && (
        <>
          <div className="dates">
            <label className="field">
              <span>From</span>
              <input
                className="inp"
                type="date"
                value={aheadFrom}
                min={options.today}
                onChange={(e) => {
                  const from = e.target.value;
                  change({
                    aheadFrom: from,
                    ...(from !== "" && (aheadTo === "" || aheadTo < from) && { aheadTo: from }),
                  });
                }}
              />
            </label>
            <label className="field">
              <span>To</span>
              <input
                className="inp"
                type="date"
                value={aheadTo}
                min={aheadFrom}
                onChange={(e) => change({ aheadTo: e.target.value })}
              />
            </label>
          </div>
          {aheadFrom !== "" &&
            aheadTo !== "" &&
            (problem ??
              (preview && (
                <DayList
                  preview={preview}
                  weekly={weekly}
                  oura={oura}
                  timezone={timezone}
                  now={now}
                  empty={noDaysText(pact, aheadFrom, aheadTo)}
                />
              )))}
        </>
      )}
    </>
  );
}

/**
 * The day the sheet was opened from: its date and chip, what it costs, and
 * in orange the time left to file for a Missed day. A day the preview skips
 * says why instead.
 */
function DayCard({
  day,
  weekly,
  oura,
  preview,
  reviewers,
  timezone,
  now,
}: {
  day: string;
  /** A Weekly count pact: the day stands for its week, which the preview dates by its Monday. */
  weekly: boolean;
  /** A bedtime pact: a night not judged yet is waiting on Oura. */
  oura: boolean;
  preview: Preview | null;
  reviewers: string;
  timezone: string;
  now: number;
}) {
  // On Weekly count, the core dates a day by its week: its Monday, through its Sunday.
  const holds = (d: { date: string; through?: string }) => d.date <= day && day <= (d.through ?? d.date);
  const covered = preview?.covered.find(holds);
  const status = covered?.status;
  const presented = status && presentOccurrence(status, now, { timezone, week: weekly, oura });
  const skipped = preview?.skipped.find(holds);
  const week = covered?.date ?? skipped?.date;
  return (
    <div className="card excuse-day">
      <div className="spread">
        <b>{weekly && week !== undefined ? `Week of ${formatDate(week)}` : formatDate(day)}</b>
        {presented && <Chip chip={presented.chip} />}
      </div>
      {status?.kind === "missed" ? (
        <>
          <span className="meta">
            <b className="pen">{money(status.penaltyCents)}</b> held while {reviewers} decides
          </span>
          <span className="meta due">{hoursLeft(Date.parse(status.excusableUntil) - now)} left to file an excuse</span>
        </>
      ) : presented ? (
        <span className="meta">{presented.note}</span>
      ) : skipped ? (
        <span className="meta">{SKIP_REASON_TEXT[skipped.reason]}</span>
      ) : null}
    </div>
  );
}

/** A date range's days (or a Weekly count pact's weeks), in date order: Covered ones with their note, Skipped ones with why. */
function DayList({
  preview,
  weekly,
  oura,
  timezone,
  now,
  empty,
}: {
  preview: Preview;
  weekly: boolean;
  oura: boolean;
  timezone: string;
  now: number;
  empty: string;
}) {
  const rows = [
    ...preview.covered.map((d) => ({
      date: d.date,
      covered: true,
      note: presentOccurrence(d.status, now, { timezone, week: weekly, oura }).note,
    })),
    ...preview.skipped.map((d) => ({ date: d.date, covered: false, note: SKIP_REASON_TEXT[d.reason] })),
  ].sort((a, b) => a.date.localeCompare(b.date, "en-US"));
  if (rows.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <div className="list">
      {rows.map((row) => (
        <div key={row.date} className={row.covered ? "covrow" : "covrow skip"}>
          <span className="rt">
            <b>{weekly ? `Week of ${formatDate(row.date)}` : formatDate(row.date)}</b>
            {row.note && <small>{row.note}</small>}
          </span>
          {row.covered ? <span className="chip c-excused">Covered</span> : <span className="chip c-soon">Skipped</span>}
        </div>
      ))}
    </div>
  );
}

/** The small line on a recent day's radio row: the time left to file for a miss, else the day's note. */
function recentNote(d: Day, now: number, timezone: string, weekly: boolean, oura: boolean): string {
  const { status } = d;
  if (status.kind === "missed")
    return `${money(status.penaltyCents)} · ${hoursLeft(Date.parse(status.excusableUntil) - now)} left to file an excuse`;
  return presentOccurrence(status, now, { timezone, week: weekly, oura }).note;
}

/** `preview` without `day` and the days before it: the later days a run-on adds. */
function onlyAfter(preview: Preview, day: string): Preview {
  return {
    covered: preview.covered.filter((d) => d.date > day),
    skipped: preview.skipped.filter((d) => d.date > day),
    heldCents: preview.heldCents,
  };
}

const DATES_REFUSAL_TEXT: Record<ExcuseDatesRefusal, string> = {
  "pact-not-found": "This pact wasn't found.",
  "edit-window-open": `You can file excuses once the ${EDIT_WINDOW_TEXT} for editing are over.`,
  "invalid-dates": "The last day is before the first. Pick the dates again.",
  "too-many-days": `One excuse can cover at most ${MAX_EXCUSE_SPAN_DAYS} days. Pick fewer.`,
};

const FILE_REFUSAL_TEXT: Record<FileExcuseRefusal, string> = {
  ...DATES_REFUSAL_TEXT,
  "blank-reason": "Write a reason first.",
  "text-too-long": TEXT_TOO_LONG_TEXT,
  "too-many-photos": `You can add at most ${MAX_EXCUSE_PHOTOS} photos.`,
  "nothing-to-excuse": "None of these days can be excused now.",
};
