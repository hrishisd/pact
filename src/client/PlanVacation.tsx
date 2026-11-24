// Plan a vacation, from Profile: Dates, Pacts, Reviewers, then Check it
// over, which shows the core's preview of what each pact gives up before
// Ask for approval. The core decides every rule (the dates, which pacts and
// reviewers may be picked, what's covered); the steps show its answers.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { VacationOptionsResponse, VacationPreviewRequest, VacationPreviewResponse } from "../shared/api.ts";
import { dayCount } from "../shared/calendar.ts";
import { periodKindOfSchedule } from "../shared/schedules.ts";
import { MAX_EXCUSE_SPAN_DAYS, MAX_TEXT_CHARS, type FileVacationRefusal } from "../shared/types.ts";
import { api, failureText, TEXT_TOO_LONG_TEXT } from "./api.ts";
import { dateSpan, formatDate, listNames, money, scheduleText } from "./format.ts";
import { CameraIcon, CardsIcon, RingIcon } from "./icons.tsx";
import {
  coveredText,
  firstName,
  occurrenceNames,
  pactsText,
  periodLabel,
  periodsText,
  plural,
  weekOf,
} from "./vacation-text.ts";
import { Loaded, settleUnlessDropped, useLoad, useSend } from "./ui.tsx";

type Options = VacationOptionsResponse;
type PactOption = Options["recurring"][number];
type Preview = Extract<VacationPreviewResponse, { ok: true }>["preview"];
type PactPreview = Preview["pacts"][number];

const STEPS = ["dates", "pacts", "reviewers", "check"] as const;
type Step = (typeof STEPS)[number];

export function PlanVacation({
  onCancel,
  onSent,
}: {
  onCancel: () => void;
  /** After asking for approval, with what the Profile sheet then says. */
  onSent: (message: string) => void;
}) {
  const { state } = useLoad(() => api.vacationOptions());
  return (
    <Loaded state={state} what="Your pacts">
      {(options) => <VacationSteps options={options} onCancel={onCancel} onSent={onSent} />}
    </Loaded>
  );
}

