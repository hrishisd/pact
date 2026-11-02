// The Today tab: alerts, then what's open now, then recent misses, then
// what's coming up, then what's waiting for approval. Evidence is submitted
// inline on a To do card.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Json } from "../shared/api.ts";
import {
  MAX_EVIDENCE_PHOTOS,
  type AcceptMissRefusal,
  type SubmitEvidenceRefusal,
  type TodayAlert,
  type TodaySection,
  type TodayWaitingItem,
} from "../shared/types.ts";
import { api, failureText, uploadFailureText } from "./api.ts";
import { formatDate, minutesLeft, money, timeLeft } from "./format.ts";
import { CameraIcon, DollarIcon } from "./icons.tsx";
import { shrinkForPreview, type ShrunkPhoto } from "./photos.ts";
import { EditWindowChip, Empty, useLoad, useNow } from "./ui.tsx";

export function Today({
  onOpenPact,
  onOpenLedger,
  onCreate,
  onInvite,
}: {
  onOpenPact: (id: string, name: string) => void;
  onOpenLedger: (recipientId: string, name: string) => void;
  onCreate: () => void;
  onInvite: () => void;
}) {
  const { data: today, failed, reload } = useLoad(api.today);
  const now = useNow();

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
          key={alert.kind === "evidence-rejected" ? `${alert.pactId}:${alert.occurrenceDate}` : alert.excuseId}
          alert={alert}
          onChanged={reload}
        />
      ))}
      {today.sections.map((section) => (
        <Section key={section.kind} section={section} now={now} onOpenPact={onOpenPact} onChanged={reload} />
      ))}
      {today.waiting.length > 0 && (
        <Waiting items={today.waiting} onOpenPact={onOpenPact} onOpenLedger={onOpenLedger} />
      )}
    </>
  );
}

function Section({
  section,
  now,
  onOpenPact,
  onChanged,
}: {
  section: Json<TodaySection>;
  now: number;
  onOpenPact: (id: string, name: string) => void;
  /** After evidence is submitted: Today reloads. */
  onChanged: () => void;
}) {
  switch (section.kind) {
    case "to-do":
      return section.cards.map((card) => (
        <PactCard
          key={card.pactId}
          name={card.name}
          penaltyCents={card.penaltyCents}
          editWindowClosesAt={card.editWindowClosesAt}
          now={now}
          chip={<span className="chip c-todo">To do</span>}
          onOpen={() => onOpenPact(card.pactId, card.name)}
        >
          <div className="meta due">Due at midnight · {timeLeft(Date.parse(card.dueAt) - now)}</div>
          <EvidenceForm pactId={card.pactId} onSubmitted={onChanged} />
        </PactCard>
      ));
    case "missed":
      return section.cards.map((card) => (
        <PactCard
          key={`${card.pactId}:${card.occurrenceDate}`}
          name={card.name}
          penaltyCents={card.penaltyCents}
          chip={<span className="chip c-missed">Missed</span>}
          onOpen={() => onOpenPact(card.pactId, card.name)}
        >
          <div className="meta">{formatDate(card.occurrenceDate)}</div>
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

/** Something that needs the owner, first on Today. */
function Alert({ alert, onChanged }: { alert: Json<TodayAlert>; onChanged: () => void }) {
  switch (alert.kind) {
    case "evidence-rejected":
      return <RejectedEvidenceAlert alert={alert} onTaken={onChanged} />;
    case "excuse-rejected":
      return null;
  }
}

/**
 * Rejected evidence: the day is already Missed, with its penalty. Take the L
 * clears the alert and changes nothing else, so it sends at once.
 */
function RejectedEvidenceAlert({
  alert,
  onTaken,
}: {
  alert: Extract<Json<TodayAlert>, { kind: "evidence-rejected" }>;
  /** After Take the L: Today reloads. */
  onTaken: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.acceptMiss(alert.pactId, alert.occurrenceDate);
      if (result.ok) return onTaken();
      setError(ACCEPT_MISS_REFUSAL_TEXT[result.reason]);
    } catch (failure) {
      setError(failureText(failure, "Couldn't send. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

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
      <button className="btn sm danger self-start" disabled={busy} onClick={() => void take()}>
        {busy ? "Sending…" : "Take the L"}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

const ACCEPT_MISS_REFUSAL_TEXT: Record<AcceptMissRefusal, string> = {
  "pact-not-found": "This pact wasn't found.",
  "nothing-to-accept": "There's nothing to accept now. Reopen Today to see where it stands.",
};

/**
 * Waiting for approval, last on Today: each item with its kind's icon in a
 * coloured square. Evidence opens its pact; a payment, its recipient's ledger.
 */
function Waiting({
  items,
  onOpenPact,
  onOpenLedger,
}: {
  items: Json<TodayWaitingItem>[];
  onOpenPact: (id: string, name: string) => void;
  onOpenLedger: (recipientId: string, name: string) => void;
}) {
  return (
    <section className="stack">
      <div className="label">Waiting for approval</div>
      <div className="cards">
        {items.map((item) =>
          item.kind === "excuse" ? null : item.kind === "evidence" ? (
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
 * photo at a time, each shrunk before it's shown. Clicks stay inside the
 * form rather than opening the pact.
 */
function EvidenceForm({ pactId, onSubmitted }: { pactId: string; onSubmitted: () => void }) {
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
        <button className="btn primary self-start" onClick={takePhoto}>
          <CameraIcon />
          Take photo
        </button>
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

/** A Today card: the pact's name, a chip, its penalty in red, then whatever the section adds. Tapping it opens the pact. */
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
