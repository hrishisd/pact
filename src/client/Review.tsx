// The Review tab: the account's Review Queue (change requests first, then
// evidence, excuses, payments and vacations), one item at a time, with Reject (a reason
// is required, and the form says what rejecting does), Ask, Approve, and
// Prev/Skip. Below it, the items waiting on their owner's reply, which a
// reviewer can still open and decide.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Json, ReviewQueueResponse } from "../shared/api.ts";
import type { DecideRefusal, ReviewDecision, ReviewItem } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { dateSpan, formatDate, formatDayTime, money, weekdayName } from "./format.ts";
import { DayChip, dayNote, excuseDatesText, excuseDayText } from "./excuse-days.tsx";
import { DiffList, EverythingElse, listNames, startsText } from "./change-terms.tsx";
import { ItemKindHeader, PhotoLinks, ScreenshotLink, WaitingRow } from "./item-page.tsx";
import { AskSheet, Thread } from "./questions.tsx";
import { coveredText, firstName, pactsText, plural } from "./vacation-text.ts";
import { Empty, Loaded, loadedData, useLoad, useNow, useSend } from "./ui.tsx";

/** `onQueue` hears the queue's length each time it loads, for the tab's badge. */
export function Review({
  timezone,
  onQueue,
}: {
  /** The profile's timezone, for when payments were recorded. */
  timezone: string;
  onQueue: (length: number) => void;
}) {
  const { state, reload } = useLoad(api.reviewQueue);
  const queue = loadedData(state);
  const { state: waitingState, reload: reloadWaiting } = useLoad(api.waitingOnReply);
  const waiting = loadedData(waitingState);
  const [index, setIndex] = useState(0);
  // Says why the last decision didn't go through, above the next item.
  const [notice, setNotice] = useState<string | null>(null);
  // An item waiting on its owner's reply, opened from the list below the queue.
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [asking, setAsking] = useState<Json<ReviewItem> | null>(null);

  useEffect(() => {
    if (queue) onQueue(queue.length);
  }, [queue, onQueue]);

  const refresh = () => {
    setOpenedId(null);
    reload();
    reloadWaiting();
  };
  const decided = (refusal: DecideRefusal | null) => {
    setNotice(refusal === null ? null : REFUSAL_TEXT[refusal]);
    // The decided item leaves the queue, so the next one takes its place.
    refresh();
  };
  const askSheet = asking && (
    <AskSheet
      itemId={asking.id}
      ownerName={asking.ownerName}
      placeholder={ASK_PLACEHOLDER[asking.kind]}
      onClose={() => setAsking(null)}
      onAsked={() => {
        setAsking(null);
        setNotice(null);
        refresh();
      }}
    />
  );
  const waitingList = waiting && waiting.length > 0 && (
    <WaitingOnReply
      items={waiting}
      timezone={timezone}
      onOpen={(id) => {
        setNotice(null);
        setOpenedId(id);
      }}
    />
  );

  /** The queue as loaded: the item opened from below it, or the item at `index`, then what waits on a reply. */
  const queueView = (queue: ReviewQueueResponse): ReactNode => {
    const opened = waiting?.find((item) => item.id === openedId);
    if (opened) {
      return (
        <>
          <button className="link self-start" onClick={() => setOpenedId(null)}>
            ‹ Back to your queue
          </button>
          <ItemView item={opened} timezone={timezone} onDecided={decided} onAsk={() => setAsking(opened)} />
          {askSheet}
        </>
      );
    }

    if (queue.length === 0)
      return (
        <>
          {notice && <p className="error small">{notice}</p>}
          <Empty
            title="Nothing to review"
            body={
              waitingList
                ? "What's left is waiting on a reply, below."
                : "When a friend picks you as a reviewer, their evidence, excuses, payments, change requests and vacations show up here."
            }
          />
          {waitingList}
        </>
      );

    const at = Math.min(index, queue.length - 1);
    const item = queue[at]!;
    const step = (by: number) => {
      setNotice(null);
      setIndex((at + by + queue.length) % queue.length);
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
        <ItemView item={item} timezone={timezone} onDecided={decided} onAsk={() => setAsking(item)} />
        {waitingList}
        {askSheet}
      </>
    );
  };

  // A failed reload keeps the queue shown, under what failed.
  return (
    <Loaded state={state} what="Review">
      {queueView}
    </Loaded>
  );
}

