// The File excuse sheet (option A in the excuses prototype): one pact, opened
// from a day (that day as a card, optionally run on to later days) or from
// the pact page ("Which day?": a recent day, or a range of days ahead). A
// live preview lists the days the dates cover and skip, and the footer says
// what filing holds.

import { useEffect, useRef, useState } from "react";
import type { Json } from "../shared/api.ts";
import {
  MAX_EXCUSE_PHOTOS,
  MAX_EXCUSE_SPAN_DAYS,
  type ExcuseDatesRefusal,
  type ExcuseDay,
  type ExcuseOptions,
  type ExcusePreview,
  type FileExcuseRefusal,
  type PactTerms,
} from "../shared/types.ts";
import { api, failureText, uploadFailureText } from "./api.ts";
import { DayChip, SKIP_REASON_TEXT, dayNote, excuseDayText } from "./excuse-days.tsx";
import { formatDate, money, scheduleText, hoursLeft } from "./format.ts";
import { shrinkForPreview, type ShrunkPhoto } from "./photos.ts";
import { Sheet, useNow } from "./ui.tsx";

export interface ExcuseSheetProps {
  pactId: string;
  pactName: string;
  /**
   * The day it was opened from ("YYYY-MM-DD"): a Missed card, a To do card, a
   * rejected-evidence or rejected-excuse alert. Left out when opened from the
   * pact page, where the sheet asks "Which day?".
   */
  day?: string;
  onClose: () => void;
  /** After the excuse is filed: the opener reloads. */
  onFiled: () => void;
}

type Pact = Json<PactTerms>;
type Preview = Json<ExcusePreview>;
type Day = Json<ExcuseDay>;
type Dates = { from: string; to: string };

/** What the sheet needs before it can show the form. */
type Loaded =
  | { kind: "loading" }
  | { kind: "loaded"; pact: Pact; options: Json<ExcuseOptions> | null }
  | { kind: "refused"; text: string }
  | { kind: "failed"; error: unknown };

/** The preview for some dates: `key` says which, so a stale one isn't taken for the current. */
type PreviewState = {
  key: string;
  result: { ok: true; preview: Preview } | { ok: false; reason: ExcuseDatesRefusal };
} | null;

