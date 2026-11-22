// A pact's page, pushed on the current tab: its terms, Edit and Delete in
// its edit window; after it File excuse, Request change and End pact (or,
// while a change request waits, word of it; while an approved end waits,
// neither, and word of the end); when new terms start; and
// what's waiting on a reviewer; and its History, a heat map of its days.
// After the edit window the name, the reminders and added reviewers change
// right here, with no review, even while a change request waits.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { API_PATHS, type Json } from "../shared/api.ts";
import {
  MAX_NAME_CHARS,
  MAX_TEXT_CHARS,
  type AddReviewersResult,
  type PactTerms,
  type PactWaitingItem,
  type Refusal,
  type RenamePactResult,
  type SetRemindersResult,
} from "../shared/types.ts";
import { api, failureText, TEXT_TOO_LONG_TEXT } from "./api.ts";
import { OuraConnectionAlert } from "./oura.tsx";
import { AnkiConnectionAlert, AnkiDeckMissing } from "./anki.tsx";
import { ExcuseSheet } from "./ExcuseSheet.tsx";
import { HeatMap } from "./history.tsx";
import { AT_ONCE_REFUSAL_TEXT, endsWhenText, openOccurrenceText } from "./change-terms.tsx";
import { formOf } from "./pact-form.ts";
import { PROBLEMS, ReviewersStep } from "./pact-form-steps.tsx";
import { clockText, EDIT_WINDOW_TEXT, formatDate, formatDay, listNames, minutesLeft, money } from "./format.ts";
import { openItem, WaitingItemRow, type ItemOpeners } from "./item-page.tsx";
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
  openers,
  onInvite,
}: {
  pactId: string;
  /** The profile's timezone, for when it Ended, when its days are due and when AnkiWeb was checked. */
  timezone: string;
  onLoaded: (pactId: string, name: string) => void;
  onEdit: () => void;
  onDeleted: () => void;
  onRequestChange: () => void;
  /** Each kind's own page: a waiting row opens its item's. */
  openers: ItemOpeners;
  onInvite: () => void;
}) {
  // Opened again, it starts from the pact as last loaded while it loads afresh. Reloaded after a change made
  // here, keeping the pact shown meanwhile and if the reload fails. The at-once changes send only their own term.
  const { state, reload } = useLoad(() => api.pact(pactId), API_PATHS.pact(pactId));
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
              <WaitingOn items={pact.waiting} onOpenItem={(item) => openItem(item, openers)} />
            )}
            <HeatMap pact={pact} timezone={timezone} now={now} />
            <Terms pact={pact} changeable={changeable} changeWaiting={waiting} onSaved={reload} onInvite={onInvite} />
            {changeable && !waiting && pact.ending === null && <EndPact pact={pact} onSent={reload} />}
            {pact.ending && (
              <p className="small muted">
                Ending approved. The pact ends {endsWhenText(pact, { kind: "after", ...pact.ending })}. You still owe
                penalties for days already missed.
              </p>
            )}
            {pact.stage === "ended" && (
              <p className="small muted">
                This pact ended on {formatDay(pact.endedAt, timezone)}. You still owe penalties for days already missed.
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
        return result.reason === "edit-window-closed"
          ? `The ${EDIT_WINDOW_TEXT} for editing are over. To stop the pact, use End pact.`
          : "This pact wasn't found.";
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
        You can edit or delete this pact for {minutes} more {minutes === 1 ? "minute" : "minutes"}.
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

/** "The new terms start Fri Jan 9. Today's penalty stays $5.", while a change in force hasn't started. */
function NewTerms({ pact }: { pact: Pact }) {
  if (pact.newTerms === null) return null;
  const { appliesFrom, todayKeepsCents } = pact.newTerms;
  return (
    <div className="alert ok" role="status">
      <p>
        <b>The new terms start {formatDate(appliesFrom)}.</b>
        {todayKeepsCents !== null && ` ${openOccurrenceText(pact.schedule)} penalty stays ${money(todayKeepsCents)}.`}
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
 * gives way to word of it. While an approved end waits it's gone, as End pact
 * is: the core refuses all but the at-once changes, which Terms offers.
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
          You can request another change after{" "}
          {listNames(
            pact.reviewers.map((r) => r.name),
            "or",
          )}{" "}
          decides this one or you withdraw it. Until then, you can still change the name and reminders, or add a
          reviewer, under Terms.
        </p>
      )}
      <div className="row2">
        <button className="btn" onClick={() => setFiling(true)}>
          File excuse
        </button>
        {!waiting && pact.ending === null && (
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
 * Ending is a change request, so it's gone while one waits, and once an end
 * is approved.
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
        if (result.reason === "change-request-waiting")
          return "A change request is already waiting. Withdraw it first.";
        return result.reason === "end-approved"
          ? "Ending this pact is already approved. Reopen the pact to see when it ends."
          : "This pact can't be ended now. Reopen the pact to see the latest.";
      }
      setAsking(false);
      onSent();
    },
    (failure) => `Couldn't send it. ${failureText(failure, "Check your connection and try again.")}`,
  );
  const names = pact.reviewers.map((r) => r.name);
  const approver = names.length === 1 ? "Your reviewer" : "One of your reviewers";

  return (
    <>
      <button className="btn danger self-start" onClick={() => setAsking(true)}>
        End pact
      </button>
      {asking && (
        <Sheet title={`End ${pact.name}?`} onClose={() => setAsking(false)}>
          <p>
            {approver} must approve ending the pact. Until then, the pact continues as usual. You still owe penalties
            for days already missed.
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
 * The pact's change request, evidence, excuses and vacations covering it,
 * waiting for a reviewer: the same rows as Today's Waiting for approval, each
 * opening its item's own page.
 */
function WaitingOn({
  items,
  onOpenItem,
}: {
  items: Json<PactWaitingItem>[];
  onOpenItem: (item: Json<PactWaitingItem>) => void;
}) {
  return (
    <section className="stack">
      <div className="label">Waiting on</div>
      <div className="cards">
        {items.map((item) => (
          <WaitingItemRow key={item.id} item={item} onOpen={onOpenItem} />
        ))}
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

/**
 * Sends a change that applies at once from a sheet, which carries only its
 * own term, then `onSaved`. `refusals` words each refusal it can have; a
 * failure starts with `couldnt` ("Couldn't save it.").
 */
function useChangeAtOnce<Args extends unknown[], Reason extends string>(
  send: (...args: Args) => Promise<{ ok: true } | { ok: false; reason: Reason }>,
  { refusals, couldnt, onSaved }: { refusals: Record<Reason, string>; couldnt: string; onSaved: () => void },
) {
  return useSend(
    async (...args: Args) => {
      const result = await send(...args);
      if (!result.ok) return refusals[result.reason];
      onSaved();
    },
    (cause) => `${couldnt} ${failureText(cause, "Check your connection and try again.")}`,
  );
}

const NAME_REFUSALS: Record<Refusal<RenamePactResult>, string> = {
  ...AT_ONCE_REFUSAL_TEXT,
  "blank-name": PROBLEMS["blank-name"],
  "text-too-long": PROBLEMS["text-too-long"],
};

const ADD_REVIEWER_REFUSALS: Record<Refusal<AddReviewersResult>, string> = {
  ...AT_ONCE_REFUSAL_TEXT,
  "not-a-friend": PROBLEMS["not-a-friend"],
};

const REMINDERS_REFUSALS: Record<Refusal<SetRemindersResult>, string> = {
  ...AT_ONCE_REFUSAL_TEXT,
  ...REMINDER_PROBLEMS,
};

function NameSheet({ pact, onClose, onSaved }: { pact: Pact; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(pact.name);
  const {
    busy: saving,
    error,
    run: save,
  } = useChangeAtOnce((newName: string) => api.renamePact(pact.id, newName), {
    refusals: NAME_REFUSALS,
    couldnt: "Couldn't save it.",
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
        <small>A new name applies right away, with no approval.</small>
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary block" disabled={saving} onClick={() => save(name)}>
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

  // Add stays off until someone is picked. Only those picked are sent.
  const {
    busy: saving,
    error,
    run: save,
  } = useChangeAtOnce((reviewerIds: string[]) => api.addReviewers(pact.id, reviewerIds), {
    refusals: ADD_REVIEWER_REFUSALS,
    couldnt: "Couldn't add them.",
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
          {listNames(reviewerNames)} already {reviewerNames.length === 1 ? "reviews" : "review"} this pact. Only friends
          can review your pacts. Invite another friend, and they'll appear here after they accept.
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
      ? "Applies right away, with no approval. Pact tells the new reviewer, who can also decide the change request that's waiting."
      : "Applies right away, with no approval. Pact tells the new reviewer.";
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
        <button className="btn primary block" disabled={saving || picked.length === 0} onClick={() => save(picked)}>
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
  } = useChangeAtOnce((newReminders: string[]) => api.setReminders(pact.id, newReminders), {
    refusals: REMINDERS_REFUSALS,
    couldnt: "Couldn't save them.",
    onSaved,
  });

  const save = () => {
    if (reminders.includes("")) return setError(REMINDER_PROBLEMS["invalid-reminders"]);
    send(reminders);
  };

  return (
    <Sheet title="Reminders" closeLabel="Cancel" onClose={onClose}>
      <div className="stack step-in-sheet">
        <RemindersStep
          form={{ ...formOf(pact), reminders }}
          onReminders={setReminders}
          hint="Changes apply right away without approval."
        />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn primary block" disabled={saving} onClick={save}>
        Save reminders
      </button>
    </Sheet>
  );
}