/** One item: what it's about, its questions so far, and Reject, Ask and Approve. */
function ItemView({
  item,
  timezone,
  onDecided,
  onAsk,
}: {
  item: Json<ReviewItem>;
  timezone: string;
  onDecided: OnDecided;
  onAsk: () => void;
}) {
  const props = { timezone, onDecided, onAsk };
  switch (item.kind) {
    case "evidence":
      return <EvidenceItem key={item.id} item={item} {...props} />;
    case "excuse":
      return <ExcuseItem key={item.id} item={item} {...props} />;
    case "change-request":
      return <ChangeRequestItem key={item.id} item={item} {...props} />;
    case "payment":
      return <PaymentItem key={item.id} item={item} {...props} />;
    case "vacation":
      return <VacationItem key={item.id} item={item} {...props} />;
  }
}

const ASK_PLACEHOLDER: Record<ReviewItem["kind"], string> = {
  evidence: "e.g. Is this from today?",
  excuse: "e.g. Did you see a doctor?",
  payment: "e.g. Can you send the whole screenshot?",
  "change-request": "e.g. What changed?",
  vacation: "e.g. Can you keep Spanish going on the trip?",
};

/** What a review item is about, in a row: the pact's name, the payment, or a vacation's dates. */
function itemTitle(item: Json<ReviewItem>): string {
  switch (item.kind) {
    case "evidence":
    case "excuse":
      return item.pactName;
    case "change-request":
      return item.endsPact ? `End ${item.pactName}` : item.pactName;
    case "payment":
      return `${money(item.amountCents)} to ${item.recipientName}`;
    case "vacation":
      return dateSpan(item.from, item.to);
  }
}

/**
 * Items out of the queue until their owner replies, under one label per
 * owner. Each opens on its own, to read and decide.
 */
function WaitingOnReply({
  items,
  timezone,
  onOpen,
}: {
  items: Json<ReviewItem>[];
  timezone: string;
  onOpen: (itemId: string) => void;
}) {
  const owners = [...new Set(items.map((item) => item.ownerName))];
  return (
    <>
      {owners.map((owner) => (
        <section key={owner} className="stack">
          <div className="label">Waiting on {owner}'s reply</div>
          <div className="cards">
            {items
              .filter((item) => item.ownerName === owner)
              .map((item) => {
                const asked = item.thread.comments.at(-1);
                return (
                  <WaitingRow
                    key={item.id}
                    kind={item.kind}
                    title={itemTitle(item)}
                    detail={asked && `asked ${formatDayTime(asked.sentAt, timezone)}`}
                    onOpen={() => onOpen(item.id)}
                  />
                );
              })}
          </div>
        </section>
      ))}
      <p className="small muted">Out of your queue until they reply. You can still open one and decide it.</p>
    </>
  );
}

const REFUSAL_TEXT: Record<DecideRefusal, string> = {
  "item-not-found": "That item isn't in your queue any more.",
  "already-decided": "Another reviewer already decided that one.",
  "blank-reason": "Say why you're rejecting it.",
  "deadline-too-soon": "The new deadline is less than an hour away now, so it can only be rejected.",
};

type EvidenceReviewItem = Extract<Json<ReviewItem>, { kind: "evidence" }>;
type ExcuseReviewItem = Extract<Json<ReviewItem>, { kind: "excuse" }>;
type PaymentReviewItem = Extract<Json<ReviewItem>, { kind: "payment" }>;
type ChangeReviewItem = Extract<Json<ReviewItem>, { kind: "change-request" }>;
type VacationReviewItem = Extract<Json<ReviewItem>, { kind: "vacation" }>;

/** After the core answered: null when the decision went through. */
type OnDecided = (refusal: DecideRefusal | null) => void;

/** What every item gets: the timezone for its thread, and what its buttons do. */
interface ItemProps {
  timezone: string;
  onDecided: OnDecided;
  onAsk: () => void;
}

/** The top of an item: its kind, and whose it is. */
function FromOwner({ item }: { item: Json<ReviewItem> }) {
  return (
    <ItemKindHeader kind={item.kind}>
      <span className="muted">from {item.ownerName}</span>
    </ItemKindHeader>
  );
}