function VacationSteps({
  options,
  onCancel,
  onSent,
}: {
  options: Options;
  onCancel: () => void;
  onSent: (message: string) => void;
}) {
  const offered = [...options.recurring, ...options.oneTime];
  const [step, setStep] = useState<Step>("dates");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  // Every recurring pact is ticked to start with; One-time ones aren't.
  const [pactIds, setPactIds] = useState<string[]>(() =>
    options.recurring.filter((pact) => !pact.alreadyOpen).map((pact) => pact.id),
  );
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
  }, [step]);

  const ticked = offered.filter((pact) => pactIds.includes(pact.id));
  const possibleReviewers = reviewersOf(ticked);
  const preview = usePreview(from === "" || to === "" ? null : { from, to, pactIds });

  /** Ticks or unticks pacts, dropping any ticked reviewer who then reviews none of them. */
  const pick = (ids: string[]) => {
    setPactIds(ids);
    const still = new Set(reviewersOf(offered.filter((pact) => ids.includes(pact.id))).map((r) => r.id));
    setReviewerIds((picked) => picked.filter((id) => still.has(id)));
  };

  const {
    busy,
    error: sendError,
    run: ask,
  } = useSend(
    async () => {
      const result = await api.fileVacation({ from, to, note, pactIds, reviewerIds });
      if (!result.ok) return refusalText(result.reason, from, to);
      const names = possibleReviewers.filter((r) => reviewerIds.includes(r.id)).map((r) => firstName(r.name));
      onSent(`Sent to ${listNames(names)} for approval.`);
    },
    (error) => `Couldn't send it. ${failureText(error, "Check your connection and try again.")}`,
    { leavesScreen: true },
  );

  const shown = preview.kind === "loaded" ? preview.result : null;
  const datesProblem = shown && !shown.ok ? refusalText(shown.reason, from, to) : null;
  let body: ReactNode;
  let ready: boolean;
  switch (step) {
    case "dates":
      ready = shown?.ok === true;
      body = (
        <>
          <h2>Dates</h2>
          <div className="dates">
            <label className="field">
              <span>First day</span>
              <input className="inp" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span>Last day</span>
              <input className="inp" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          {datesProblem ? (
            <p className="error">{datesProblem}</p>
          ) : (
            shown?.ok && (
              <p className="small muted">
                {plural(shown.preview.days, "day", "days")}, {formatDate(from)} – {formatDate(to)}.
              </p>
            )
          )}
          {preview.kind === "failed" && <p className="error">{preview.text}</p>}
          <p className="small muted">
            On these days, the pacts you pick are excused. You won't get reminders or penalties for them. A vacation can
            be at most {MAX_EXCUSE_SPAN_DAYS} days.
          </p>
          <label className="field">
            <span>What are you doing? (optional)</span>
            <input
              className="inp"
              type="text"
              placeholder="Going to Portugal"
              maxLength={MAX_TEXT_CHARS}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </>
      );
      break;
    case "pacts": {
      ready = pactIds.length > 0;
      const tickable = offered.filter((pact) => !pact.alreadyOpen);
      const all = tickable.length > 0 && tickable.every((pact) => pactIds.includes(pact.id));
      const row = (pact: PactOption, extra?: ReactNode) => (
        <label key={pact.id} className="opt">
          <input
            type="checkbox"
            checked={pactIds.includes(pact.id)}
            disabled={pact.alreadyOpen}
            onChange={(e) => pick(e.target.checked ? [...pactIds, pact.id] : pactIds.filter((id) => id !== pact.id))}
          />
          <span className="rt">
            <b>{pact.name}</b>
            <small>{termsLine(pact)}</small>
            {extra}
          </span>
        </label>
      );
      body = (
        <>
          <h2>Pacts</h2>
          <section className="stack">
            <div className="spread">
              <div className="label">Which pacts go on vacation</div>
              <button className="link small" onClick={() => pick(all ? [] : tickable.map((pact) => pact.id))}>
                {all ? "Clear" : "Select all"}
              </button>
            </div>
            {options.recurring.map((pact) => row(pact))}
          </section>
          {options.oneTime.length > 0 && (
            <section className="stack">
              <div className="label">One-time pacts</div>
              {options.oneTime.map((pact) => row(pact, <small>{oneTimeLine(pact, from, to)}</small>))}
            </section>
          )}
          {options.inEditWindow && (
            <p className="small muted">A new pact can go on a vacation once its 10 minutes for editing are over.</p>
          )}
          {!ready && <p className="error">Pick at least one pact.</p>}
        </>
      );
      break;
    }
    case "reviewers":
      ready = reviewerIds.length > 0;
      body = (
        <>
          <h2>Reviewers</h2>
          <p className="small muted">
            Whoever you tick gets the request. Any one of them can approve or reject the whole vacation.
          </p>
          <section className="stack">
            {possibleReviewers.map((reviewer) => (
              <label key={reviewer.id} className="opt">
                <input
                  type="checkbox"
                  checked={reviewerIds.includes(reviewer.id)}
                  onChange={(e) =>
                    setReviewerIds(
                      e.target.checked ? [...reviewerIds, reviewer.id] : reviewerIds.filter((id) => id !== reviewer.id),
                    )
                  }
                />
                <span className="rt">
                  <b>{reviewer.name}</b>
                  <small>
                    Reviews{" "}
                    {listNames(
                      ticked
                        .filter((pact) => pact.reviewers.some((r) => r.id === reviewer.id))
                        .map((pact) => pact.name),
                    )}
                  </small>
                </span>
              </label>
            ))}
          </section>
          {!ready && <p className="error">Tick at least one reviewer.</p>}
        </>
      );
      break;
    case "check": {
      const picked = possibleReviewers.filter((r) => reviewerIds.includes(r.id));
      ready = shown?.ok === true && !shown.preview.coversNothing && !busy;
      body = (
        <>
          <h2>Check it over</h2>
          <div className="card">
            <SummaryRow label="Dates" onEdit={() => setStep("dates")}>
              <b>
                {formatDate(from)} – {formatDate(to)}
              </b>
              {shown?.ok && <span className="small muted">{plural(shown.preview.days, "day", "days")}</span>}
              {note.trim() !== "" && <span className="small">{note.trim()}</span>}
            </SummaryRow>
            <SummaryRow label="Pacts" onEdit={() => setStep("pacts")}>
              <b>{shown?.ok ? pactsText(shown.preview.summary) : listNames(ticked.map((pact) => pact.name))}</b>
            </SummaryRow>
            <SummaryRow label="Reviewers" onEdit={() => setStep("reviewers")}>
              {picked.length > 1 ? (
                <>
                  <b>{listNames(picked.map((r) => r.name))}.</b>
                  <span className="small muted">{picked.length === 2 ? "Either" : "Any one"} can decide.</span>
                </>
              ) : (
                picked[0] && (
                  <>
                    <b>{picked[0].name}.</b>
                    <span className="small muted">Only {firstName(picked[0].name)} gets the request.</span>
                  </>
                )
              )}
            </SummaryRow>
          </div>
          {datesProblem && <p className="error">{datesProblem}</p>}
          {preview.kind === "failed" && <p className="error">{preview.text}</p>}
          {shown?.ok && (
            <section className="stack">
              <div className="label">What's excused</div>
              <div className="list">
                {shown.preview.pacts.map((pactPreview) => {
                  const pact = offered.find((p) => p.id === pactPreview.pactId);
                  return pact && <CoverRow key={pact.id} pact={pact} preview={pactPreview} from={from} to={to} />;
                })}
              </div>
              <p className="small muted">Once approved, reminders stop on these days for the pacts on vacation.</p>
            </section>
          )}
          {shown?.ok && shown.preview.coversNothing ? (
            <p className="error">There's nothing left for this vacation to cover.</p>
          ) : (
            <div className="alert info">
              <p className="small">
                Until it's approved, your pacts run as usual. If you miss a day it covers, the penalty is held until a
                reviewer decides. Once approved, the vacation can't be changed.
              </p>
            </div>
          )}
          {sendError && <p className="error">{sendError}</p>}
        </>
      );
      break;
    }
  }

  const index = STEPS.indexOf(step);
  return (
    <>
      <div className="stack" ref={top}>
        <div className="steps" aria-hidden="true">
          {STEPS.map((s, i) => (
            <i key={s} className={i <= index ? "on" : undefined} />
          ))}
        </div>
        <small className="muted">
          Step {index + 1} of {STEPS.length}
        </small>
      </div>
      {body}
      <div className="footbar">
        {index === 0 ? (
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button className="btn" disabled={busy} onClick={() => setStep(STEPS[index - 1]!)}>
            Back
          </button>
        )}
        {step === "check" ? (
          <button className="btn primary grow" disabled={!ready} onClick={() => ask()}>
            {busy ? "Sending…" : "Ask for approval"}
          </button>
        ) : (
          <button className="btn primary grow" disabled={!ready} onClick={() => setStep(STEPS[index + 1]!)}>
            Next
          </button>
        )}
      </div>
    </>
  );
}

