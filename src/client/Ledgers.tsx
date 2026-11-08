// The Ledgers tab: one card per recipient, with what's owed, a status line
// for an overdue bill, a bill due or a payment awaiting approval, and Record
// payment, each opening its ledger's page: the penalties Missed occurrences
// added (and who rejected the evidence when that's why, or that an excuse
// waiting for approval holds them), the bill each is on or goes on, the
// payments, and which penalties those have paid.

import { useEffect, useState, type ReactNode } from "react";
import type { Json } from "../shared/api.ts";
import type { LedgerPayment, LedgerPenalty, LedgerSummary } from "../shared/types.ts";
import { api } from "./api.ts";
import { formatDate, formatDay, money } from "./format.ts";
import { RecordPaymentSheet } from "./RecordPayment.tsx";
import { Empty, Loaded, LoadedFound, loadedData, useLoad } from "./ui.tsx";

export function Ledgers({
  timezone,
  onOpenLedger,
}: {
  /** The profile's timezone, for when a bill is due. */
  timezone: string;
  onOpenLedger: (recipientId: string, name: string) => void;
}) {
  const { state, reload } = useLoad(api.ledgers);
  // The ledger whose Record a payment sheet is open, outside the cards.
  const [paying, setPaying] = useState<Json<LedgerSummary> | null>(null);

  return (
    <Loaded state={state} what="Ledgers">
      {(ledgers) =>
        ledgers.length === 0 ? (
          <Empty title="No ledgers yet" body="Each recipient gets a ledger once a pact names them." />
        ) : (
          <>
            <div className="cards">
              {ledgers.map((ledger) => (
                // Record payment sits beside the button that opens the ledger, not inside it.
                <div key={ledger.recipientId} className="ledger-card">
                  <button className="rowbtn" onClick={() => onOpenLedger(ledger.recipientId, ledger.name)}>
                    <span className="rt">
                      <b>{ledger.name}</b>
                      <Summary ledger={ledger} timezone={timezone} />
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
        )
      }
    </Loaded>
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
  /** The profile's timezone, for when payments were recorded and bills are due. */
  timezone: string;
  onLoaded: (recipientId: string, name: string) => void;
  onOpenPact: (pactId: string, name: string) => void;
}) {
  // Reloaded after a payment, keeping the ledger shown meanwhile and if the reload fails.
  const { state, reload } = useLoad(() => api.ledger(recipientId));
  const result = loadedData(state);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (result?.ok) onLoaded(recipientId, result.ledger.summary.name);
  }, [result, recipientId, onLoaded]);

  return (
    <LoadedFound
      state={state}
      what="This ledger"
      notFound={{ title: "Ledger not found", body: "It isn't one of your ledgers." }}
    >
      {({ ledger: { summary, history } }) => (
        <>
          <section className="card">
            <Summary ledger={summary} timezone={timezone} />
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
      )}
    </LoadedFound>
  );
}

/**
 * The bill a penalty is on or goes on; held, that an excuse or vacation
 * holds it, and for an excuse the bill it goes on if that's rejected.
 */
function billText(bill: Json<LedgerPenalty>["bill"]): string {
  switch (bill.kind) {
    case "on-bill":
      return `On the ${formatDate(bill.billedOn)} bill`;
    case "next-bill":
      return `Goes on the ${formatDate(bill.billedOn)} bill`;
    case "if-excuse-rejected":
      return `Held while an excuse waits for approval · Goes on the ${formatDate(bill.billedOn)} bill if the excuse is rejected`;
    case "if-vacation-rejected":
      return "Held while a vacation waits for approval";
  }
}

/**
 * A penalty in the history: its pact, the day Missed, the bill it's on or
 * goes on, how much payments have paid (or that an excuse or vacation holds it, so it
 * isn't owed), and who rejected the evidence.
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
          {penalty.week
            ? `Week of ${formatDate(penalty.occurrenceDate)}, ${penalty.week.sessions} of ${penalty.week.target}`
            : `Missed ${formatDate(penalty.occurrenceDate)}`}
          {` · ${billText(penalty.bill)}`}
          {penalty.held ? null : penalty.paidCents === penalty.amountCents ? (
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
    case "waiting":
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
function RecordPaymentButton({ ledger, onRecord }: { ledger: Json<LedgerSummary>; onRecord: () => void }) {
  return (
    <button className="btn primary sm self-start record-pay" disabled={ledger.payableCents <= 0} onClick={onRecord}>
      Record payment
    </button>
  );
}

/**
 * The big owed amount, then one status line only when needed (overdue, else
 * a bill due, else payments awaiting approval), then lifetime paid.
 */
function Summary({ ledger, timezone }: { ledger: Json<LedgerSummary>; timezone: string }) {
  return (
    <span className="ledger-sum">
      <span className="bigmoney">{money(ledger.owedCents)}</span>
      <span className="meta">owed</span>
      <StatusLine ledger={ledger} timezone={timezone} />
      <span className="meta">Lifetime paid {money(ledger.paidCents)}</span>
    </span>
  );
}

function StatusLine({ ledger, timezone }: { ledger: Json<LedgerSummary>; timezone: string }) {
  if (ledger.overdueCents > 0) return <span className="meta pen">{money(ledger.overdueCents)} overdue</span>;
  if (ledger.billDue) {
    return (
      <span className="meta">
        {money(ledger.billDue.amountCents)} bill due {formatDay(ledger.billDue.dueAt, timezone)}
      </span>
    );
  }
  if (ledger.awaitingCount === 1) {
    return <span className="meta">{money(ledger.awaitingCents)} payment awaiting approval</span>;
  }
  if (ledger.awaitingCount > 1) {
    return (
      <span className="meta">
        {ledger.awaitingCount} payments awaiting approval · {money(ledger.awaitingCents)}
      </span>
    );
  }
  return null;
}
