// The Today tab: alerts, then what's open now (evidence to submit and bills
// to pay), then recent misses, then what's coming up, then what's waiting for
// approval. Evidence is submitted inline on a To do card; an excuse is filed
// in the File excuse sheet, opened from a To do or Missed card or an alert; a
// payment is recorded in the Record a payment sheet, opened from a bill's To
// do card or an overdue alert.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Json } from "../shared/api.ts";
import {
  MAX_EVIDENCE_PHOTOS,
  type AcceptExcuseRejectionResult,
  type AcceptMissRefusal,
  type LedgerSummary,
  type SubmitEvidenceRefusal,
  type TodayAlert,
  type TodayBillCard,
  type TodayMissedCard,
  type TodaySection,
  type TodayWaitingItem,
} from "../shared/types.ts";
import { api, failureText, uploadFailureText } from "./api.ts";
import { clockText, formatDate, formatDay, formatDueAt, minutesLeft, money, timeLeft, hoursLeft } from "./format.ts";
import { datesText } from "./excuse-days.tsx";
import { ExcuseSheet } from "./ExcuseSheet.tsx";
import { CameraIcon, DollarIcon, ExcuseIcon, PencilIcon } from "./icons.tsx";
import { shrinkForPreview, type ShrunkPhoto } from "./photos.ts";
import { RecordPaymentSheet } from "./RecordPayment.tsx";
import { EditWindowChip, Empty, useLoad, useNow } from "./ui.tsx";

/** What the File excuse sheet is open on: a pact, and the day it was opened from (none for the pact-page form). */
interface ExcuseTarget {
  pactId: string;
  pactName: string;
  day?: string;
}

/** Opens the File excuse sheet. */
type OnFileExcuse = (target: ExcuseTarget) => void;

