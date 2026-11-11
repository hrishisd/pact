// A pact's page, pushed on the current tab: its terms, Edit and Delete in
// its edit window; after it File excuse, Request change and End pact (or,
// while a change request waits, word of it); when new terms start; and
// what's waiting on a reviewer; and its History, a heat map of its days.
// After the edit window the name, the reminders and added reviewers change
// right here, with no review, even while a change request waits.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Json } from "../shared/api.ts";
import { termsOf } from "../shared/terms.ts";
import {
  MAX_NAME_CHARS,
  MAX_TEXT_CHARS,
  type ChangePactRefusal,
  type PactChange,
  type PactTerms,
  type PactWaitingItem,
} from "../shared/types.ts";
import { api, failureText, TEXT_TOO_LONG_TEXT } from "./api.ts";
import { OuraConnectionAlert } from "./oura.tsx";
import { AnkiConnectionAlert, AnkiDeckMissing } from "./anki.tsx";
import { datesText } from "./excuse-days.tsx";
import { ExcuseSheet } from "./ExcuseSheet.tsx";
import { HeatMap } from "./history.tsx";
import { listNames, openOccurrenceText } from "./change-terms.tsx";
import { formOf } from "./pact-form.ts";
import { PROBLEMS, ReviewersStep } from "./pact-form-steps.tsx";
import { clockText, formatDate, formatDay, minutesLeft, money } from "./format.ts";
import { WaitingRow } from "./item-page.tsx";
import { TermsList } from "./terms-list.tsx";
import { REMINDER_PROBLEMS, RemindersStep } from "./reminders-step.tsx";
import { LoadedFound, Sheet, loadFailure, loadedData, useLoad, useNow, useSend } from "./ui.tsx";

type Pact = Json<PactTerms>;

const STAGE_CHIPS: Record<Pact["stage"], { label: string; className: string }> = {
  active: { label: "Active", className: "c-ok" },
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
  onInvite,
}: {
  pactId: string;
  /** The profile's timezone, for when it Ended, when its days are due and when AnkiWeb was checked. */
  timezone: string;
  onLoaded: (pactId: string, name: string) => void;
  onEdit: () => void;
  onDeleted: () => void;
  onRequestChange: () => void;
  onOpenExcuse: (excuseId: string) => void;
  onOpenChangeRequest: (changeRequestId: string) => void;
  onInvite: () => void;
}) {
  // Reloaded after a change made here, keeping the pact shown meanwhile and if the reload fails.
  const { state, reload } = useLoad(() => api.pact(pactId));
  const result = loadedData(state);
  // One clock for the page: the edit window's countdown, what it allows, and the heat map's today.
  const now = useNow();

  useEffect(() => {
    if (result?.ok) onLoaded(pactId, result.pact.name);
  }, [result, pactId, onLoaded]);

  return (
    <LoadedFound
      state={state}
      what="This pact"
      notFound={{ title: "Pact not found", body: "It isn't one of your pacts." }}
    >
      {({ pact }) => {
        const minutes = minutesLeft(pact.editWindowClosesAt, now);
        // After the edit window, until the pact Ends: File excuse, Request change, End pact and the terms' own Change.
        const changeable = minutes === null && pact.stage === "active";
        const waiting = changeWaiting(pact);
        return (
          <>
            {pact.connectionProblem &&
              (pact.evidenceKind === "anki" ? (
                <AnkiConnectionAlert status={pact.connectionProblem} onReconnected={reload} />
              ) : (
                <OuraConnectionAlert status={pact.connectionProblem} />
              ))}
            {pact.stage === "active" && pact.evidenceKind === "anki" && pact.anki.deckMissing && (
              <AnkiDeckMissing deckName={pact.anki.deckName} />
            )}
            <EditWindowBar pact={pact} minutes={minutes} onEdit={onEdit} onDeleted={onDeleted} />
            <StageLine pact={pact} />
            <NewTerms pact={pact} />
            {changeable && (
              <Actions
                pact={pact}
                changeWaiting={waiting}
                timezone={timezone}
                onFiled={reload}
                onRequestChange={onRequestChange}
              />
            )}
            {pact.waiting.length > 0 && (
              <WaitingOn items={pact.waiting} onOpenExcuse={onOpenExcuse} onOpenChangeRequest={onOpenChangeRequest} />
            )}
            <HeatMap pact={pact} timezone={timezone} now={now} />
            <Terms pact={pact} changeable={changeable} changeWaiting={waiting} onSaved={reload} onInvite={onInvite} />
            {changeable && !waiting && <EndPact pact={pact} onSent={reload} />}
            {pact.stage === "ended" && (
              <p className="small muted">
                Ended {formatDay(pact.endedAt, timezone)}. It makes no more days. Penalties already judged stay on the
                ledger.
              </p>
            )}
          </>
        );
      }}
    </LoadedFound>
  );
}

