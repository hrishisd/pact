// The Ledgers tab: one card per recipient, each opening its ledger's page with
// the penalties Missed occurrences added. Bills and payments come later.

import { useEffect, useState } from "react";
import type { Json } from "../shared/api.ts";
import type { Ledger, LedgerSummary } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { formatDate, money } from "./format.ts";
import { Empty, useLoad } from "./ui.tsx";

export function Ledgers({ onOpenLedger }: { onOpenLedger: (recipientId: string, name: string) => void }) {
  const { data: ledgers, failed } = useLoad(api.ledgers);

  if (failed) {
    return (
      <Empty title="Ledgers couldn't load" body={failureText(failed.error, "Check your connection and reopen Pact.")} />
    );
  }
  if (ledgers?.length === 0) {
    return <Empty title="No ledgers yet" body="Each recipient gets a ledger once a pact names them." />;
  }
  return (
    <div className="cards">
      {ledgers?.map((ledger) => (
        <button
          key={ledger.recipientId}
          className="rowbtn"
          onClick={() => onOpenLedger(ledger.recipientId, ledger.name)}
        >
          <span className="rt">
            <b>{ledger.name}</b>
            <Summary ledger={ledger} />
          </span>
        </button>
      ))}
    </div>
  );
}

type State =
  | { kind: "loading" }
  | { kind: "loaded"; ledger: Json<Ledger> }
  | { kind: "not-found" }
  | { kind: "failed"; error: unknown };

/** A ledger's page, pushed on the Ledgers tab: what's owed and the penalties behind it, newest first. */
export function LedgerPage({
  recipientId,
  onLoaded,
  onOpenPact,
}: {
  recipientId: string;
  onLoaded: (recipientId: string, name: string) => void;
  onOpenPact: (pactId: string, name: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    api.ledger(recipientId).then(
      (result) => {
        if (!result.ok) return setState({ kind: "not-found" });
        setState({ kind: "loaded", ledger: result.ledger });
        onLoaded(recipientId, result.ledger.summary.name);
      },
      (error: unknown) => setState({ kind: "failed", error }),
    );
  }, [recipientId, onLoaded]);

  switch (state.kind) {
    case "loading":
      return null;
    case "not-found":
      return <Empty title="Ledger not found" body="It isn't one of your ledgers." />;
    case "failed":
      return (
        <Empty
          title="This ledger couldn't load"
          body={failureText(state.error, "Check your connection and reopen Pact.")}
        />
      );
    case "loaded": {
      const { summary, history } = state.ledger;
      return (
        <>
          <section className="card">
            <Summary ledger={summary} />
          </section>
          <section className="stack">
            <div className="label">History</div>
            {/* Not tappable as rows: each penalty links to its pact by name. */}
            <div className="list">
              {history.length === 0 && <div className="rowbtn muted">Nothing yet</div>}
              {history.map((penalty) => (
                <div key={penalty.penaltyId} className="rowbtn">
                  <span className="rt">
                    <button className="link" onClick={() => onOpenPact(penalty.pactId, penalty.pactName)}>
                      {penalty.pactName}
                    </button>
                    <small>Missed {formatDate(penalty.occurrenceDate)}</small>
                  </span>
                  <span className="pen num">+{money(penalty.amountCents)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      );
    }
  }
}

/** The big owed amount, then lifetime paid. */
function Summary({ ledger }: { ledger: LedgerSummary }) {
  return (
    <span className="ledger-sum">
      <span className="bigmoney">{money(ledger.owedCents)}</span>
      <span className="meta">owed</span>
      <span className="meta">Lifetime paid {money(ledger.paidCents)}</span>
    </span>
  );
}