function SummaryRow({ label, onEdit, children }: { label: string; onEdit: () => void; children: ReactNode }) {
  return (
    <div className="sumrow">
      <div className="spread">
        <span className="label">{label}</span>
        <button className="link small" aria-label={`Edit ${label.toLowerCase()}`} onClick={onEdit}>
          Edit
        </button>
      </div>
      {children}
    </div>
  );
}

/** The core's preview for the dates and pacts as they stand, once both days are picked. */
function usePreview(
  request: VacationPreviewRequest | null,
): { kind: "none" } | { kind: "loaded"; result: VacationPreviewResponse } | { kind: "failed"; text: string } {
  const key = request && JSON.stringify(request);
  const [state, setState] = useState<
    { key: string; result: VacationPreviewResponse } | { key: string; text: string }
  >();
  useEffect(() => {
    if (!request || key === null) return;
    return settleUnlessDropped(
      api.vacationPreview(request),
      (result) => setState({ key, result }),
      (error) =>
        setState({
          key,
          text: `Couldn't check these days. ${failureText(error, "Check your connection and try again.")}`,
        }),
    );
    // `key` stands for `request`, which is a new object each render.
  }, [key]);
  if (!state || state.key !== key) return { kind: "none" };
  return "result" in state ? { kind: "loaded", result: state.result } : { kind: "failed", text: state.text };
}

/** The reviewers of `pacts`, each once, by name. */
function reviewersOf(pacts: PactOption[]): PactOption["reviewers"] {
  const byId = new Map(pacts.flatMap((pact) => pact.reviewers).map((r) => [r.id, r]));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "en-US"));
}

const KIND_NAMES: Record<PactOption["evidenceKind"], string> = { camera: "Camera", oura: "Oura Ring", anki: "Anki" };

/** "Camera · Mon, Wed, Fri · $5", or "Camera · 3× per week · $20 per short day". */
function termsLine(pact: PactOption): string {
  const perShortDay = pact.schedule.kind === "weekly-count" ? " per short day" : "";
  return `${KIND_NAMES[pact.evidenceKind]} · ${scheduleText(pact.schedule)} · ${money(pact.penaltyCents)}${perShortDay}`;
}

