// The Review tab: the account's Review Queue, one item at a time, with
// Reject (a reason is required), Approve, and Prev/Skip.

import { useEffect, useRef, useState } from "react";
import { API_PATHS, type Json } from "../shared/api.ts";
import type { DecideRefusal, ReviewDecision, ReviewItem } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { formatDate } from "./format.ts";
import { CameraIcon } from "./icons.tsx";
import { Empty, useLoad } from "./ui.tsx";

/** `onQueue` hears the queue's length each time it loads, for the tab's badge. */
export function Review({ onQueue }: { onQueue: (length: number) => void }) {
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
          body="When a friend picks you as a reviewer, their submitted evidence and excuses show up here."
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
      <EvidenceItem key={item.id} item={item} onDecided={decided} />
    </>
  );
}

const REFUSAL_TEXT: Record<DecideRefusal, string> = {
  "item-not-found": "That item isn't in your queue any more.",
  "already-decided": "Another reviewer already decided that one.",
  "blank-reason": "Say why you're rejecting it.",
};

/** An Evidence item: the pact's description of what counts and the photos. */
function EvidenceItem({
  item,
  onDecided,
}: {
  item: Json<ReviewItem>;
  /** After the core answered: null when the decision went through. */
  onDecided: (refusal: DecideRefusal | null) => void;
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
      const result = await api.decide(item.id, decision);
      onDecided(result.ok ? null : result.reason);
    } catch (failure) {
      setError(failureText(failure, "Couldn't send. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

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
      {error && <p className="error small">{error}</p>}
      {rejecting ? (
        <div className="stack" ref={rejectForm}>
          <label className="field">
            <span>Why are you rejecting it? (required)</span>
            <textarea
              className="inp"
              ref={reasonField}
              value={reason}
              placeholder="e.g. This looks like it's from last week"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
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
