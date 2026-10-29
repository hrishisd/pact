// A pact's page, pushed on the current tab: its terms. History and actions come later.

import { useEffect, useState } from "react";
import type { Json } from "../shared/api.ts";
import type { PactTerms } from "../shared/types.ts";
import { api } from "./api.ts";
import { money, scheduleText } from "./format.ts";
import { Empty } from "./ui.tsx";

type Pact = Json<PactTerms>;

type State = { kind: "loading" } | { kind: "loaded"; pact: Pact } | { kind: "not-found" } | { kind: "failed" };

const STAGE_CHIPS: Record<Pact["stage"], { label: string; className: string }> = {
  active: { label: "Active", className: "c-kept" },
};

export function PactPage({ pactId, onLoaded }: { pactId: string; onLoaded: (pactId: string, name: string) => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    api.pact(pactId).then(
      (result) => {
        if (!result.ok) return setState({ kind: "not-found" });
        setState({ kind: "loaded", pact: result.pact });
        onLoaded(pactId, result.pact.name);
      },
      () => setState({ kind: "failed" }),
    );
  }, [pactId, onLoaded]);

  switch (state.kind) {
    case "loading":
      return null;
    case "not-found":
      return <Empty title="Pact not found" body="It isn't one of your pacts." />;
    case "failed":
      return <Empty title="This pact couldn't load" body="Check your connection and reopen Pact." />;
    case "loaded":
      return <Terms pact={state.pact} />;
  }
}

function Terms({ pact }: { pact: Pact }) {
  const chip = STAGE_CHIPS[pact.stage];
  return (
    <>
      <div className="row2">
        <span className={`chip ${chip.className}`}>{chip.label}</span>
        <span className="muted">{pact.description}</span>
      </div>
      <section className="card">
        <h3>Terms</h3>
        <TermsList terms={pact} />
      </section>
    </>
  );
}

/** A pact's terms as a list. The create form's Check step shows the same list before the pact exists. */
export function TermsList({
  terms,
}: {
  terms: Pick<Pact, "evidenceKind" | "schedule" | "penaltyCents" | "recipient"> & { reviewers: { name: string }[] };
}) {
  const { recipient, reviewers } = terms;
  return (
    <dl className="kv">
      <dt>Evidence</dt>
      <dd>{terms.evidenceKind === "camera" ? "Camera photo, checked by a reviewer" : "Oura Ring"}</dd>
      <dt>Schedule</dt>
      <dd>{scheduleText(terms.schedule)}</dd>
      <dt>Penalty</dt>
      <dd>{money(terms.penaltyCents)} per miss</dd>
      <dt>Recipient</dt>
      <dd>
        {recipient.kind === "organization" ? (
          <a href={recipient.link} target="_blank" rel="noopener noreferrer">
            {recipient.name}
          </a>
        ) : (
          recipient.name
        )}
      </dd>
      <dt>{reviewers.length === 1 ? "Reviewer" : "Reviewers"}</dt>
      <dd>{reviewers.map((r) => r.name).join(", ")}</dd>
    </dl>
  );
}
