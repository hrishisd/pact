// The Review tab: the account's Review Queue, one item at a time, with
// Reject (a reason is required, and for evidence the form says what
// rejecting costs), Approve, and Prev/Skip.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { API_PATHS, type Json } from "../shared/api.ts";
import type { DecideRefusal, ReviewDecision, ReviewItem } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { formatDate, formatDayTime, money, weekdayName } from "./format.ts";
import { CameraIcon, DollarIcon } from "./icons.tsx";
import { Empty, useLoad } from "./ui.tsx";

/** `onQueue` hears the queue's length each time it loads, for the tab's badge. */
export function Review({
  timezone,
  onQueue,
}: {
  /** The profile's timezone, for when payments were recorded. */
  timezone: string;
  onQueue: (length: number) => void;
}) {
  const { data: queue, failed, reload } = useLoad(api.reviewQueue);
  const [index, setIndex] = useState(0);
  // Says why the last decision didn't go through, above the next item.
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (queue) onQueue(queue.length);
  }, [queue, onQueue]);

  if (failed)
    return (
      <Empty title="Review couldn't load" body={failureText(failed.error, "Check your connection and reopen Pact.")} />
    );
  if (queue === null) return null;
  if (queue.length === 0)
    return (
      <>
        {notice && <p className="error small">{notice}</p>}
        <Empty
          title="Nothing to review"
          body="When a friend picks you as a reviewer, their submitted evidence, excuses and payments show up here."
        />
      </>
    );

  const at = Math.min(index, queue.length - 1);
  const item = queue[at]!;
  const step = (by: number) => {
    setNotice(null);
    setIndex((at + by + queue.length) % queue.length);
  };
  const decided = (refusal: DecideRefusal | null) => {
    setNotice(refusal === null ? null : REFUSAL_TEXT[refusal]);
    // The decided item leaves the queue, so the next one takes its place.
    reload();
  };

  return (
    <>
      <div className="spread">
        <span className="counter">
          {at + 1} of {queue.length} to review
        </span>
        {queue.length > 1 && (
          <div className="row2">
            <button className="btn sm" onClick={() => step(-1)}>
              ‹ Prev
            </button>
            <button className="btn sm" onClick={() => step(1)}>
              Skip ›
            </button>
          </div>
        )}
      </div>
      {notice && <p className="error small">{notice}</p>}
      {item.kind === "evidence" ? (
        <EvidenceItem key={item.id} item={item} onDecided={decided} />
      ) : (
        <PaymentItem key={item.id} item={item} timezone={timezone} onDecided={decided} />
      )}
    </>
  );
}

const REFUSAL_TEXT: Record<DecideRefusal, string> = {
  "item-not-found": "That item isn't in your queue any more.",
  "already-decided": "Another reviewer already decided that one.",
  "blank-reason": "Say why you're rejecting it.",
};

type EvidenceReviewItem = Extract<Json<ReviewItem>, { kind: "evidence" }>;
type PaymentReviewItem = Extract<Json<ReviewItem>, { kind: "payment" }>;

/** After the core answered: null when the decision went through. */
type OnDecided = (refusal: DecideRefusal | null) => void;

/** An Evidence item: the pact's description of what counts and the photos. */
function EvidenceItem({ item, onDecided }: { item: EvidenceReviewItem; onDecided: OnDecided }) {
  return (
    <>
      <div className="row2">
        <span className="kind k-evidence">
          <CameraIcon />
          Evidence
        </span>
        <span className="muted">from {item.ownerName}</span>
      </div>
      <article className="card">
        <div className="spread">
          <h3>{item.pactName}</h3>
          <span className="meta">{formatDate(item.occurrenceDate)}</span>
        </div>
        <div className="stack-sm">
          <span className="label">What counts</span>
          <span>{item.description}</span>
        </div>
        {item.photoIds.map((photoId, i) => {
          const src = API_PATHS.photo(encodeURIComponent(photoId));
          return (
            // Opens the photo full size in a new tab.
            <a key={photoId} href={src} target="_blank" rel="noreferrer">
              <img className="big-photo" src={src} alt={`Photo ${i + 1} of ${item.photoIds.length}`} />
            </a>
          );
        })}
      </article>
      <Decision
        itemId={item.id}
        placeholder="e.g. This looks like it's from last week"
        cost={
          <p className="small">
            Rejecting makes {weekdayName(item.occurrenceDate)} Missed and adds {money(item.penaltyCents)} to{" "}
            {item.ownerName}'s {item.recipientName} ledger.
          </p>
        }
        onDecided={onDecided}
      />
    </>
  );
}

