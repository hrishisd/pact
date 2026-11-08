// The Profile sheet's Vacation section: the owner's vacations waiting for
// approval or approved ahead, soonest first, and Plan a vacation below them.
// A waiting one has Withdraw; one waiting on the owner's reply also has Reply.

import { useState } from "react";
import type { Json } from "../shared/api.ts";
import type { VacationCard } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { listNames } from "./change-terms.tsx";
import { dateSpan } from "./format.ts";
import { ReplyBox } from "./questions.tsx";
import { loadedData, loadFailure, useLoad, useSend } from "./ui.tsx";
import { firstName, pactsText, plural } from "./vacation-text.ts";

const WITHDRAWN = "Vacation withdrawn. Your pacts keep all their days.";

export function VacationSection({ message, onPlan }: { message: string | null; onPlan: () => void }) {
  const { state, reload } = useLoad(api.vacations);
  const vacations = loadedData(state);
  const [said, setSaid] = useState(message);
  const saying = (text: string) => () => {
    setSaid(text);
    reload();
  };

  return (
    <section className="stack">
      {said && (
        <div className="alert ok" role="status">
          <b>{said}</b>
        </div>
      )}
      <div className="label">Vacation</div>
      {loadFailure(state) && <p className="muted small">Vacations couldn't load.</p>}
      {vacations?.map((vacation) => (
        <VacationCardView
          key={vacation.id}
          vacation={vacation}
          onWithdrawn={saying(WITHDRAWN)}
          onReplied={saying(`Reply sent. It's back with ${listNames(vacation.reviewerNames.map(firstName))}.`)}
        />
      ))}
      <div className="spread">
        {vacations?.length === 0 ? <span className="muted">None planned</span> : <span />}
        <button className="link" onClick={onPlan}>
          Plan a vacation
        </button>
      </div>
    </section>
  );
}

/** "Sent to Sam Rivera and Alex Chen. …", or with one reviewer "Sam Rivera reviews it. …". */
function sentTo(names: string[]): string {
  return names.length === 1
    ? `${names[0]} reviews it. Nothing changes until it's approved.`
    : `Sent to ${listNames(names)}. Nothing changes until one of them approves it.`;
}

const CHIPS: Record<VacationCard["state"]["kind"], { className: string; text: string }> = {
  waiting: { className: "c-wait", text: "Waiting for approval" },
  "waiting-on-reply": { className: "c-reply", text: "Waiting on your reply" },
  approved: { className: "c-ok", text: "Approved" },
};

/** One vacation's card: its dates, note and pacts, then where it stands and what the owner can do. */
function VacationCardView({
  vacation,
  onWithdrawn,
  onReplied,
}: {
  vacation: Json<VacationCard>;
  onWithdrawn: () => void;
  onReplied: () => void;
}) {
  const { state } = vacation;
  const chip = CHIPS[state.kind];
  return (
    <div className="card vaccard">
      <div className="spread">
        <b>Vacation {dateSpan(vacation.from, vacation.to)}</b>
        <span className={`chip ${chip.className}`}>{chip.text}</span>
      </div>
      {vacation.note && <div className="vacnote">{vacation.note}</div>}
      <small className="muted">
        {pactsText(vacation.pacts)} · {plural(vacation.days, "day", "days")}
      </small>
      {state.kind === "approved" ? (
        <small className="muted">Approved by {state.reviewerName}. It can't be changed now.</small>
      ) : (
        <WaitingActions vacation={vacation} onWithdrawn={onWithdrawn} onReplied={onReplied} />
      )}
    </div>
  );
}

/**
 * What the owner can do while a vacation waits: Withdraw, which asks first,
 * and, while a question waits on their reply, the question and Reply.
 */
function WaitingActions({
  vacation,
  onWithdrawn,
  onReplied,
}: {
  vacation: Json<VacationCard>;
  onWithdrawn: () => void;
  onReplied: () => void;
}) {
  const [open, setOpen] = useState<"withdraw" | "reply" | null>(null);
  const { state } = vacation;
  const withdraw = useSend(
    async () => {
      const result = await api.withdrawVacation(vacation.id);
      if (!result.ok) return "It's no longer waiting for approval. Reopen Profile to see where it stands.";
      onWithdrawn();
    },
    (failure) => `Couldn't withdraw. ${failureText(failure, "Check your connection and try again.")}`,
  );

  return (
    <>
      {state.kind === "waiting-on-reply" ? (
        <span className="small">
          <b>{firstName(state.askedBy)} asked:</b> “{state.question}”
        </span>
      ) : (
        <small>{sentTo(vacation.reviewerNames)}</small>
      )}
      {open === "withdraw" ? (
        <div className="alert amber" role="status">
          <span>Withdraw this vacation? Your pacts keep all their days.</span>
          <div className="row2">
            <button className="btn sm danger" disabled={withdraw.busy} onClick={() => withdraw.run()}>
              {withdraw.busy ? "Withdrawing…" : "Withdraw"}
            </button>
            <button className="btn sm" disabled={withdraw.busy} onClick={() => setOpen(null)}>
              Keep it
            </button>
          </div>
        </div>
      ) : open === "reply" && state.kind === "waiting-on-reply" ? (
        <ReplyBox
          itemId={vacation.id}
          placeholder="e.g. My flight leaves Sun Dec 20 at 7am"
          sendLabel={`Send to ${firstName(state.askedBy)}`}
          onCancel={() => setOpen(null)}
          onReplied={onReplied}
        />
      ) : (
        <div className="row2">
          {state.kind === "waiting-on-reply" && (
            <button className="btn sm primary" onClick={() => setOpen("reply")}>
              Reply
            </button>
          )}
          <button className="btn sm danger" onClick={() => setOpen("withdraw")}>
            Withdraw
          </button>
        </div>
      )}
      {withdraw.error && <p className="error small">{withdraw.error}</p>}
    </>
  );
}
