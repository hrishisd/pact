// A change request's page, for its owner, pushed from Today or the pact's
// page: where it stands, the note, the changed terms old and new (or the end
// it asks for), when it would start, the terms it leaves alone, any questions
// about it with the reply box while one waits on the owner's reply, and
// Withdraw change while it waits.

import { useState } from "react";
import type { Json } from "../shared/api.ts";
import type { ChangeRequestDetail } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { DiffList, EverythingElse, listNames, startsText } from "./change-terms.tsx";
import { formatDayTime } from "./format.ts";
import { PencilIcon } from "./icons.tsx";
import { ReplyBox, Thread, WaitingChip } from "./questions.tsx";
import { Empty, useLoad } from "./ui.tsx";

export function ChangeRequestPage({
  changeRequestId,
  timezone,
  onOpenPact,
}: {
  changeRequestId: string;
  /** The profile's timezone, for when it was sent. */
  timezone: string;
  onOpenPact: (pactId: string, name: string) => void;
}) {
  const { data: result, failed, reload } = useLoad(() => api.changeRequest(changeRequestId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (result === null) {
    return failed ? (
      <Empty
        title="This change request couldn't load"
        body={failureText(failed.error, "Check your connection and reopen Pact.")}
      />
    ) : null;
  }
  if (!result.ok) return <Empty title="Change request not found" body="It isn't one of yours." />;
  const { changeRequest: request } = result;
  const waiting = request.state.kind === "waiting";

  const withdraw = async () => {
    setBusy(true);
    setError(null);
    try {
      const withdrawn = await api.withdrawChangeRequest(request.id);
      if (!withdrawn.ok) setError("It isn't waiting any more. Reopen it to see where it stands.");
      reload();
    } catch (failure) {
      setError(`Couldn't withdraw it. ${failureText(failure, "Check your connection and try again.")}`);
    }
    setBusy(false);
  };

  return (
    <>
      <div className="row2">
        <span className="kind k-change">
          <PencilIcon />
          Change
        </span>
        <StateChip request={request} />
      </div>
      <article className="card">
        <div className="stack-sm">
          <h3>
            <button className="link" onClick={() => onOpenPact(request.pactId, request.pactName)}>
              {request.endsPact ? `End ${request.pactName}` : request.pactName}
            </button>
          </h3>
          <span className="meta">Sent {formatDayTime(request.requestedAt, timezone)}</span>
        </div>
        {request.note !== null && <span className="quote">“{request.note}”</span>}
        {request.state.kind === "rejected" && (
          <p className="small">
            {request.state.reviewerName} said “{request.state.reason}”
          </p>
        )}
        {request.endsPact ? (
          <p className="small muted">
            {waiting
              ? `If approved, ${request.pactName} is Ended at once: no more days. Days already judged stay on your ledger.`
              : "Days already judged stay on your ledger."}
          </p>
        ) : (
          <>
            <DiffList changes={request.changes} />
            {waiting && <p className="small muted">{startsText(request, "If approved, it applies")}</p>}
            <EverythingElse request={request} />
          </>
        )}
      </article>
      <Thread thread={request.thread} viewer="owner" timezone={timezone} />
      {request.thread.waitingOnReply && <ReplyBox itemId={request.id} onReplied={reload} />}
      {waiting && (
        <>
          <p className="meta">Sent to {listNames(request.reviewerNames)}</p>
          {error && <p className="error">{error}</p>}
          <button className="btn danger self-start" disabled={busy} onClick={() => void withdraw()}>
            Withdraw change
          </button>
          <p className="small muted">
            Withdrawing keeps the terms as they are. Then you can request a different change.
          </p>
        </>
      )}
    </>
  );
}

function StateChip({ request }: { request: Json<ChangeRequestDetail> }) {
  const { state } = request;
  switch (state.kind) {
    case "waiting":
      return <WaitingChip thread={request.thread} />;
    case "approved":
      return <span className="chip c-satisfied">Approved by {state.reviewerName}</span>;
    case "rejected":
      return <span className="chip c-missed">Rejected by {state.reviewerName}</span>;
    case "withdrawn":
      return <span className="chip c-soon">Withdrawn</span>;
  }
}
