// A pact's page, pushed on the current tab: its terms, Edit and Delete in
// its edit window; after it File excuse, Request change and End pact (or,
// while a change request waits, word of it); when new terms start; and
// what's waiting on a reviewer; and its History, a heat map of its days.
// After the edit window the reminders change right here, with no review,
// even while a change request waits.

import { useCallback, useEffect, useState } from "react";
import type { Json } from "../shared/api.ts";
import type { PactChange, PactTerms, PactWaitingItem } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { datesText } from "./excuse-days.tsx";
import { ExcuseSheet } from "./ExcuseSheet.tsx";
import { HeatMap } from "./history.tsx";
import { listNames } from "./change-terms.tsx";
import { clockText, formatDate, formatDay, minutesLeft, money, remindersText, scheduleText } from "./format.ts";
import { CameraIcon, ExcuseIcon, PencilIcon } from "./icons.tsx";
import { REMINDER_PROBLEMS, RemindersStep } from "./reminders-step.tsx";
import { Empty, Sheet, useNow } from "./ui.tsx";

type Pact = Json<PactTerms>;

type State =
  { kind: "loading" } | { kind: "loaded"; pact: Pact } | { kind: "not-found" } | { kind: "failed"; error: unknown };

const STAGE_CHIPS: Record<Pact["stage"], { label: string; className: string }> = {
  active: { label: "Active", className: "c-kept" },
  ended: { label: "Ended", className: "c-ended" },
};

export function PactPage({
  pactId,
  timezone,
  onLoaded,
  onEdit,
  onDeleted,
  onRequestChange,
  onOpenExcuse,
  onOpenChangeRequest,
}: {
  pactId: string;
  /** The profile's timezone, for when it Ended. */
  timezone: string;
  onLoaded: (pactId: string, name: string) => void;
  onEdit: () => void;
  onDeleted: () => void;
  onRequestChange: () => void;
  onOpenExcuse: (excuseId: string) => void;
  onOpenChangeRequest: (changeRequestId: string) => void;
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
          <NewTerms pact={state.pact} />
          <Actions pact={state.pact} onFiled={load} onRequestChange={onRequestChange} />
          {state.pact.waiting.length > 0 && (
            <WaitingOn
              items={state.pact.waiting}
              onOpenExcuse={onOpenExcuse}
              onOpenChangeRequest={onOpenChangeRequest}
            />
          )}
          <History pact={state.pact} />
          <Terms pact={state.pact} onSaved={load} />
          <EndPact pact={state.pact} onSent={load} />
          {state.pact.endedAt !== null && (
            <p className="small muted">
              Ended {formatDay(state.pact.endedAt, timezone)}. It makes no more days. Penalties already judged stay on
              the ledger.
            </p>
          )}
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
      <span className="muted">
        {pact.inBedBy === null ? pact.description : `In bed by ${clockText(pact.inBedBy)}, judged from your ring`}
      </span>
    </div>
  );
}

/** "New terms start Fri Jan 9. Today keeps $5 per miss.", while a change in force hasn't started. */
function NewTerms({ pact }: { pact: Pact }) {
  if (pact.newTerms === null) return null;
  const { startsOn, todayKeepsCents } = pact.newTerms;
  return (
    <div className="alert ok" role="status">
      <p>
        <b>New terms start {formatDate(startsOn)}.</b>
        {todayKeepsCents !== null && ` Today keeps ${money(todayKeepsCents)} per miss.`}
      </p>
    </div>
  );
}

/** Whether a change request of the pact's waits for a reviewer. */
function changeWaiting(pact: Pact): boolean {
  return pact.waiting.some((item) => item.kind === "change-request");
}

/**
 * File excuse and Request change, once the edit window has closed. The
 * excuse sheet asks which day. While a change request waits, Request change
 * gives way to word of it.
 */