export function Today({
  timezone,
  onOpenPact,
  onOpenLedger,
  onOpenExcuse,
  onOpenChangeRequest,
  onCreate,
  onInvite,
}: {
  /** The profile's timezone, for when bills are due. */
  timezone: string;
  onOpenPact: (id: string, name: string) => void;
  onOpenLedger: (recipientId: string, name: string) => void;
  onOpenExcuse: (excuseId: string) => void;
  onOpenChangeRequest: (changeRequestId: string) => void;
  onCreate: () => void;
  onInvite: () => void;
}) {
  const { data: today, failed, reload } = useLoad(api.today);
  const now = useNow();
  const [excusing, setExcusing] = useState<ExcuseTarget | null>(null);

  if (failed)
    return (
      <Empty title="Today couldn't load" body={failureText(failed.error, "Check your connection and reopen Pact.")} />
    );
  if (today === null) return null;

  // Story 4: a new user's first screen says what to do next.
  if (!today.hasPacts) {
    return (
      <Empty title="Nothing to do right now" body="Invite a friend to review your pacts, then create your first pact.">
        <div className="row2">
          <button className="btn primary" onClick={onInvite}>
            Invite a friend
          </button>
          <button className="btn" onClick={onCreate}>
            Create a pact
          </button>
        </div>
      </Empty>
    );
  }
  return (
    <>
      {today.alerts.length === 0 && today.sections.length === 0 && (
        <Empty
          title="Nothing to do right now"
          body="When one of your pacts needs something from you, it shows up here."
        />
      )}
      {today.alerts.map((alert) => (
        <Alert
          key={alertKey(alert)}
          alert={alert}
          timezone={timezone}
          now={now}
          onFileExcuse={setExcusing}
          onChanged={reload}
        />
      ))}
      {today.sections.map((section) => (
        <Section
          key={section.kind}
          section={section}
          timezone={timezone}
          now={now}
          onOpenPact={onOpenPact}
          onOpenLedger={onOpenLedger}
          onFileExcuse={setExcusing}
          onChanged={reload}
        />
      ))}
      {today.waiting.length > 0 && (
        <Waiting
          items={today.waiting}
          onOpenPact={onOpenPact}
          onOpenLedger={onOpenLedger}
          onOpenExcuse={onOpenExcuse}
          onOpenChangeRequest={onOpenChangeRequest}
        />
      )}
      {excusing && (
        <ExcuseSheet
          pactId={excusing.pactId}
          pactName={excusing.pactName}
          {...(excusing.day !== undefined && { day: excusing.day })}
          onClose={() => setExcusing(null)}
          onFiled={() => {
            setExcusing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

/** Each alert's React key: one per rejected occurrence, rejected excuse, or recipient overdue. */
function alertKey(alert: Json<TodayAlert>): string {
  switch (alert.kind) {
    case "evidence-rejected":
      return `evidence:${alert.pactId}:${alert.occurrenceDate}`;
    case "excuse-rejected":
      return `excuse:${alert.excuseId}`;
    case "bill-overdue":
      return `overdue:${alert.recipientId}`;
  }
}

function Section({
  section,
  timezone,
  now,
  onOpenPact,
  onOpenLedger,
  onFileExcuse,
  onChanged,
}: {
  section: Json<TodaySection>;
  timezone: string;
  now: number;
  onOpenPact: (id: string, name: string) => void;
  onOpenLedger: (recipientId: string, name: string) => void;
  onFileExcuse: OnFileExcuse;
  /** After evidence is submitted, a miss is taken or a payment recorded: Today reloads. */
  onChanged: () => void;
}) {
  switch (section.kind) {
    case "to-do":
      return section.cards.map((card) =>
        card.kind === "bill" ? (
          <BillCard
            key={`bill:${card.recipientId}`}
            card={card}
            timezone={timezone}
            now={now}
            onOpenLedger={onOpenLedger}
            onPaid={onChanged}
          />
        ) : (
          <PactCard
            key={`evidence:${card.pactId}`}
            name={card.name}
            penaltyCents={card.penaltyCents}
            editWindowClosesAt={card.editWindowClosesAt}
            now={now}
            chip={<span className="chip c-todo">To do</span>}
            onOpen={() => onOpenPact(card.pactId, card.name)}
          >
            <div className="meta due">Due at midnight · {timeLeft(Date.parse(card.dueAt) - now)}</div>
            <EvidenceForm
              pactId={card.pactId}
              onSubmitted={onChanged}
              onFileExcuse={() => onFileExcuse({ pactId: card.pactId, pactName: card.name, day: card.occurrenceDate })}
            />
          </PactCard>
        ),
      );
    case "missed":
      return section.cards.map((card) => (
        <PactCard
          key={`${card.pactId}:${card.occurrenceDate}`}
          name={card.name}
          penaltyCents={card.penaltyCents}
          chip={<span className="chip c-missed">Missed</span>}
          onOpen={() => onOpenPact(card.pactId, card.name)}
        >
          <div className="meta">{missedLine(card)}</div>
          <MissedActions
            pactId={card.pactId}
            occurrenceDate={card.occurrenceDate}
            excusableUntil={card.excusableUntil}
            now={now}
            onFileExcuse={() => onFileExcuse({ pactId: card.pactId, pactName: card.name, day: card.occurrenceDate })}
            onTaken={onChanged}
          />
        </PactCard>
      ));
    case "automatic":
      return section.cards.map((card) => (
        <PactCard
          key={card.pactId}
          name={card.name}
          penaltyCents={card.penaltyCents}
          editWindowClosesAt={card.editWindowClosesAt}
          now={now}
          chip={<span className="chip c-soon">Automatic</span>}
          onOpen={() => onOpenPact(card.pactId, card.name)}
        >
          <div className="meta">
            Tonight, in bed by {clockText(card.inBedBy)} · {timeLeft(Date.parse(card.dueAt) - now)}
          </div>
        </PactCard>
      ));
    case "coming-up":
      return (
        <section className="stack">
          <div className="label">Coming up</div>
          {section.cards.map((card) => (
            <PactCard
              key={card.pactId}
              name={card.name}
              penaltyCents={card.penaltyCents}
              editWindowClosesAt={card.editWindowClosesAt}
              now={now}
              chip={<span className="chip c-soon">Opens {formatDate(card.opensOn)}</span>}
              onOpen={() => onOpenPact(card.pactId, card.name)}
            />
          ))}
        </section>
      );
  }
}

/** A Missed card's day, and for a bedtime night when Oura saw the owner get into bed. */
function missedLine(card: Json<TodayMissedCard>): string {
  if (!card.night) return formatDate(card.occurrenceDate);
  const { inBedAt } = card.night;
  return `${formatDate(card.occurrenceDate)} night · ${inBedAt === null ? "no sleep data by 6pm" : `in bed at ${clockText(inBedAt)}`}`;
}

/**
 * A bill to pay, in To do: "Pay Sam", the amount in red, when it's due, and
 * Record payment. Tapping it opens the recipient's ledger.
 */
function BillCard({
  card,
  timezone,
  now,
  onOpenLedger,
  onPaid,
}: {
  card: Json<TodayBillCard>;
  timezone: string;
  now: number;
  onOpenLedger: (recipientId: string, name: string) => void;
  onPaid: () => void;
}) {
  return (
    <PactCard
      name={`Pay ${card.recipientName}`}
      penaltyCents={card.amountCents}
      chip={<span className="chip c-todo">To do</span>}
      onOpen={() => onOpenLedger(card.recipientId, card.recipientName)}
    >
      <div className="meta due">
        Due {formatDueAt(card.dueAt, timezone)} · {timeLeft(Date.parse(card.dueAt) - now)}
      </div>
      <div className="meta">Your bill from {formatDate(card.billedOn)}</div>
      <RecordPaymentAction recipientId={card.recipientId} primary onSent={onPaid} />
    </PactCard>
  );
}

/**
 * Record payment from Today: it loads the recipient's ledger, then opens the
 * Record a payment sheet on it, starting at the open bills' amount. Clicks
 * stay here rather than opening what's behind.
 */
function RecordPaymentAction({
  recipientId,
  primary = false,
  onSent,
}: {
  recipientId: string;
  /** The card's main action, full size; on an alert it's small. */
  primary?: boolean;
  /** After the payment was recorded: Today reloads. */
  onSent: () => void;
}) {
  const [ledger, setLedger] = useState<Json<LedgerSummary> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.ledger(recipientId);
      if (result.ok) setLedger(result.ledger.summary);
      else setError("This ledger wasn't found.");
    } catch (failure) {
      setError(failureText(failure, "Couldn't open it. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="row2">
        <button className={primary ? "btn primary" : "btn sm"} disabled={busy} onClick={() => void open()}>
          {busy ? "Opening…" : "Record payment"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
      {ledger && (
        <RecordPaymentSheet
          ledger={ledger}
          onClose={() => setLedger(null)}
          onSent={() => {
            setLedger(null);
            onSent();
          }}
        />
      )}
    </div>
  );
}

/**
 * Bills to a recipient past their due time and not covered: how much, the
 * oldest bill and when it was due, who has been told, and Record payment.
 */
function OverdueAlert({
  alert,
  timezone,
  onPaid,
}: {
  alert: Extract<Json<TodayAlert>, { kind: "bill-overdue" }>;
  timezone: string;
  onPaid: () => void;
}) {
  const { reviewerNames } = alert;
  return (
    <div className="alert bad" role="status">
      <b>
        {money(alert.overdueCents)} overdue to {alert.recipientName}.
      </b>
      <span className="small">
        Your {formatDate(alert.billedOn)} bill was due {formatDay(alert.dueAt, timezone)}.
        {reviewerNames.length > 0 &&
          ` ${reviewerNames.join(" and ")} ${reviewerNames.length === 1 ? "has" : "have"} been told.`}
      </span>
      <RecordPaymentAction recipientId={alert.recipientId} onSent={onPaid} />
    </div>
  );
}

/** Something that needs the owner, first on Today. */
function Alert({
  alert,
  timezone,
  now,
  onFileExcuse,
  onChanged,
}: {
  alert: Json<TodayAlert>;
  timezone: string;
  now: number;
  onFileExcuse: OnFileExcuse;
  onChanged: () => void;
}) {
  switch (alert.kind) {
    case "evidence-rejected":
      return <RejectedEvidenceAlert alert={alert} now={now} onFileExcuse={onFileExcuse} onTaken={onChanged} />;
    case "excuse-rejected":
      return <RejectedExcuseAlert alert={alert} now={now} onFileExcuse={onFileExcuse} onTaken={onChanged} />;
    case "bill-overdue":
      return <OverdueAlert alert={alert} timezone={timezone} onPaid={onChanged} />;
  }
}

/**
 * Take the L: it only takes a card or alert off Today and changes nothing
 * else, so it sends at once, with no confirmation.
 */
function useTakeTheL<Refusal extends string>(
  send: () => Promise<{ ok: true } | { ok: false; reason: Refusal }>,
  refusalText: Record<Refusal, string>,
  onTaken: () => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const take = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await send();
      if (result.ok) return onTaken();
      setError(refusalText[result.reason]);
    } catch (failure) {
      setError(failureText(failure, "Couldn't send. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, take: () => void take() };
}

/** "File excuse · 31h 12m left" until `excusableUntil`; nothing once it's passed. */
function fileExcuseLabel(text: string, excusableUntil: string, now: number): string | null {
  const ms = Date.parse(excusableUntil) - now;
  return ms > 0 ? `${text} · ${hoursLeft(ms)} left` : null;
}

/** A Missed card's File excuse and Take the L. Clicks stay here rather than opening the pact. */
function MissedActions({
  pactId,
  occurrenceDate,
  excusableUntil,
  now,
  onFileExcuse,
  onTaken,
}: {
  pactId: string;
  occurrenceDate: string;
  excusableUntil: string;
  now: number;
  onFileExcuse: () => void;
  /** After Take the L: Today reloads. */
  onTaken: () => void;
}) {
  const { busy, error, take } = useTakeTheL(
    () => api.acceptMiss(pactId, occurrenceDate),
    ACCEPT_MISS_REFUSAL_TEXT,
    onTaken,
  );
  const fileLabel = fileExcuseLabel("File excuse", excusableUntil, now);
  return (
    <div className="stack" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="row2">
        {fileLabel && (
          <button className="btn" onClick={onFileExcuse}>
            {fileLabel}
          </button>
        )}
        <button className="btn" disabled={busy} onClick={take}>
          {busy ? "Sending…" : "Take the L"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/**
 * Rejected evidence: the day is already Missed, with its penalty. File
 * excuse while the 48 hours from the rejection last, or Take the L, which
 * clears the alert.
 */
function RejectedEvidenceAlert({
  alert,
  now,
  onFileExcuse,
  onTaken,
}: {
  alert: Extract<Json<TodayAlert>, { kind: "evidence-rejected" }>;
  now: number;
  onFileExcuse: OnFileExcuse;
  /** After Take the L: Today reloads. */
  onTaken: () => void;
}) {
  const { busy, error, take } = useTakeTheL(
    () => api.acceptMiss(alert.pactId, alert.occurrenceDate),
    ACCEPT_MISS_REFUSAL_TEXT,
    onTaken,
  );
  const fileLabel = fileExcuseLabel("File excuse", alert.excusableUntil, now);

  return (
    <div className="alert bad" role="status">
      <b>
        {alert.reviewerName} rejected your evidence for {alert.name}
      </b>
      <span>“{alert.reason}”</span>
      <span className="small">
        {formatDate(alert.occurrenceDate)} is Missed ·{" "}
        <b className="pen">
          {money(alert.penaltyCents)} to {alert.recipientName}
        </b>
      </span>
      <div className="row2">
        {fileLabel && (
          <button
            className="btn sm"
            onClick={() => onFileExcuse({ pactId: alert.pactId, pactName: alert.name, day: alert.occurrenceDate })}
          >
            {fileLabel}
          </button>
        )}
        <button className="btn sm danger" disabled={busy} onClick={take}>
          {busy ? "Sending…" : "Take the L"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

const ACCEPT_MISS_REFUSAL_TEXT: Record<AcceptMissRefusal, string> = {
  "pact-not-found": "This pact wasn't found.",
  "nothing-to-accept": "There's nothing to accept now. Reopen Today to see where it stands.",
};

/**
 * A rejected excuse: its held penalties are owed again, and its days not
 * judged yet are judged as usual. File another excuse while a day is still
 * in its window, or Take the L, which clears the alert.
 */
function RejectedExcuseAlert({
  alert,
  now,
  onFileExcuse,
  onTaken,
}: {
  alert: Extract<Json<TodayAlert>, { kind: "excuse-rejected" }>;
  now: number;
  onFileExcuse: OnFileExcuse;
  /** After Take the L: Today reloads. */
  onTaken: () => void;
}) {
  const { busy, error, take } = useTakeTheL(
    () => api.acceptExcuseRejection(alert.excuseId),
    ACCEPT_EXCUSE_REJECTION_REFUSAL_TEXT,
    onTaken,
  );
  const owedAgain = alert.owedAgainCents > 0;
  // One day opens the sheet on it; several open the pact-page form, which
  // offers only the days that can still be excused.
  const refile = () =>
    onFileExcuse({
      pactId: alert.pactId,
      pactName: alert.name,
      ...(alert.firstDate === alert.lastDate && { day: alert.firstDate }),
    });
  const refileLabel =
    alert.refile === null
      ? null
      : alert.refile.closesAt === null
        ? "File another excuse"
        : fileExcuseLabel("File another excuse", alert.refile.closesAt, now);

  return (
    <div className="alert bad" role="status">
      <b>
        {alert.reviewerName} rejected your excuse for {alert.name}
      </b>
      <span>“{alert.reason}”</span>
      <span className="small">
        {datesText(alert.firstDate, alert.lastDate)}
        {owedAgain && (
          <>
            {" · "}
            <b className="pen">{money(alert.owedAgainCents)} is owed again</b>
          </>
        )}
        {alert.hasDaysNotJudged &&
          (owedAgain ? ", and days not judged yet are judged as usual" : " · days not judged yet are judged as usual")}
      </span>
      <div className="row2">
        {refileLabel && (
          <button className="btn sm" onClick={refile}>
            {refileLabel}
          </button>
        )}
        <button className="btn sm danger" disabled={busy} onClick={take}>
          {busy ? "Sending…" : "Take the L"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

const ACCEPT_EXCUSE_REJECTION_REFUSAL_TEXT: Record<
  Extract<AcceptExcuseRejectionResult, { ok: false }>["reason"],
  string
> = {
  "excuse-not-found": "This excuse wasn't found.",
  "nothing-to-accept": "There's nothing to accept now. Reopen Today to see where it stands.",
};

/**
 * Waiting for approval, last on Today: each item with its kind's icon in a
 * coloured square. Evidence opens its pact; an excuse or a change request,
 * its page; a payment, its recipient's ledger.
 */
function Waiting({
  items,
  onOpenPact,
  onOpenLedger,
  onOpenExcuse,
  onOpenChangeRequest,
}: {
  items: Json<TodayWaitingItem>[];
  onOpenPact: (id: string, name: string) => void;
  onOpenLedger: (recipientId: string, name: string) => void;
  onOpenExcuse: (excuseId: string) => void;
  onOpenChangeRequest: (changeRequestId: string) => void;
}) {
  return (
    <section className="stack">
      <div className="label">Waiting for approval</div>
      <div className="cards">
        {items.map((item) =>
          item.kind === "change-request" ? (
            <button key={item.id} className="rowbtn" onClick={() => onOpenChangeRequest(item.id)}>
              <span className="kico k-change">
                <PencilIcon />
              </span>
              <span className="rt">
                <b>{item.name}</b>
                <small>{item.endsPact ? "Change · End this pact" : "Change"}</small>
              </span>
            </button>
          ) : item.kind === "excuse" ? (
            <button key={item.id} className="rowbtn" onClick={() => onOpenExcuse(item.id)}>
              <span className="kico k-excuse">
                <ExcuseIcon />
              </span>
              <span className="rt">
                <b>{item.name}</b>
                <small>Excuse · {datesText(item.firstDate, item.lastDate)}</small>
              </span>
            </button>
          ) : item.kind === "evidence" ? (
            <button key={item.id} className="rowbtn" onClick={() => onOpenPact(item.pactId, item.name)}>
              <span className="kico k-evidence">
                <CameraIcon />
              </span>
              <span className="rt">
                <b>{item.name}</b>
                <small>Evidence</small>
              </span>
            </button>
          ) : (
            <button key={item.id} className="rowbtn" onClick={() => onOpenLedger(item.recipientId, item.recipientName)}>
              <span className="kico k-payment">
                <DollarIcon />
              </span>
              <span className="rt">
                <b>
                  {money(item.amountCents)} to {item.recipientName}
                </b>
                <small>Payment</small>
              </span>
            </button>
          ),
        )}
      </div>
    </section>
  );
}

/**
 * Evidence on a To do card: live camera capture only (no photo library), one
 * photo at a time, each shrunk before it's shown. Beside Take photo, File
 * excuse for today, until a photo is taken. Clicks stay inside the form
 * rather than opening the pact.
 */
function EvidenceForm({
  pactId,
  onSubmitted,
  onFileExcuse,
}: {
  pactId: string;
  onSubmitted: () => void;
  onFileExcuse: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<ShrunkPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  urls.current = photos.map((photo) => photo.url);
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const takePhoto = () => input.current?.click();
  const add = async (file: File) => {
    setError(null);
    try {
      const photo = await shrinkForPreview(file);
      setPhotos((taken) => [...taken, photo]);
    } catch {
      setError("That photo couldn't be read. Take it again.");
    }
  };
  const remove = (photo: ShrunkPhoto) => {
    URL.revokeObjectURL(photo.url);
    setPhotos((taken) => taken.filter((p) => p !== photo));
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.submitEvidence(
        pactId,
        photos.map((photo) => photo.blob),
      );
      if (result.ok) return onSubmitted();
      setError(REFUSAL_TEXT[result.reason]);
    } catch (failure) {
      setError(
        uploadFailureText(
          failure,
          "A photo was too large to send. Remove it and take it again.",
          "Couldn't send. Check your connection and try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="evidence stack" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void add(file);
        }}
      />
      {photos.length === 0 ? (
        <div className="row2">
          <button className="btn primary" onClick={takePhoto}>
            <CameraIcon />
            Take photo
          </button>
          <button className="btn" onClick={onFileExcuse}>
            File excuse
          </button>
        </div>
      ) : (
        <>
          <div className="photos">
            {photos.map((photo, i) => (
              <div key={photo.url} className="thumb">
                <img src={photo.url} alt={`Photo ${i + 1}`} />
                <button className="remove" aria-label={`Remove photo ${i + 1}`} onClick={() => remove(photo)}>
                  ×
                </button>
              </div>
            ))}
            {photos.length < MAX_EVIDENCE_PHOTOS && (
              <button className="ph-add" aria-label="Take another photo" onClick={takePhoto}>
                +
              </button>
            )}
          </div>
          <button className="btn primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Sending…" : "Submit"}
          </button>
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

const REFUSAL_TEXT: Record<SubmitEvidenceRefusal, string> = {
  "pact-not-found": "This pact wasn't found.",
  "no-photos": "Take a photo first.",
  "too-many-photos": `Evidence can have at most ${MAX_EVIDENCE_PHOTOS} photos. Remove some.`,
  "not-open": "This occurrence is closed. Evidence counts only until its due time.",
  "evidence-waiting": "Evidence for today is already waiting for approval.",
  "already-approved": "Evidence for today is already approved.",
  "already-judged": "Today is already Missed, so new photos can't count.",
};

/**
 * A Today card: the pact's name (or for a bill, "Pay Sam"), a chip, its
 * penalty (or the bill's amount) in red, then whatever the section adds.
 * Tapping it opens the pact (or the ledger).
 */
function PactCard({
  name,
  penaltyCents,
  editWindowClosesAt = null,
  now = 0,
  chip,
  onOpen,
  children,
}: {
  name: string;
  penaltyCents: number;
  /** For a pact that can still be in its edit window; `now` keeps its chip right. */
  editWindowClosesAt?: string | null;
  now?: number;
  chip: ReactNode;
  onOpen: () => void;
  children?: ReactNode;
}) {
  return (
    <article
      className={minutesLeft(editWindowClosesAt, now) === null ? "card tcard" : "card tcard fresh"}
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
    >
      <div className="spread">
        <span className="namerow">
          <h3>{name}</h3>
          <EditWindowChip closesAt={editWindowClosesAt} now={now} />
        </span>
        {chip}
      </div>
      <div className="meta pen">{money(penaltyCents)}</div>
      {children}
    </article>
  );
}