/** A One-time pact's line on the Pacts step: whether its deadline is inside the dates. */
function oneTimeLine(pact: PactOption, from: string, to: string): string {
  if (pact.alreadyOpen) return "You can already submit for it, so file an excuse instead.";
  const { schedule } = pact;
  const inside = schedule.kind === "one-time" && from <= schedule.deadline && schedule.deadline <= to;
  return inside
    ? "Its deadline is during your vacation. Tick it to excuse the deadline. The pact then ends."
    : "Its deadline isn't during your vacation.";
}

const KIND_ICONS: Record<PactOption["evidenceKind"], { className: string; icon: ReactNode }> = {
  camera: { className: "k-evidence", icon: <CameraIcon /> },
  oura: { className: "k-ring", icon: <RingIcon /> },
  anki: { className: "k-anki", icon: <CardsIcon /> },
};

const SKIP_TEXT: Record<PactPreview["skipped"][number]["reason"], string> = {
  "already-open": "already started",
  excused: "already excused",
  "on-waiting-excuse": "on an excuse waiting for approval",
  "on-vacation": "on another vacation",
};

/** One offered pact's row under "What's excused": what it gives up, or what it keeps when unticked. */
function CoverRow({ pact, preview, from, to }: { pact: PactOption; preview: PactPreview; from: string; to: string }) {
  const { className, icon } = KIND_ICONS[pact.evidenceKind];
  const { schedule } = pact;
  const kind = periodKindOfSchedule(schedule);
  const covered = preview.covered;

  let head: string;
  const lines: string[] = [];
  if (!preview.ticked) {
    const [one, many] = occurrenceNames(pact.evidenceKind);
    const due =
      covered.length === 0
        ? ""
        : schedule.kind === "one-time"
          ? ` · deadline ${formatDate(schedule.deadline)} still due`
          : ` · ${kind ? periodsText(kind, covered.length) : plural(covered.length, one, many)} still due`;
    head = `Not on vacation${due}`;
  } else {
    const text = coveredText(pact, covered, from, to);
    head = text.head;
    lines.push(...text.lines);
    if (schedule.kind === "one-time" && covered.length === 0 && preview.skipped.length === 0)
      lines.push("Nothing changes for it.");
    // Only a period schedule has periods a vacation touches but doesn't cover.
    for (const period of preview.notCovered) {
      lines.push(
        schedule.kind === "weekly-count"
          ? `${weekOf(period.date)}: not covered, still ${schedule.target} days needed by ${formatDate(period.through ?? period.date)}`
          : `${periodLabel(kind, period.date)} isn't off. ${schedule.kind === "once-a-month" ? "A vacation covers a month only from the 15th to its end." : "A vacation covers 2 weeks only when it covers the whole second week."}`,
      );
    }
    for (const skipped of preview.skipped) {
      lines.push(`${periodLabel(kind, skipped.date)}: ${SKIP_TEXT[skipped.reason]}`);
    }
    // A period the trip won't cover: do it before you go.
    const doItBy = [...preview.notCovered, ...preview.skipped].find((period) => period.doItBy)?.doItBy;
    if (doItBy) lines.push(`Do it by ${formatDate(doItBy)}. Reminders move to the 7 days before your trip.`);
  }

  return (
    <div className={preview.ticked ? "covrow" : "covrow skip"}>
      <span className={`kico ${className}`} aria-hidden="true">
        {icon}
      </span>
      <span className="rt">
        <b>{pact.name}</b>
        <small>{head}</small>
        {lines.map((line) => (
          <small key={line}>{line}</small>
        ))}
      </span>
    </div>
  );
}

/** What a refused preview or filing says. */
function refusalText(reason: FileVacationRefusal, from: string, to: string): string {
  switch (reason) {
    case "invalid-dates":
      return "The last day can't be before the first.";
    case "not-after-today":
      return "The first day has to be after today.";
    case "too-many-days":
      return `A vacation can be at most ${MAX_EXCUSE_SPAN_DAYS} days. This is ${dayCount(from, to)}.`;
    case "pact-not-offered":
      return "One of these pacts can't go on a vacation now. Check the Pacts step.";
    case "no-pacts":
      return "Pick at least one pact.";
    case "no-reviewers":
      return "Tick at least one reviewer.";
    case "reviewer-not-offered":
      return "A reviewer you ticked doesn't review any of these pacts.";
    case "nothing-to-cover":
      return "There's nothing left for this vacation to cover.";
    case "text-too-long":
      return TEXT_TOO_LONG_TEXT;
  }
}