function Actions({ pact, onFiled, onRequestChange }: { pact: Pact; onFiled: () => void; onRequestChange: () => void }) {
  const now = useNow();
  const [filing, setFiling] = useState(false);
  const close = useCallback(() => setFiling(false), []);
  if (minutesLeft(pact.editWindowClosesAt, now) !== null || pact.stage === "ended") return null;
  const waiting = changeWaiting(pact);
  return (
    <div className="stack-sm">
      {waiting && (
        <p className="small muted">
          Request change is back once{" "}
          {listNames(
            pact.reviewers.map((r) => r.name),
            "or",
          )}{" "}
          decides the change below, or you withdraw it.
        </p>
      )}
      <div className="row2">
        <button className="btn" onClick={() => setFiling(true)}>
          File excuse
        </button>
        {!waiting && (
          <button className="btn" onClick={onRequestChange}>
            Request change
          </button>
        )}
      </div>
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
 * End pact, at the bottom of the page after the edit window, with its sheet.
 * Ending is a change request, so it's gone while one waits.
 */
function EndPact({ pact, onSent }: { pact: Pact; onSent: () => void }) {
  const now = useNow();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (minutesLeft(pact.editWindowClosesAt, now) !== null || pact.stage === "ended" || changeWaiting(pact)) {
    return null;
  }
  const names = pact.reviewers.map((r) => r.name);
  const approval = names.length === 1 ? `${names[0]}'s approval` : `approval from ${listNames(names, "or")}`;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.endPact(pact.id, note.trim() === "" ? {} : { note });
      if (result.ok) {
        setAsking(false);
        return onSent();
      }
      setError(
        result.reason === "change-request-waiting"
          ? "A change request is already waiting. Withdraw it first."
          : "This pact can't be ended now. Reopen it to see where it stands.",
      );
    } catch (failure) {
      setError(`Couldn't send it. ${failureText(failure, "Check your connection and try again.")}`);
    }
    setBusy(false);
  };

  return (
    <>
      <button className="btn danger self-start" onClick={() => setAsking(true)}>
        End pact
      </button>
      {asking && (
        <Sheet title={`End ${pact.name}?`} onClose={() => setAsking(false)}>
          <p>
            Ending needs {approval}. Until then {pact.name} keeps running. Days already judged stay on your ledger.
          </p>
          <label className="field">
            <span>Why? (optional)</span>
            <textarea
              className="inp"
              value={note}
              placeholder="e.g. I've moved and the gym is too far"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="stack">
            <button className="btn danger block" disabled={busy} onClick={() => void send()}>
              Send to {listNames(names)}
            </button>
            <button className="btn block" onClick={() => setAsking(false)}>
              Keep it
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

/**
 * The pact's change request, evidence and excuses waiting for a reviewer,
 * like Today's Waiting for approval rows. A change request or an excuse
 * opens its page; evidence has no page.
 */
function WaitingOn({
  items,
  onOpenExcuse,
  onOpenChangeRequest,
}: {
  items: Json<PactWaitingItem>[];
  onOpenExcuse: (excuseId: string) => void;
  onOpenChangeRequest: (changeRequestId: string) => void;
}) {
  return (
    <section className="stack">
      <div className="label">Waiting on</div>
      <div className="cards">
        {items.map((item) =>
          item.kind === "change-request" ? (
            <button key={item.id} className="rowbtn" onClick={() => onOpenChangeRequest(item.id)}>
              <span className="kico k-change">
                <PencilIcon />
              </span>
              <span className="rt">
                <b>{item.name}</b>
                <small>{item.endsPact ? "Change · End this pact" : "Change"}</small>
              </span>
            </button>
          ) : item.kind === "excuse" ? (
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

function History({ pact }: { pact: Pact }) {
  const now = useNow();
  return <HeatMap pact={pact} now={now} />;
}

function Terms({ pact, onSaved }: { pact: Pact; onSaved: () => void }) {
  const now = useNow();
  const [changing, setChanging] = useState(false);
  // In the edit window, Edit covers them.
  const changeable = pact.stage === "active" && minutesLeft(pact.editWindowClosesAt, now) === null;
  return (
    <section className="card">
      <h3>Terms</h3>
      <TermsList terms={pact} onChangeReminders={changeable ? () => setChanging(true) : undefined} />
      {changing && (
        <RemindersSheet
          pact={pact}
          onClose={() => setChanging(false)}
          onSaved={() => {
            setChanging(false);
            onSaved();
          }}
        />
      )}
    </section>
  );
}

/** The pact's terms as they stand, with `reminders` instead of its own: a change that applies at once. */
function withReminders(pact: Pact, reminders: string[]): PactChange {
  return {
    name: pact.name,
    description: pact.description,
    ...(pact.inBedBy !== null && { inBedBy: pact.inBedBy }),
    ...(pact.dueBy !== null && { dueBy: pact.dueBy }),
    ...(pact.startDate !== null && { startDate: pact.startDate }),
    ...(pact.endDate !== null && { endDate: pact.endDate }),
    schedule: pact.schedule,
    penaltyCents: pact.penaltyCents,
    recipientId: pact.recipient.id,
    reviewerIds: pact.reviewers.map((r) => r.id),
    reminders,
  };
}

function RemindersSheet({ pact, onClose, onSaved }: { pact: Pact; onClose: () => void; onSaved: () => void }) {
  const [reminders, setReminders] = useState(pact.reminders);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = {
    kind: pact.evidenceKind,
    inBedBy: pact.inBedBy ?? "",
    dueByOn: pact.dueBy !== null,
    dueBy: pact.dueBy ?? "",
    reminders,
  };

  const save = async () => {
    if (reminders.includes("")) return setError(REMINDER_PROBLEMS["invalid-reminders"]);
    setSaving(true);
    setError(null);
    try {
      const result = await api.changePact(pact.id, withReminders(pact, reminders));
      if (result.ok || result.reason === "nothing-changed") return onSaved();
      setError(
        result.reason in REMINDER_PROBLEMS
          ? REMINDER_PROBLEMS[result.reason as keyof typeof REMINDER_PROBLEMS]
          : "Couldn't save them. Reopen the pact and try again.",
      );
    } catch (cause) {
      setError(`Couldn't save them. ${failureText(cause, "Check your connection and try again.")}`);
    }
    setSaving(false);
  };

  return (
    <Sheet title="Reminders" closeLabel="Cancel" onClose={onClose}>
      <div className="stack step-in-sheet">
        <RemindersStep form={form} onReminders={setReminders} hint="Changes apply at once, with no approval." />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn primary block" disabled={saving} onClick={() => void save()}>
        Save reminders
      </button>
    </Sheet>
  );
}

/** A pact's terms as a list. The create form's Check step shows the same list before the pact exists. */
export function TermsList({
  terms,
  onChangeReminders,
}: {
  terms: Pick<
    Pact,
    | "evidenceKind"
    | "inBedBy"
    | "dueBy"
    | "startDate"
    | "endDate"
    | "schedule"
    | "penaltyCents"
    | "recipient"
    | "reminders"
  > & {
    reviewers: { name: string }[];
  };
  /** Offers Change on the reminders, when they can change on their own. */
  onChangeReminders?: () => void;
}) {
  const { recipient, reviewers } = terms;
  return (
    <dl className="kv">
      <dt>Evidence</dt>
      <dd>{terms.evidenceKind === "camera" ? "Camera photo, checked by a reviewer" : "Oura Ring"}</dd>
      {terms.inBedBy !== null && (
        <>
          <dt>In bed by</dt>
          <dd>{clockText(terms.inBedBy)}</dd>
        </>
      )}
      <dt>Schedule</dt>
      <dd>{scheduleText(terms.schedule)}</dd>
      {terms.dueBy !== null && (
        <>
          <dt>Due by</dt>
          <dd>{clockText(terms.dueBy)}</dd>
        </>
      )}
      {terms.startDate !== null && (
        <>
          <dt>Starts</dt>
          <dd>{formatDate(terms.startDate)}</dd>
        </>
      )}
      {terms.endDate !== null && (
        <>
          <dt>Ends</dt>
          <dd>{formatDate(terms.endDate)}</dd>
        </>
      )}
      <dt>Penalty</dt>
      <dd>{money(terms.penaltyCents)} per miss</dd>
      <dt>Recipient</dt>
      <dd>{recipient.name}</dd>
      <dt>{reviewers.length === 1 ? "Reviewer" : "Reviewers"}</dt>
      <dd>{reviewers.map((r) => r.name).join(", ")}</dd>
      <dt>Reminders</dt>
      <dd>
        {remindersText(terms.reminders)}
        {onChangeReminders && (
          <>
            {" "}
            <button className="link" onClick={onChangeReminders}>
              Change
            </button>
          </>
        )}
      </dd>
    </dl>
  );
}