export function ExcuseSheet({ pactId, pactName, day, onClose, onFiled }: ExcuseSheetProps) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    Promise.all([api.pact(pactId), day === undefined ? api.excuseOptions(pactId) : null]).then(
      ([pact, options]) => {
        if (!live) return;
        if (!pact.ok) return setLoaded({ kind: "refused", text: "This pact wasn't found." });
        if (options && !options.ok) return setLoaded({ kind: "refused", text: OPEN_REFUSAL_TEXT[options.reason] });
        setLoaded({ kind: "loaded", pact: pact.pact, options: options?.options ?? null });
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
        <ExcuseForm pact={loaded.pact} options={loaded.options} day={day} onFiled={onFiled} />
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
  "edit-window-open": "Excuses open once the 10 minutes are up.",
};

function ExcuseForm({
  pact,
  options,
  day,
  onFiled,
}: {
  pact: Pact;
  /** Only when opened without a day. */
  options: Json<ExcuseOptions> | null;
  day: string | undefined;
  onFiled: () => void;
}) {
  const now = useNow();
  const reviewers = pact.reviewers.map((r) => r.name).join(" or ");
  // From a day: run on to later days through `through`, once picked.
  const [more, setMore] = useState(false);
  const [through, setThrough] = useState("");
  // From the pact page: a recent day's date, or "ahead" with its own range.
  const [choice, setChoice] = useState(() => options?.recentDays[0]?.date ?? "ahead");
  const [aheadFrom, setAheadFrom] = useState(options?.today ?? "");
  const [aheadTo, setAheadTo] = useState(options?.today ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dates: Dates =
    day !== undefined
      ? { from: day, to: more && through !== "" ? through : day }
      : choice === "ahead"
        ? { from: aheadFrom, to: aheadTo }
        : { from: choice, to: choice };
  const key = `${dates.from}/${dates.to}`;

  const [preview, setPreview] = useState<PreviewState>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    setPreviewError(null);
    if (dates.from === "" || dates.to === "") return;
    api.excusePreview(pact.id, dates).then(
      (result) => live && setPreview({ key, result }),
      (failure: unknown) => live && setPreviewError(failure),
    );
    return () => {
      live = false;
    };
    // `key` stands for `dates`.
  }, [pact.id, key]);

  const current = preview?.key === key ? preview.result : null;
  // The last good preview stays on screen while the next one loads.
  const shown = preview?.result.ok ? preview.result.preview : null;
  const covered = current?.ok ? current.preview.covered.length : 0;
  const ready = covered > 0 && reason.trim() !== "" && !busy;

  const photos = usePhotos(setError);

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.fileExcuse(
        pact.id,
        { ...dates, reason: reason.trim() },
        photos.list.map((p) => p.blob),
      );
      if (result.ok) return onFiled();
      setError(FILE_REFUSAL_TEXT[result.reason]);
    } catch (failure) {
      setError(
        uploadFailureText(
          failure,
          "A photo was too large to send. Remove it and add it again.",
          "Couldn't send. Check your connection and try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  // "Gym is Mon, Wed, Fri", "Read is every day", or "Piano is 3× per week".
  const schedule = scheduleText(pact.schedule).replace("Every day", "every day");
  const weekly = pact.schedule.kind === "weekly-count";
  const noDays = (from: string, to: string) =>
    `No ${pact.name} ${weekly ? "week" : "day"} ${from === to ? `on ${formatDate(from)}` : `between ${formatDate(from)} and ${formatDate(to)}`}. It's ${schedule}.`;
  const refusal = current && !current.ok ? DATES_REFUSAL_TEXT[current.reason] : null;
  const previewFailed =
    previewError !== null ? failureText(previewError, "The days couldn't load. Check your connection.") : null;

  let days;
  if (day !== undefined) {
    const later = shown ? onlyAfter(shown, day) : null;
    days = (
      <>
        <DayCard day={day} weekly={weekly} preview={shown} reviewers={reviewers} now={now} />
        {more ? (
          <>
            <label className="field">
              <span>Also excuse {pact.name} through</span>
              <input
                className="inp"
                type="date"
                value={through}
                min={day}
                onChange={(e) => setThrough(e.target.value)}
              />
            </label>
            {through !== "" &&
              through > day &&
              (refusal ??
                previewFailed ??
                (later && <DayList preview={later} weekly={weekly} now={now} empty={noDays(nextDay(day), through)} />))}
            {through !== "" && through < day && <p className="error small">Pick {formatDate(day)} or a later day.</p>}
          </>
        ) : (
          <button className="btn sm self-start" onClick={() => setMore(true)}>
            + Later days too, e.g. still sick
          </button>
        )}
      </>
    );
  } else {
    const recent = options?.recentDays ?? [];
    days = (
      <>
        <div className="field">
          <span>Which day?</span>
          <div className="stack">
            {recent.map((d) => (
              <label key={d.date} className="opt">
                <input type="radio" name="excuse-day" checked={choice === d.date} onChange={() => setChoice(d.date)} />
                <span className="rt">
                  <b>{excuseDayText(d)}</b>
                  <small>{recentNote(d, now, weekly)}</small>
                </span>
                <DayChip status={d.status} now={now} week={weekly} />
              </label>
            ))}
            <label className="opt">
              <input type="radio" name="excuse-day" checked={choice === "ahead"} onChange={() => setChoice("ahead")} />
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
                  min={options?.today}
                  onChange={(e) => {
                    const from = e.target.value;
                    setAheadFrom(from);
                    if (from !== "" && (aheadTo === "" || aheadTo < from)) setAheadTo(from);
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
                  onChange={(e) => setAheadTo(e.target.value)}
                />
              </label>
            </div>
            {aheadFrom !== "" &&
              aheadTo !== "" &&
              (refusal ??
                previewFailed ??
                (shown && <DayList preview={shown} weekly={weekly} now={now} empty={noDays(aheadFrom, aheadTo)} />))}
          </>
        )}
      </>
    );
  }

  const held = current?.ok ? current.preview.heldCents : 0;
  return (
    <>
      <span className="meta excuse-sub">
        {pact.name} is {schedule} · {money(pact.penaltyCents)} per miss
        {weekly && ". Excusing any day excuses the whole week."}
      </span>
      {days}
      <label className="field">
        <span>Reason</span>
        <textarea
          className="inp"
          value={reason}
          placeholder="e.g. Sick with the flu"
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="field">
        <span>Photos (optional)</span>
        <input
          ref={photos.input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void photos.add(files);
          }}
        />
        <div className="photos">
          {photos.list.map((photo, i) => (
            <div key={photo.url} className="thumb">
              <img src={photo.url} alt={`Photo ${i + 1}`} />
              <button className="remove" aria-label={`Remove photo ${i + 1}`} onClick={() => photos.remove(photo)}>
                ×
              </button>
            </div>
          ))}
          {photos.list.length < MAX_EXCUSE_PHOTOS && (
            <button className="ph-add" aria-label="Add a photo" onClick={() => photos.input.current?.click()}>
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
              : `Covers ${covered} ${covered === 1 ? "day" : "days"}.${held > 0 ? ` ${money(held)} is held off what you owe until it's decided.` : ""}`}
          </span>
        )}
        {error && <p className="error small">{error}</p>}
        <button className="btn primary block" disabled={!ready} onClick={() => void send()}>
          {busy ? "Sending…" : `Send to ${reviewers}`}
        </button>
      </div>
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
  preview,
  reviewers,
  now,
}: {
  day: string;
  /** A Weekly count pact: the day stands for its week, which the preview dates by its Monday. */
  weekly: boolean;
  preview: Preview | null;
  reviewers: string;
  now: number;
}) {
  const holds = (date: string) => (weekly ? date <= day && day <= weekEnd(date) : date === day);
  const covered = preview?.covered.find((d) => holds(d.date));
  const status = covered?.status;
  const skipped = preview?.skipped.find((d) => holds(d.date));
  const week = covered?.date ?? skipped?.date;
  return (
    <div className="card excuse-day">
      <div className="spread">
        <b>{weekly && week !== undefined ? `Week of ${formatDate(week)}` : formatDate(day)}</b>
        {status && <DayChip status={status} now={now} week={weekly} />}
      </div>
      {status?.kind === "missed" ? (
        <>
          <span className="meta">
            <b className="pen">{money(status.penaltyCents)}</b> held while {reviewers} decides
          </span>
          <span className="meta due">{hoursLeft(Date.parse(status.excusableUntil) - now)} left to file an excuse</span>
        </>
      ) : status ? (
        <span className="meta">{dayNote(status, now, weekly)}</span>
      ) : skipped ? (
        <span className="meta">{SKIP_REASON_TEXT[skipped.reason]}</span>
      ) : null}
    </div>
  );
}

/** A date range's days (or a Weekly count pact's weeks), in date order: Covered ones with their note, Skipped ones with why. */
function DayList({ preview, weekly, now, empty }: { preview: Preview; weekly: boolean; now: number; empty: string }) {
  const rows = [
    ...preview.covered.map((d) => ({ date: d.date, covered: true, note: dayNote(d.status, now, weekly) })),
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
function recentNote(d: Day, now: number, weekly: boolean): string {
  const { status } = d;
  if (status.kind === "missed")
    return `${money(status.penaltyCents)} · ${hoursLeft(Date.parse(status.excusableUntil) - now)} left to file an excuse`;
  return dayNote(status, now, weekly);
}

/** `preview` without `day` and the days before it: the later days a run-on adds. */
function onlyAfter(preview: Preview, day: string): Preview {
  return {
    covered: preview.covered.filter((d) => d.date > day),
    skipped: preview.skipped.filter((d) => d.date > day),
    heldCents: preview.heldCents,
  };
}

/** The calendar day after `isoDate`, "YYYY-MM-DD". */
function nextDay(isoDate: string): string {
  return daysAfter(isoDate, 1);
}

/** The Sunday ending the Mon–Sun week that starts on the Monday `isoDate`. */
function weekEnd(isoDate: string): string {
  return daysAfter(isoDate, 6);
}

function daysAfter(isoDate: string, days: number): string {
  const [year, month, date] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/**
 * The excuse's photos, from the camera or the library, each shrunk before
 * it's shown; at most MAX_EXCUSE_PHOTOS. Thumbnails' object URLs are revoked
 * when a photo is removed and when the sheet goes.
 */
function usePhotos(onError: (text: string | null) => void) {
  const input = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<ShrunkPhoto[]>([]);
  const urls = useRef<string[]>([]);
  urls.current = list.map((photo) => photo.url);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const add = async (files: File[]) => {
    onError(null);
    for (const file of files.slice(0, MAX_EXCUSE_PHOTOS - list.length)) {
      try {
        const photo = await shrinkForPreview(file);
        if (!mounted.current) {
          URL.revokeObjectURL(photo.url);
          return;
        }
        setList((added) => {
          if (added.length < MAX_EXCUSE_PHOTOS) return [...added, photo];
          URL.revokeObjectURL(photo.url);
          return added;
        });
      } catch {
        if (mounted.current) onError("That photo couldn't be read. Choose another.");
      }
    }
  };
  const remove = (photo: ShrunkPhoto) => {
    URL.revokeObjectURL(photo.url);
    setList((added) => added.filter((p) => p !== photo));
  };
  return { input, list, add, remove };
}

const DATES_REFUSAL_TEXT: Record<ExcuseDatesRefusal, string> = {
  "pact-not-found": "This pact wasn't found.",
  "edit-window-open": "Excuses open once the 10 minutes are up.",
  "invalid-dates": "The last day is before the first. Pick the dates again.",
  "too-many-days": `One excuse can cover at most ${MAX_EXCUSE_SPAN_DAYS} days. Pick fewer.`,
};

const FILE_REFUSAL_TEXT: Record<FileExcuseRefusal, string> = {
  ...DATES_REFUSAL_TEXT,
  "blank-reason": "Write a reason first.",
  "too-many-photos": `An excuse can have at most ${MAX_EXCUSE_PHOTOS} photos. Remove some.`,
  "nothing-to-excuse": "None of these days can be excused now.",
};
