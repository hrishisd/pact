// Building blocks of review items (evidence, excuses, payments, change
// requests, vacations), shared by their owner's pages, the Review tab, and
// the rows that list items still waiting.

import type { ReactNode } from "react";
import { API_PATHS, type Json } from "../shared/api.ts";
import { formatDate } from "../shared/format.ts";
import type { ChangeRequestState, QuestionThread, ReviewItem, TodayWaitingItem } from "../shared/types.ts";
import { listNames } from "./change-terms.tsx";
import { datesText } from "./excuse-days.tsx";
import { formatDayTime, money } from "./format.ts";
import { CameraIcon, DollarIcon, ExcuseIcon, PencilIcon, SuitcaseIcon } from "./icons.tsx";
import { ReplyBox, Thread } from "./questions.tsx";

type ItemKind = ReviewItem["kind"];

/** Each kind's name, colour and icon, on its tile and in its rows. */
const ITEM_KINDS: Record<ItemKind, { label: string; className: string; Icon: typeof CameraIcon }> = {
  evidence: { label: "Evidence", className: "k-evidence", Icon: CameraIcon },
  excuse: { label: "Excuse", className: "k-excuse", Icon: ExcuseIcon },
  payment: { label: "Payment", className: "k-payment", Icon: DollarIcon },
  "change-request": { label: "Change", className: "k-change", Icon: PencilIcon },
  vacation: { label: "Vacation", className: "k-vacation", Icon: SuitcaseIcon },
};

/** The top of an item: its kind's tile, then `children` beside it (where it stands, or whose it is). */
export function ItemKindHeader({ kind, children }: { kind: ItemKind; children: ReactNode }) {
  const { label, className, Icon } = ITEM_KINDS[kind];
  return (
    <div className="row2">
      <span className={`kind ${className}`}>
        <Icon />
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Where one of the owner's items stands: waiting on their reply or for
 * approval, approved or rejected and by whom, or withdrawn (a change request).
 */
export function ItemStateChip({
  state,
  thread,
  approvedClass = "c-ok",
}: {
  state: Json<ChangeRequestState>;
  thread: Json<QuestionThread>;
  /** The approved chip's colour: an approved excuse is Excused's. */
  approvedClass?: string;
}) {
  switch (state.kind) {
    case "waiting":
      return thread.waitingOnReply ? (
        <span className="chip c-reply">Waiting on your reply</span>
      ) : (
        <span className="chip c-wait">Waiting for approval</span>
      );
    case "approved":
      return <span className={`chip ${approvedClass}`}>Approved by {state.reviewerName}</span>;
    case "rejected":
      return <span className="chip c-missed">Rejected by {state.reviewerName}</span>;
    case "withdrawn":
      return <span className="chip c-soon">Withdrawn</span>;
  }
}

/** Under a rejected item: Sam said “why”. Nothing otherwise. */
export function RejectionLine({ state }: { state: Json<ChangeRequestState> }) {
  if (state.kind !== "rejected") return null;
  return (
    <p className="small">
      {state.reviewerName} said “{state.reason}”
    </p>
  );
}

/** An item's photos, each opening full size in a new tab. */
export function PhotoLinks({ photoIds }: { photoIds: string[] }) {
  return photoIds.map((photoId, i) => {
    const src = API_PATHS.photo(encodeURIComponent(photoId));
    return (
      <a key={photoId} href={src} target="_blank" rel="noreferrer">
        <img className="big-photo" src={src} alt={`Photo ${i + 1} of ${photoIds.length}`} />
      </a>
    );
  });
}

/** A payment's screenshot, whole, opening full size in a new tab. */
export function ScreenshotLink({ photoId }: { photoId: string }) {
  const src = API_PATHS.photo(encodeURIComponent(photoId));
  return (
    <a href={src} target="_blank" rel="noreferrer">
      <img className="big-photo whole" src={src} alt="Payment screenshot" />
    </a>
  );
}

/** The questions about one of the owner's items, and the reply box while one waits on their reply. */
export function OwnerThread({
  itemId,
  thread,
  timezone,
  onReplied,
}: {
  itemId: string;
  thread: Json<QuestionThread>;
  timezone: string;
  onReplied: () => void;
}) {
  return (
    <>
      <Thread thread={thread} viewer="owner" timezone={timezone} />
      {thread.waitingOnReply && <ReplyBox itemId={itemId} onReplied={onReplied} />}
    </>
  );
}

/** Who an item was sent to, and when: "Sent to Sam and Alex · Thu Oct 22, 9:05pm". */
export function SentTo({
  reviewerNames,
  sentAt,
  timezone,
}: {
  reviewerNames: string[];
  sentAt: string;
  timezone: string;
}) {
  return (
    <p className="meta">
      Sent to {listNames(reviewerNames)} · {formatDayTime(sentAt, timezone)}
    </p>
  );
}

/** One of the owner's items still waiting for a decision, as Today and a pact page list it. */
type WaitingItem = Json<TodayWaitingItem>;

/** How each kind opens its own page (a vacation: its Profile card), from the item's id. */
export type ItemOpeners = { readonly [K in ItemKind]: (id: string) => void };

/** Opens the page of one of the owner's waiting items, from any list or alert that shows it. */
export function openItem(item: WaitingItem, open: ItemOpeners): void {
  open[item.kind](item.id);
}

/** Each kind's row in a waiting list: its title, and what follows the kind's name. */
const WAITING_ROWS: {
  readonly [K in ItemKind]: (item: Extract<WaitingItem, { kind: K }>) => { title: string; detail?: string };
} = {
  evidence: (item) => ({ title: item.name, detail: formatDate(item.occurrenceDate) }),
  excuse: (item) => ({ title: item.name, detail: datesText(item.firstDate, item.lastDate) }),
  payment: (item) => ({ title: `${money(item.amountCents)} to ${item.recipientName}` }),
  "change-request": (item) => ({ title: item.name, ...(item.endsPact && { detail: "End this pact" }) }),
  vacation: (item) => ({ title: datesText(item.firstDate, item.lastDate) }),
};

/** One of the owner's waiting items, the same row wherever it's listed; it opens the item's page. */
export function WaitingItemRow<T extends WaitingItem>({ item, onOpen }: { item: T; onOpen: (item: T) => void }) {
  const row = WAITING_ROWS[item.kind] as (item: WaitingItem) => { title: string; detail?: string };
  const { title, detail } = row(item);
  return <WaitingRow kind={item.kind} title={title} detail={detail} onOpen={() => onOpen(item)} />;
}

/**
 * An item in a list of items still waiting: its kind's icon, `title`, and
 * the kind's name with `detail` after it. It opens with `onOpen`; without
 * one it's a plain row.
 */
export function WaitingRow({
  kind,
  title,
  detail,
  onOpen,
}: {
  kind: ItemKind;
  title: ReactNode;
  detail?: string;
  onOpen?: () => void;
}) {
  const { label, className, Icon } = ITEM_KINDS[kind];
  const content = (
    <>
      <span className={`kico ${className}`}>
        <Icon />
      </span>
      <span className="rt">
        <b>{title}</b>
        <small>
          {label}
          {detail !== undefined && ` · ${detail}`}
        </small>
      </span>
    </>
  );
  return onOpen ? (
    <button className="rowbtn" onClick={onOpen}>
      {content}
    </button>
  ) : (
    <div className="rowbtn still">{content}</div>
  );
}