/** An Evidence item: the pact's description of what counts and the photos. */
function EvidenceItem({ item, timezone, onDecided, onAsk }: ItemProps & { item: EvidenceReviewItem }) {
  return (
    <>
      <FromOwner item={item} />
      <article className="card">
        <div className="spread">
          <h3>{item.pactName}</h3>
          <span className="meta">{formatDate(item.occurrenceDate)}</span>
        </div>
        {item.week && (
          <span className="meta">
            Counts toward this week · {item.week.sessions} of {item.week.target} so far
          </span>
        )}
        <div className="stack-sm">
          <span className="label">What counts</span>
          <span>{item.description}</span>
        </div>
        <PhotoLinks photoIds={item.photoIds} />
      </article>
      <Thread thread={item.thread} viewer="reviewer" timezone={timezone} />
      <Decision
        itemId={item.id}
        onAsk={onAsk}
        placeholder="e.g. This looks like it's from last week"
        cost={
          item.week ? (
            <p className="small">
              Rejecting means {weekdayName(item.occurrenceDate)} doesn't count toward {item.ownerName}'s{" "}
              {item.week.target}× this week. They can make it up another day.
            </p>
          ) : (
            <p className="small">
              Rejecting makes {weekdayName(item.occurrenceDate)} Missed and adds {money(item.penaltyCents)} to{" "}
              {item.ownerName}'s {item.recipientName} ledger.
            </p>
          )
        }
        onDecided={onDecided}
      />
    </>
  );
}

/**
 * An Excuse item: the reason, the photos, the days it covers as they stand,
 * and what approving or rejecting does to them, all at once.
 */
function ExcuseItem({ item, timezone, onDecided, onAsk }: ItemProps & { item: ExcuseReviewItem }) {
  const now = useNow();
  const held = item.heldCents > 0 ? money(item.heldCents) : null;
  const notJudged = item.days.some(({ status }) => status.kind === "not-judged");
  // What rejecting does, each half only when it applies.
  const rejectCost = [
    ...(held ? [`makes ${held} owed again`] : []),
    ...(notJudged ? ["leaves the days not judged yet to be judged as usual"] : []),
  ];
  const which = item.days.length === 1 ? excuseDatesText(item.days) : `all ${item.days.length} days`;
  return (
    <>
      <FromOwner item={item} />
      <article className="card">
        <div className="spread">
          <h3>{item.pactName}</h3>
          <span className="meta">{excuseDatesText(item.days)}</span>
        </div>
        <div className="stack-sm">
          <span className="label">Reason</span>
          <span className="quote">“{item.reason}”</span>
        </div>
        <PhotoLinks photoIds={item.photoIds} />
        <span className="label">Covers</span>
        <div className="list">
          {item.days.map((day) => {
            const { date, status } = day;
            const note = dayNote(status, now, timezone, day.through !== undefined);
            return (
              <div key={date} className="covrow">
                <span className="rt">
                  <b>{excuseDayText(day)}</b>
                  {note && <small>{note}</small>}
                </span>
                <DayChip status={status} now={now} compact />
              </div>
            );
          })}
        </div>
        <p className="muted small">
          Approving makes {which} Excused{held && ` and removes ${held} in held penalties`}.
          {notJudged && " Days not judged yet are Excused when they end."}
        </p>
      </article>
      <Thread thread={item.thread} viewer="reviewer" timezone={timezone} />
      <Decision
        itemId={item.id}
        onAsk={onAsk}
        placeholder="e.g. You were at the party, not sick"
        cost={rejectCost.length > 0 && <p className="small">Rejecting {rejectCost.join(" and ")}.</p>}
        onDecided={onDecided}
      />
    </>
  );
}

/**
 * A Change request item: the note, the changed terms old and new, when they'd
 * start, and the rest folded away; or, for an end, what approving does.
 */
function ChangeRequestItem({ item, timezone, onDecided, onAsk }: ItemProps & { item: ChangeReviewItem }) {
  return (
    <>
      <FromOwner item={item} />
      <article className="card">
        <h3>{item.endsPact ? `End ${item.pactName}` : item.pactName}</h3>
        {item.note !== null && <span className="quote">“{item.note}”</span>}
        {item.endsPact ? (
          <p className="small">
            Approving makes {item.pactName} Ended at once: no more days. Penalties already judged stay on{" "}
            {item.ownerName}'s ledger.
          </p>
        ) : (
          <>
            <DiffList changes={item.changes} />
            <p className="small">{startsText(item, "Approving applies")}</p>
            <EverythingElse request={item} />
          </>
        )}
      </article>
      <Thread thread={item.thread} viewer="reviewer" timezone={timezone} />
      <Decision
        itemId={item.id}
        onAsk={onAsk}
        placeholder={item.endsPact ? "e.g. Give it another month" : "e.g. $5 is what makes it stick"}
        cost={<p className="small">Rejecting keeps {item.pactName} as it is.</p>}
        onDecided={onDecided}
      />
    </>
  );
}

