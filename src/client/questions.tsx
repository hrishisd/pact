// Reviewer questions: the thread under a review item ("Questions"), the
// owner's reply box on the item's page, and the reviewer's Ask sheet.
// Replies are text only.

import { useState } from "react";
import type { Json } from "../shared/api.ts";
import type { AskOwnerResult, QuestionThread, Refusal, ReplyResult } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { formatDayTime } from "./format.ts";
import { Sheet, useSend } from "./ui.tsx";

/**
 * The questions and replies so far, oldest first; nothing when there are
 * none. `viewer` says whose side is "mine", drawn on the right.
 */
export function Thread({
  thread,
  viewer,
  timezone,
}: {
  thread: Json<QuestionThread>;
  viewer: "owner" | "reviewer";
  timezone: string;
}) {
  if (thread.comments.length === 0) return null;
  return (
    <section className="stack">
      <div className="label">Questions</div>
      <div className="thread">
        {thread.comments.map((comment, i) => (
          <div key={i} className={comment.fromOwner === (viewer === "owner") ? "msg mine" : "msg"}>
            <small>
              {comment.authorName} · {formatDayTime(comment.sentAt, timezone)}
            </small>
            {comment.text}
          </div>
        ))}
      </div>
    </section>
  );
}

const REPLY_REFUSAL_TEXT: Record<Refusal<ReplyResult>, string> = {
  "item-not-found": "This wasn't found.",
  "not-waiting": "It's been decided already, so there's nothing to reply to.",
  "no-question": "There's no question waiting for your reply.",
  "blank-reply": "Write a reply first.",
};

/** The owner's reply box, under the thread while a question waits on their reply. */
export function ReplyBox({ itemId, onReplied }: { itemId: string; onReplied: () => void }) {
  const [text, setText] = useState("");
  const {
    busy,
    error,
    run: send,
  } = useSend(
    async () => {
      const result = await api.reply(itemId, text);
      if (!result.ok) return REPLY_REFUSAL_TEXT[result.reason];
      setText("");
      onReplied();
    },
    (failure) => `Couldn't send. ${failureText(failure, "Check your connection and try again.")}`,
  );

  return (
    <div className="stack">
      <textarea
        className="inp"
        rows={3}
        value={text}
        placeholder="Your reply"
        aria-label="Your reply"
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p className="error small">{error}</p>}
      <button className="btn primary block" disabled={busy || text.trim() === ""} onClick={() => send()}>
        {busy ? "Sending…" : "Send reply"}
      </button>
    </div>
  );
}

const ASK_REFUSAL_TEXT: Record<Refusal<AskOwnerResult>, string> = {
  "item-not-found": "That item isn't in your queue any more.",
  "already-decided": "Another reviewer already decided that one.",
  "blank-question": "Write your question first.",
};

/**
 * Ask: a question for the owner instead of a decision. The item leaves every
 * reviewer's queue until the owner replies.
 */
export function AskSheet({
  itemId,
  ownerName,
  placeholder,
  onClose,
  onAsked,
}: {
  itemId: string;
  ownerName: string;
  /** An example question. */
  placeholder: string;
  onClose: () => void;
  onAsked: () => void;
}) {
  const [text, setText] = useState("");
  const {
    busy,
    error,
    run: send,
  } = useSend(
    async () => {
      const result = await api.askOwner(itemId, text);
      if (!result.ok) return ASK_REFUSAL_TEXT[result.reason];
      onAsked();
    },
    (failure) => `Couldn't send. ${failureText(failure, "Check your connection and try again.")}`,
  );

  return (
    <Sheet title={`Ask ${ownerName}`} closeLabel="Cancel" onClose={onClose}>
      <p className="small muted">
        It leaves your queue until {ownerName} replies, and comes back to every reviewer then. You can still decide it
        while you wait.
      </p>
      <label className="field">
        <span>Question</span>
        <textarea
          className="inp"
          rows={3}
          value={text}
          placeholder={placeholder}
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {error && <p className="error small">{error}</p>}
      <button className="btn primary block" disabled={busy || text.trim() === ""} onClick={() => send()}>
        {busy ? "Sending…" : `Send to ${ownerName}`}
      </button>
    </Sheet>
  );
}

/** The chip of an item of the owner's still waiting: on their reply, or for approval. */
export function WaitingChip({ thread }: { thread: Json<QuestionThread> }) {
  return thread.waitingOnReply ? (
    <span className="chip c-reply">Waiting on your reply</span>
  ) : (
    <span className="chip c-wait">Waiting for approval</span>
  );
}