/** A Payment item: the screenshot, the owner's note, and what approving does to what they owe. */
function PaymentItem({
  item,
  timezone,
  onDecided,
}: {
  item: PaymentReviewItem;
  timezone: string;
  onDecided: OnDecided;
}) {
  const src = API_PATHS.photo(encodeURIComponent(item.photoId));
  return (
    <>
      <div className="row2">
        <span className="kind k-payment">
          <DollarIcon />
          Payment
        </span>
        <span className="muted">from {item.ownerName}</span>
      </div>
      <article className="card">
        <h3>
          {money(item.amountCents)} to {item.recipientName}
        </h3>
        {/* Opens the screenshot full size in a new tab. */}
        <a href={src} target="_blank" rel="noreferrer">
          <img className="big-photo whole" src={src} alt="Payment screenshot" />
        </a>
        <dl className="kv">
          <dt>Note</dt>
          <dd>{item.note ?? "—"}</dd>
          <dt>Owes</dt>
          <dd>{money(item.owedCents)}</dd>
          <dt>Sent</dt>
          <dd>{formatDayTime(item.recordedAt, timezone)}</dd>
        </dl>
        <p className="muted small">
          Approving lowers what {item.ownerName} owes {item.recipientName} to {money(item.owedAfterApprovalCents)}.
        </p>
      </article>
      <Decision itemId={item.id} placeholder="e.g. The screenshot shows a different amount" onDecided={onDecided} />
    </>
  );
}

/**
 * Reject and Approve, kept in reach below an item. Reject opens a form that
 * needs a reason, with `cost` under it when rejecting costs the owner.
 */
function Decision({
  itemId,
  placeholder,
  cost,
  onDecided,
}: {
  itemId: string;
  /** An example reason for the reason box. */
  placeholder: string;
  cost?: ReactNode;
  onDecided: OnDecided;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rejectForm = useRef<HTMLDivElement>(null);
  const reasonField = useRef<HTMLTextAreaElement>(null);

  // The form opens below the photos, off-screen on a phone: bring it into view.
  useEffect(() => {
    if (!rejecting) return;
    rejectForm.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    reasonField.current?.focus({ preventScroll: true });
  }, [rejecting]);

  const decide = async (decision: ReviewDecision) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.decide(itemId, decision);
      onDecided(result.ok ? null : result.reason);
    } catch (failure) {
      setError(failureText(failure, "Couldn't send. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <p className="error small">{error}</p>}
      {rejecting ? (
        <div className="stack" ref={rejectForm}>
          <label className="field">
            <span>Why are you rejecting it? (required)</span>
            <textarea
              className="inp"
              ref={reasonField}
              value={reason}
              placeholder={placeholder}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {cost}
          <div className="row2">
            <button className="btn" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </button>
            <button
              className="btn danger grow"
              disabled={busy || reason.trim() === ""}
              onClick={() => void decide({ kind: "reject", reason })}
            >
              Reject
            </button>
          </div>
        </div>
      ) : (
        <div className="decide">
          <button className="btn danger" disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </button>
          <button className="btn ok" disabled={busy} onClick={() => void decide({ kind: "approve" })}>
            Approve
          </button>
        </div>
      )}
    </>
  );
}