/** A Payment item: the screenshot, the owner's note, and what approving does to what they owe. */
function PaymentItem({ item, timezone, onDecided, onAsk }: ItemProps & { item: PaymentReviewItem }) {
  return (
    <>
      <FromOwner item={item} />
      <article className="card">
        <h3>
          {money(item.amountCents)} to {item.recipientName}
        </h3>
        <ScreenshotLink photoId={item.photoId} />
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
      <Thread thread={item.thread} viewer="reviewer" timezone={timezone} />
      <Decision
        itemId={item.id}
        onAsk={onAsk}
        placeholder="e.g. The screenshot shows a different amount"
        onDecided={onDecided}
      />
    </>
  );
}

/**
 * A Vacation item: the dates, the note, who it went to, and what each pact on
 * it gives up. It's approved or rejected as a whole.
 */
function VacationItem({ item, timezone, onDecided, onAsk }: ItemProps & { item: VacationReviewItem }) {
  const reviewers = item.reviewerNames;
  const decides = reviewers.length === 1 ? "" : reviewers.length === 2 ? " Either can decide." : " Any one can decide.";
  return (
    <>
      <FromOwner item={item} />
      <article className="card">
        <div className="spread">
          <h3>Vacation</h3>
          <span className="meta">
            {dateSpan(item.from, item.to)} · {plural(item.days, "day", "days")}
          </span>
        </div>
        <span className="small muted">
          {formatDate(item.from)} – {formatDate(item.to)} · {pactsText(item.pacts)}
        </span>
        {item.note !== null && <span className="quote">“{item.note}”</span>}
        <span className="small muted">
          Sent to {listNames(reviewers)}.{decides}
        </span>
        <span className="label">Covers</span>
        <div className="list">
          {item.covers.map((cover) => {
            const { head, lines } = coveredText(cover, cover.covered, item.from, item.to);
            return (
              <div key={cover.pactId} className="covrow">
                <span className="rt">
                  <b>{cover.name}</b>
                  <small>{head}</small>
                  {lines.map((line) => (
                    <small key={line}>{line}</small>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
        <p className="muted small">
          Approving excuses all of these and stops their reminders on these days. Once approved, it can't be changed.
        </p>
      </article>
      <Thread thread={item.thread} viewer="reviewer" timezone={timezone} />
      <Decision
        itemId={item.id}
        onAsk={onAsk}
        placeholder="e.g. Not two weeks before the gym challenge ends"
        cost={<p className="small">Rejecting keeps every day of {firstName(item.ownerName)}'s pacts as it is.</p>}
        onDecided={onDecided}
      />
    </>
  );
}

/**
 * Reject, Ask and Approve, kept in reach below an item. Reject opens a form
 * that needs a reason, with `cost` under it when rejecting costs the owner.
 * Ask opens a sheet for a question to the owner.
 */
function Decision({
  itemId,
  placeholder,
  cost,
  onDecided,
  onAsk,
}: {
  itemId: string;
  onAsk: () => void;
  /** An example reason for the reason box. */
  placeholder: string;
  cost?: ReactNode;
  onDecided: OnDecided;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const {
    busy,
    error,
    run: decide,
  } = useSend(
    async (decision: ReviewDecision) => {
      const result = await api.decide(itemId, decision);
      onDecided(result.ok ? null : result.reason);
    },
    (failure) => failureText(failure, "Couldn't send. Check your connection and try again."),
  );
  const rejectForm = useRef<HTMLDivElement>(null);
  const reasonField = useRef<HTMLTextAreaElement>(null);

  // The form opens below the photos, off-screen on a phone: bring it into view.
  useEffect(() => {
    if (!rejecting) return;
    rejectForm.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    reasonField.current?.focus({ preventScroll: true });
  }, [rejecting]);

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
              onClick={() => decide({ kind: "reject", reason })}
            >
              Reject
            </button>
          </div>
        </div>
      ) : (
        <div className="decide with-ask">
          <button className="btn danger" disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </button>
          <button className="btn" disabled={busy} onClick={onAsk}>
            Ask
          </button>
          <button className="btn ok" disabled={busy} onClick={() => decide({ kind: "approve" })}>
            Approve
          </button>
        </div>
      )}
    </>
  );
}
