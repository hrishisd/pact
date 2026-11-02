// A pact's page, pushed on the current tab: its terms, Edit and Delete in
// its edit window, File excuse after it, and what's waiting on a reviewer.
// History and other actions come later.

import { useCallback, useEffect, useState } from "react";
import type { Json } from "../shared/api.ts";
import type { PactTerms, PactWaitingItem } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { datesText } from "./excuse-days.tsx";
import { ExcuseSheet } from "./ExcuseSheet.tsx";
import { formatDate, minutesLeft, money, scheduleText } from "./format.ts";
import { CameraIcon, ExcuseIcon } from "./icons.tsx";
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
  onOpenExcuse,
}: {
  pactId: string;
  onLoaded: (pactId: string, name: string) => void;
  onEdit: () => void;
  onDeleted: () => void;
  onOpenExcuse: (excuseId: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    api.pact(pactId).then(
      (result) => {
        if (!result.ok) return setState({ kind: "not-found" });
        setState({ kind: "loaded", pact: result.pact });
        onLoaded(pactId, result.pact.name);
      },
      (error: unknown) => setState({ kind: "failed", error }),
    );
  }, [pactId, onLoaded]);
  useEffect(load, [load]);

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
          <StageLine pact={state.pact} />
          <Actions pact={state.pact} onFiled={load} />
          {state.pact.waiting.length > 0 && <WaitingOn items={state.pact.waiting} onOpenExcuse={onOpenExcuse} />}
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

function StageLine({ pact }: { pact: Pact }) {
  const chip = STAGE_CHIPS[pact.stage];
  return (
    <div className="row2">
      <span className={`chip ${chip.className}`}>{chip.label}</span>
      <span className="muted">{pact.description}</span>
    </div>
  );
}

/** File excuse, once the edit window has closed. The sheet asks which day. */
function Actions({ pact, onFiled }: { pact: Pact; onFiled: () => void }) {
  const now = useNow();
  const [filing, setFiling] = useState(false);
  const close = useCallback(() => setFiling(false), []);
  if (minutesLeft(pact.editWindowClosesAt, now) !== null) return null;
  return (
    <div className="row2">
      <button className="btn" onClick={() => setFiling(true)}>
        File excuse
      </button>
      {filing && (
        <ExcuseSheet
          pactId={pact.id}
          pactName={pact.name}
          onClose={close}
          onFiled={() => {
            setFiling(false);
            onFiled();
          }}
        />
      )}
    </div>
  );
}

/**
 * The pact's evidence and excuses waiting for a reviewer, like Today's
 * Waiting for approval rows. An excuse opens its page; evidence has no page.
 */
function WaitingOn({
  items,
  onOpenExcuse,
}: {
  items: Json<PactWaitingItem>[];
  onOpenExcuse: (excuseId: string) => void;
}) {
  return (
    <section className="stack">
      <div className="label">Waiting on</div>
      <div className="cards">
        {items.map((item) =>
          item.kind === "excuse" ? (
            <button key={item.id} className="rowbtn" onClick={() => onOpenExcuse(item.id)}>
              <span className="kico k-excuse">
                <ExcuseIcon />
              </span>
              <span className="rt">
                <b>{item.name}</b>
                <small>Excuse · {datesText(item.firstDate, item.lastDate)}</small>
              </span>
            </button>
          ) : (
            <div key={item.id} className="rowbtn still">
              <span className="kico k-evidence">
                <CameraIcon />
              </span>
              <span className="rt">
                <b>{item.name}</b>
                <small>Evidence · {formatDate(item.occurrenceDate)}</small>
              </span>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function Terms({ pact }: { pact: Pact }) {
  return (
    <section className="card">
      <h3>Terms</h3>
      <TermsList terms={pact} />
    </section>
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