/**
 * The blue bar on a pact in its edit window, with `minutes` left in it. It
 * and any open sheet go away when the window closes.
 */
function EditWindowBar({
  pact,
  minutes,
  onEdit,
  onDeleted,
}: {
  pact: Pact;
  minutes: number | null;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const {
    busy,
    error,
    run: remove,
  } = useSend(
    async () => {
      const result = await api.deletePact(pact.id);
      if (!result.ok)
        return result.reason === "edit-window-closed" ? "The 10 minutes are up." : "This pact wasn't found.";
      onDeleted();
    },
    (failure) => `Couldn't delete it. ${failureText(failure, "Check your connection and try again.")}`,
    // Deleted goes Back, which lands a moment later: the button stays disabled till then.
    { leavesScreen: true },
  );

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
            <button className="btn danger block" disabled={busy} onClick={() => remove()}>
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
        {pact.evidenceKind === "oura"
          ? `In bed by ${clockText(pact.inBedBy)}, judged from your ring`
          : pact.description}
      </span>
    </div>
  );
}

/** "New terms start Fri Jan 9. Today keeps $5 per miss.", while a change in force hasn't started. */
function NewTerms({ pact }: { pact: Pact }) {
  if (pact.newTerms === null) return null;
  const { appliesFrom, todayKeepsCents } = pact.newTerms;
  return (
    <div className="alert ok" role="status">
      <p>
        <b>New terms start {formatDate(appliesFrom)}.</b>
        {todayKeepsCents !== null && ` ${openOccurrenceText(pact.schedule)} keeps ${money(todayKeepsCents)} per miss.`}
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
function Actions({
  pact,
  changeWaiting: waiting,
  timezone,
  onFiled,
  onRequestChange,
}: {
  pact: Pact;
  changeWaiting: boolean;
  timezone: string;
  onFiled: () => void;
  onRequestChange: () => void;
}) {
  const [filing, setFiling] = useState(false);
  const close = useCallback(() => setFiling(false), []);
  return (
    <div className="stack-sm">
      {waiting && (
        <p className="small muted">
          Request change is back once{" "}
          {listNames(
            pact.reviewers.map((r) => r.name),
            "or",
          )}{" "}
          decides the change below, or you withdraw it. Until then you can still change the name and reminders, or add a
          reviewer, under Terms.
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
          timezone={timezone}
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
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const {
    busy,
    error,
    run: send,
  } = useSend(
    async () => {
      const result = await api.endPact(pact.id, note.trim() === "" ? {} : { note });
      if (!result.ok) {
        if (result.reason === "text-too-long") return TEXT_TOO_LONG_TEXT;
        return result.reason === "change-request-waiting"
          ? "A change request is already waiting. Withdraw it first."
          : "This pact can't be ended now. Reopen it to see where it stands.";
      }
      setAsking(false);
      onSent();
    },
    (failure) => `Couldn't send it. ${failureText(failure, "Check your connection and try again.")}`,
  );
  const names = pact.reviewers.map((r) => r.name);
  const approval = names.length === 1 ? `${names[0]}'s approval` : `approval from ${listNames(names, "or")}`;

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
              maxLength={MAX_TEXT_CHARS}
              value={note}
              placeholder="e.g. I've moved and the gym is too far"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="stack">
            <button className="btn danger block" disabled={busy} onClick={() => send()}>
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
        {items.map((item) => {
          switch (item.kind) {
            case "change-request":
              return (
                <WaitingRow
                  key={item.id}
                  kind="change-request"
                  title={item.name}
                  detail={item.endsPact ? "End this pact" : undefined}
                  onOpen={() => onOpenChangeRequest(item.id)}
                />
              );
            case "excuse":
              return (
                <WaitingRow
                  key={item.id}
                  kind="excuse"
                  title={item.name}
                  detail={datesText(item.firstDate, item.lastDate)}
                  onOpen={() => onOpenExcuse(item.id)}
                />
              );
            case "evidence":
              return (
                <WaitingRow key={item.id} kind="evidence" title={item.name} detail={formatDate(item.occurrenceDate)} />
              );
          }
        })}
      </div>
    </section>
  );
}

/**
 * The pact's terms. Once the edit window has closed (`changeable`), Change
 * on the name and the reminders and Add on the reviewers: changes that apply
 * at once. In the edit window, Edit covers them.
 */
function Terms({
  pact,
  changeable,
  changeWaiting,
  onSaved,
  onInvite,
}: {
  pact: Pact;
  changeable: boolean;
  changeWaiting: boolean;
  onSaved: () => void;
  onInvite: () => void;
}) {
  const [changing, setChanging] = useState<"name" | "reviewers" | "reminders" | null>(null);
  const close = useCallback(() => setChanging(null), []);
  const saved = () => {
    setChanging(null);
    onSaved();
  };
  return (
    <section className="card">
      <h3>Terms</h3>
      <TermsList
        terms={pact}
        deckName={pact.evidenceKind === "anki" ? pact.anki.deckName : undefined}
        name={pact.name}
        onRename={changeable ? () => setChanging("name") : undefined}
        onAddReviewer={changeable ? () => setChanging("reviewers") : undefined}
        onChangeReminders={changeable ? () => setChanging("reminders") : undefined}
      />
      {changing === "name" && <NameSheet pact={pact} onClose={close} onSaved={saved} />}
      {changing === "reviewers" && (
        <AddReviewerSheet
          pact={pact}
          changeWaiting={changeWaiting}
          onClose={close}
          onSaved={saved}
          onInvite={onInvite}
        />
      )}
      {changing === "reminders" && <RemindersSheet pact={pact} onClose={close} onSaved={saved} />}
    </section>
  );
}

/** A change that applies at once: the terms a sheet changes. */
type AtOnceChange = Partial<Pick<PactChange, "name" | "reviewerIds" | "reminders">>;

/**
 * Sends a change that applies at once from a sheet: the pact's terms as they
 * stand, with `run(change)`'s in place of their own, then `onSaved`.
 * `refusals` words the refusals the sheet expects; any other, and a failure,
 * start with `couldnt` ("Couldn't save it."). With `unchangedSaves`, a change
 * that changes nothing counts as saved. The name and reviewer sheets use the
 * create form's PROBLEMS.
 */
function useChangeAtOnce(
  pact: Pact,
  {
    refusals,
    couldnt,
    unchangedSaves,
    onSaved,
  }: {
    refusals: Partial<Record<ChangePactRefusal, string>>;
    couldnt: string;
    unchangedSaves: boolean;
    onSaved: () => void;
  },
) {
  return useSend(
    async (change: AtOnceChange) => {
      const result = await api.changePact(pact.id, { ...termsOf(pact), ...change });
      if (!result.ok && !(unchangedSaves && result.reason === "nothing-changed")) {
        return refusals[result.reason] ?? `${couldnt} Reopen the pact and try again.`;
      }
      onSaved();
    },
    (cause) => `${couldnt} ${failureText(cause, "Check your connection and try again.")}`,
  );
}

/** The reminders step's words for its refusals; the reminders sheet has its own for the rest. */
const REMINDERS_PROBLEMS: Partial<Record<ChangePactRefusal, string>> = REMINDER_PROBLEMS;

function NameSheet({ pact, onClose, onSaved }: { pact: Pact; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(pact.name);
  const {
    busy: saving,
    error,
    run: save,
  } = useChangeAtOnce(pact, {
    refusals: PROBLEMS,
    couldnt: "Couldn't save it.",
    unchangedSaves: true,
    onSaved,
  });

  return (
    <Sheet title="Name" closeLabel="Cancel" onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input
          className="inp"
          maxLength={MAX_NAME_CHARS}
          value={name}
          placeholder={pact.evidenceKind === "oura" ? "e.g. In bed by midnight" : "e.g. Gym"}
          onChange={(e) => setName(e.target.value)}
        />
        <small>Shown on Today. A new name applies at once, with no approval.</small>
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary block" disabled={saving} onClick={() => save({ name: name.trim() })}>
        Save name
      </button>
    </Sheet>
  );
}

/**
 * Add a reviewer: the owner's friends who don't review the pact yet. Adding
 * applies at once; removing one is a change request, so it's left to
 * Request change.
 */
function AddReviewerSheet({
  pact,
  changeWaiting,
  onClose,
  onSaved,
  onInvite,
}: {
  pact: Pact;
  changeWaiting: boolean;
  onClose: () => void;
  onSaved: () => void;
  onInvite: () => void;
}) {
  const { state: friendsLoad, reload: loadFriends } = useLoad(api.friends);
  const friends = loadedData(friendsLoad);
  const failed = loadFailure(friendsLoad);
  const [picked, setPicked] = useState<string[]>([]);

  const current = pact.reviewers.map((r) => r.id);
  const others = friends?.filter((f) => !current.includes(f.id)) ?? null;
  const reviewerNames = pact.reviewers.map((r) => r.name);
  const pickedNames = (others ?? []).filter((f) => picked.includes(f.id)).map((f) => f.name);

  // Add stays off until someone is picked, so the change always changes something.
  const {
    busy: saving,
    error,
    run: save,
  } = useChangeAtOnce(pact, {
    refusals: PROBLEMS,
    couldnt: "Couldn't add them.",
    unchangedSaves: false,
    onSaved,
  });

  let body: ReactNode = null;
  if (others === null && failed) {
    body = (
      <>
        <p className="error">
          Your friends couldn't load. {failureText(failed.error, "Check your connection and try again.")}
        </p>
        <button className="btn block" onClick={loadFriends}>
          Try again
        </button>
      </>
    );
  } else if (others !== null && others.length === 0) {
    body = (
      <>
        <p className="muted">
          {listNames(reviewerNames)} already {reviewerNames.length === 1 ? "reviews" : "review"} {pact.name}. Only
          friends can review your pacts. Invite another, and they show up here once they accept.
        </p>
        <div className="row2">
          <button className="btn primary" onClick={onInvite}>
            Invite a friend
          </button>
          <button className="btn" onClick={loadFriends}>
            Check again
          </button>
        </div>
      </>
    );
  } else if (others !== null) {
    const hint = changeWaiting
      ? "Applies at once, with no approval, and they're told. They can decide the change waiting too."
      : "Applies at once, with no approval, and they're told.";
    body = (
      <>
        <div className="stack step-in-sheet">
          <ReviewersStep
            friends={others}
            reviewerIds={picked}
            onReviewerIds={setPicked}
            kind={pact.evidenceKind}
            hint={hint}
            onInvite={onInvite}
            onCheckAgain={loadFriends}
          />
        </div>
        {error && <p className="error">{error}</p>}
        <button
          className="btn primary block"
          disabled={saving || picked.length === 0}
          onClick={() => save({ reviewerIds: [...current, ...picked] })}
        >
          {picked.length === 0 ? "Add reviewer" : `Add ${listNames(pickedNames)}`}
        </button>
      </>
    );
  }

  return (
    <Sheet title="Add a reviewer" closeLabel="Cancel" onClose={onClose}>
      {body}
    </Sheet>
  );
}

function RemindersSheet({ pact, onClose, onSaved }: { pact: Pact; onClose: () => void; onSaved: () => void }) {
  const [reminders, setReminders] = useState(pact.reminders);
  const {
    busy: saving,
    error,
    setError,
    run: send,
  } = useChangeAtOnce(pact, {
    refusals: REMINDERS_PROBLEMS,
    couldnt: "Couldn't save them.",
    unchangedSaves: true,
    onSaved,
  });

  const save = () => {
    if (reminders.includes("")) return setError(REMINDER_PROBLEMS["invalid-reminders"]);
    send({ reminders });
  };

  return (
    <Sheet title="Reminders" closeLabel="Cancel" onClose={onClose}>
      <div className="stack step-in-sheet">
        <RemindersStep
          form={{ ...formOf(pact), reminders }}
          onReminders={setReminders}
          hint="Changes apply at once, with no approval."
        />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn primary block" disabled={saving} onClick={save}>
        Save reminders
      </button>
    </Sheet>
  );
}
