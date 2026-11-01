// A pact's page, pushed on the current tab: its terms, and Edit and Delete in
// its edit window. History and other actions come later.

import { useEffect, useState } from "react";
import type { Json } from "../shared/api.ts";
import type { PactTerms } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { minutesLeft, money, scheduleText } from "./format.ts";
import { Empty, Sheet, useNow } from "./ui.tsx";

type Pact = Json<PactTerms>;

type State =
  { kind: "loading" } | { kind: "loaded"; pact: Pact } | { kind: "not-found" } | { kind: "failed"; error: unknown };

const STAGE_CHIPS: Record<Pact["stage"], { label: string; className: string }> = {
  active: { label: "Active", className: "c-kept" },
};

export function PactPage({
  pactId,
  onLoaded,
  onEdit,
  onDeleted,
}: {
  pactId: string;
  onLoaded: (pactId: string, name: string) => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    api.pact(pactId).then(
      (result) => {
        if (!result.ok) return setState({ kind: "not-found" });
        setState({ kind: "loaded", pact: result.pact });
        onLoaded(pactId, result.pact.name);
      },
      (error: unknown) => setState({ kind: "failed", error }),
    );
  }, [pactId, onLoaded]);

  switch (state.kind) {
    case "loading":
      return null;
    case "not-found":
      return <Empty title="Pact not found" body="It isn't one of your pacts." />;
    case "failed":
      return (
        <Empty
          title="This pact couldn't load"
          body={failureText(state.error, "Check your connection and reopen Pact.")}
        />
      );
    case "loaded":
      return (
        <>
          <EditWindowBar pact={state.pact} onEdit={onEdit} onDeleted={onDeleted} />
          <Terms pact={state.pact} />
        </>
      );
  }
}

/** The blue bar on a pact in its edit window. It and any open sheet go away when the window closes. */
function EditWindowBar({ pact, onEdit, onDeleted }: { pact: Pact; onEdit: () => void; onDeleted: () => void }) {
  const now = useNow();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minutes = minutesLeft(pact.editWindowClosesAt, now);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.deletePact(pact.id);
      if (result.ok) return onDeleted();
      setError(result.reason === "edit-window-closed" ? "The 10 minutes are up." : "This pact wasn't found.");
    } catch (failure) {
      setError(`Couldn't delete it. ${failureText(failure, "Check your connection and try again.")}`);
    } finally {
      setBusy(false);
    }
  };

  if (minutes === null) return error ? <p className="error">{error}</p> : null;
  return (
    <div className="alert fresh" role="status">
      <b>
        Feel free to edit or delete for {minutes} more {minutes === 1 ? "minute" : "minutes"}.
      </b>
      <div className="row2">
        <button className="btn sm" onClick={onEdit}>
          Edit
        </button>
        <button className="btn sm danger" onClick={() => setAsking(true)}>
          Delete
        </button>
      </div>
      {asking && (
        <Sheet title={`Delete ${pact.name}?`} onClose={() => setAsking(false)}>
          <p>This action can't be undone.</p>
          {error && <p className="error">{error}</p>}
          <div className="stack">
            <button className="btn danger block" disabled={busy} onClick={() => void remove()}>
              {busy ? "Deleting…" : "Delete pact"}
            </button>
            <button className="btn block" onClick={() => setAsking(false)}>
              Keep it
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
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
      <dd>{recipient.name}</dd>
      <dt>{reviewers.length === 1 ? "Reviewer" : "Reviewers"}</dt>
      <dd>{reviewers.map((r) => r.name).join(", ")}</dd>
    </dl>
  );
}
