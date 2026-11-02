// The Ledgers tab: one card per recipient, with what's owed and Record
// payment, each opening its ledger's page: the penalties Missed occurrences
// added (and who rejected the evidence when that's why, or that an excuse
// waiting for approval holds them), the payments, and which penalties those
// have paid. Bills come later.

import { useEffect, useState, type ReactNode } from "react";
import type { Json } from "../shared/api.ts";
import type { LedgerPayment, LedgerPenalty, LedgerSummary } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { formatDate, formatDay, money } from "./format.ts";
import { RecordPaymentSheet } from "./RecordPayment.tsx";
import { Empty, useLoad } from "./ui.tsx";

export function Ledgers({ onOpenLedger }: { onOpenLedger: (recipientId: string, name: string) => void }) {
  const { data: ledgers, failed, reload } = useLoad(api.ledgers);
  // The ledger whose Record a payment sheet is open, outside the cards.
  const [paying, setPaying] = useState<LedgerSummary | null>(null);

  if (failed) {
    return (
      <Empty title="Ledgers couldn't load" body={failureText(failed.error, "Check your connection and reopen Pact.")} />
    );
  }
  if (ledgers?.length === 0) {
    return <Empty title="No ledgers yet" body="Each recipient gets a ledger once a pact names them." />;
  }
  return (
    <>
      <div className="cards">
        {ledgers?.map((ledger) => (
          // Record payment sits beside the button that opens the ledger, not inside it.
          <div key={ledger.recipientId} className="ledger-card">
            <button className="rowbtn" onClick={() => onOpenLedger(ledger.recipientId, ledger.name)}>
              <span className="rt">
                <b>{ledger.name}</b>
                <Summary ledger={ledger} />
              </span>
            </button>
            <RecordPaymentButton ledger={ledger} onRecord={() => setPaying(ledger)} />
          </div>
        ))}
      </div>
      {paying && (
        <RecordPaymentSheet
          ledger={paying}
          onClose={() => setPaying(null)}
          onSent={() => {
            setPaying(null);
            reload();
          }}
        />
      )}
    </>
  );
}

/** A ledger's page, pushed on the Ledgers tab: what's owed and the penalties behind it, newest first. */
export function LedgerPage({
  recipientId,
  timezone,
  onLoaded,
  onOpenPact,
}: {
  recipientId: string;
  /** The profile's timezone, for when payments were recorded. */
  timezone: string;
  onLoaded: (recipientId: string, name: string) => void;
  onOpenPact: (pactId: string, name: string) => void;
}) {
  // Reloaded after a payment, keeping the ledger shown meanwhile and if the reload fails.
  const { data: result, failed, reload } = useLoad(() => api.ledger(recipientId));
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (result?.ok) onLoaded(recipientId, result.ledger.summary.name);
  }, [result, recipientId, onLoaded]);

  if (result === null) {
    return failed ? (
      <Empty
        title="This ledger couldn't load"
        body={failureText(failed.error, "Check your connection and reopen Pact.")}
      />
    ) : null;
  }
  if (!result.ok) return <Empty title="Ledger not found" body="It isn't one of your ledgers." />;
  const { summary, history } = result.ledger;
  return (
    <>
      <section className="card">
        <Summary ledger={summary} />
        <RecordPaymentButton ledger={summary} onRecord={() => setPaying(true)} />
      </section>
      <section className="stack">
        <div className="label">History</div>
        {/* Not tappable as rows: each penalty links to its pact by name. */}
        <div className="list">
          {history.length === 0 && <div className="rowbtn muted">Nothing yet</div>}
          {history.map((entry) =>
            entry.kind === "penalty" ? (
              <PenaltyRow key={entry.penaltyId} penalty={entry} onOpenPact={onOpenPact} />
            ) : (
              <PaymentRow key={entry.paymentId} payment={entry} timezone={timezone} />
            ),
          )}
        </div>
      </section>
      {paying && (
        <RecordPaymentSheet
          ledger={summary}
          onClose={() => setPaying(false)}
          onSent={() => {
            setPaying(false);
            reload();
          }}
        />
      )}
    </>
  );
}

/**
 * A penalty in the history: its pact, the day Missed, how much payments have
 * paid (or that an excuse holds it, so it isn't owed), and who rejected the evidence.
 */
function PenaltyRow({
  penalty,
  onOpenPact,
}: {
  penalty: Json<LedgerPenalty>;
  onOpenPact: (pactId: string, name: string) => void;
}) {
  return (
    <div className="rowbtn">
      <span className="rt">
        <button className="link" onClick={() => onOpenPact(penalty.pactId, penalty.pactName)}>
          {penalty.pactName}
        </button>
        <small>
          Missed {formatDate(penalty.occurrenceDate)}
          {penalty.held ? (
            " · Held while an excuse waits for approval"
          ) : penalty.paidCents === penalty.amountCents ? (
            <span className="paid"> · Paid</span>
          ) : (
            penalty.paidCents > 0 && ` · ${money(penalty.paidCents)} of ${money(penalty.amountCents)} paid`
          )}
        </small>
        {penalty.rejection && (
          <small>
            Rejected by {penalty.rejection.reviewerName}: “{penalty.rejection.reason}”
          </small>
        )}
      </span>
      {penalty.held ? (
        <span className="num muted">{money(penalty.amountCents)}</span>
      ) : (
        <span className="pen num">+{money(penalty.amountCents)}</span>
      )}
    </div>
  );
}

/** A payment in the history: its note, where its review stands, and when it was recorded. Only an approved one counts. */
function PaymentRow({ payment, timezone }: { payment: Json<LedgerPayment>; timezone: string }) {
  const { state } = payment;
  let stateText: string;
  let amount: ReactNode;
  switch (state.kind) {
    case "awaiting-approval":
      stateText = "Awaiting approval";
      amount = <span className="num muted">{money(payment.amountCents)}</span>;
      break;
    case "approved":
      stateText = `Approved by ${state.reviewerName}`;
      amount = <span className="num paid">−{money(payment.amountCents)}</span>;
      break;
    case "rejected":
      stateText = `Rejected by ${state.reviewerName}: “${state.reason}”`;
      amount = <span className="num muted struck">{money(payment.amountCents)}</span>;
      break;
  }
  return (
    <div className="rowbtn">
      <span className="rt">
        <b>Payment</b>
        <small>{[payment.note, stateText, formatDay(payment.recordedAt, timezone)].filter(Boolean).join(" · ")}</small>
      </span>
      {amount}
    </div>
  );
}

/** Record payment, opening its sheet. It's off while nothing more may be paid. */
function RecordPaymentButton({ ledger, onRecord }: { ledger: LedgerSummary; onRecord: () => void }) {
  return (
    <button className="btn primary sm self-start record-pay" disabled={ledger.payableCents <= 0} onClick={onRecord}>
      Record payment
    </button>
  );
}

/** The big owed amount, then a status line while payments await approval, then lifetime paid. */
function Summary({ ledger }: { ledger: LedgerSummary }) {
  return (
    <span className="ledger-sum">
      <span className="bigmoney">{money(ledger.owedCents)}</span>
      <span className="meta">owed</span>
      {ledger.awaitingCount === 1 && (
        <span className="meta">{money(ledger.awaitingCents)} payment awaiting approval</span>
      )}
      {ledger.awaitingCount > 1 && (
        <span className="meta">
          {ledger.awaitingCount} payments awaiting approval · {money(ledger.awaitingCents)}
        </span>
      )}
      <span className="meta">Lifetime paid {money(ledger.paidCents)}</span>
    </span>
  );
}
