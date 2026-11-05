// A payment's page, for its owner, pushed from a reviewer's question on Today
// or its push: where its review stands, the amount and recipient, the note
// and screenshot, the questions so far, and the reply box while a question
// waits on the owner's reply.

import { API_PATHS, type Json } from "../shared/api.ts";
import type { PaymentDetail } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { listNames } from "./change-terms.tsx";
import { formatDayTime, money } from "./format.ts";
import { DollarIcon } from "./icons.tsx";
import { ReplyBox, Thread, WaitingChip } from "./questions.tsx";
import { Empty, useLoad } from "./ui.tsx";

export function PaymentPage({
  paymentId,
  timezone,
  onOpenLedger,
}: {
  paymentId: string;
  /** The profile's timezone, for when it was sent and asked about. */
  timezone: string;
  onOpenLedger: (recipientId: string, name: string) => void;
}) {
  const { data: result, failed, reload } = useLoad(() => api.payment(paymentId));

  if (result === null) {
    return failed ? (
      <Empty
        title="This payment couldn't load"
        body={failureText(failed.error, "Check your connection and reopen Pact.")}
      />
    ) : null;
  }
  if (!result.ok) return <Empty title="Payment not found" body="It isn't one of yours." />;
  const { payment } = result;
  const { state } = payment;
  const src = API_PATHS.photo(encodeURIComponent(payment.photoId));
  return (
    <>
      <div className="row2">
        <span className="kind k-payment">
          <DollarIcon />
          Payment
        </span>
        <StateChip payment={payment} />
      </div>
      <article className="card">
        <h3>
          {money(payment.amountCents)} to{" "}
          <button className="link" onClick={() => onOpenLedger(payment.recipientId, payment.recipientName)}>
            {payment.recipientName}
          </button>
        </h3>
        {payment.note !== null && <span className="quote">“{payment.note}”</span>}
        {state.kind === "rejected" && (
          <p className="small">
            {state.reviewerName} said “{state.reason}”
          </p>
        )}
        {/* Opens the screenshot full size in a new tab. */}
        <a href={src} target="_blank" rel="noreferrer">
          <img className="big-photo whole" src={src} alt="Payment screenshot" />
        </a>
      </article>
      <Thread thread={payment.thread} viewer="owner" timezone={timezone} />
      {payment.thread.waitingOnReply && <ReplyBox itemId={payment.id} onReplied={reload} />}
      <p className="meta">
        Sent to {listNames(payment.reviewerNames)} · {formatDayTime(payment.recordedAt, timezone)}
      </p>
    </>
  );
}

function StateChip({ payment }: { payment: Json<PaymentDetail> }) {
  const { state } = payment;
  switch (state.kind) {
    case "waiting":
      return <WaitingChip thread={payment.thread} />;
    case "approved":
      return <span className="chip c-satisfied">Approved by {state.reviewerName}</span>;
    case "rejected":
      return <span className="chip c-missed">Rejected by {state.reviewerName}</span>;
  }
}
