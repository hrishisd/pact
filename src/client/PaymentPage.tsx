// A payment's page, for its owner, pushed from a reviewer's question on Today
// or its push: where its review stands, the amount and recipient, the note
// and screenshot, the questions so far, and the reply box while a question
// waits on the owner's reply.

import { API_PATHS, type Json } from "../shared/api.ts";
import type { PaymentDetail } from "../shared/types.ts";
import { api } from "./api.ts";
import { money } from "./format.ts";
import { ItemKindHeader, ItemStateChip, OwnerThread, StateLine, ScreenshotLink, SentTo } from "./item-page.tsx";
import { useRefresh } from "./pull-to-refresh.tsx";
import { LoadedFound, useLoad } from "./ui.tsx";

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
  const { state, reload } = useLoad(() => api.payment(paymentId), API_PATHS.paymentItem(paymentId));
  // A page that shows what it loads reloads it by itself when due on coming back to the front.
  useRefresh(reload);

  return (
    <LoadedFound
      state={state}
      what="This payment"
      notFound={{ title: "Payment not found", body: "It isn't one of yours." }}
    >
      {({ payment }) => (
        <PaymentView payment={payment} timezone={timezone} onOpenLedger={onOpenLedger} onReplied={reload} />
      )}
    </LoadedFound>
  );
}

function PaymentView({
  payment,
  timezone,
  onOpenLedger,
  onReplied,
}: {
  payment: Json<PaymentDetail>;
  timezone: string;
  onOpenLedger: (recipientId: string, name: string) => void;
  onReplied: () => void;
}) {
  return (
    <>
      <ItemKindHeader kind="payment">
        <ItemStateChip state={payment.state} thread={payment.thread} />
      </ItemKindHeader>
      <article className="card">
        <h3>
          {money(payment.amountCents)} to{" "}
          <button className="link" onClick={() => onOpenLedger(payment.recipientId, payment.recipientName)}>
            {payment.recipientName}
          </button>
        </h3>
        {payment.note !== null && <span className="quote">“{payment.note}”</span>}
        <StateLine state={payment.state} timezone={timezone} />
        <ScreenshotLink photoId={payment.photoId} />
      </article>
      <OwnerThread itemId={payment.id} thread={payment.thread} timezone={timezone} onReplied={onReplied} />
      <SentTo reviewerNames={payment.reviewerNames} sentAt={payment.recordedAt} timezone={timezone} />
    </>
  );
}
