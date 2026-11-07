// The step-by-step pact form: evidence kind, goal, schedule (Fixed days,
// Weekly count or One-time, with the optional due-by time, and for recurring
// pacts the start date and end date), penalty, reviewers, reminders,
// then a check before Create pact. Picking Oura Ring with no connection adds
// a Connect step, which leaves for Oura's page; Oura's callback brings the
// browser back here (`?oura=connected`) at Goal. Picking Anki with no
// connection adds a Connect AnkiWeb step, which signs in on the spot and goes
// on to Goal, where the owner picks the deck. Editing a pact in its edit
// window reuses the form without the evidence kind step. The core decides
// every rule; the steps only stop the owner moving on with a field left empty.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  MAX_WEEKLY_TARGET,
  WEEKDAYS,
  type AnkiDeck,
  type EditPactRefusal,
  type EvidenceKind,
  type FirstOccurrence,
  type Friend,
  type PactChange,
  type PactTerms,
  type Recipient,
  type Refusal,
  type Schedule,
  type Weekday,
} from "../shared/types.ts";
import { parseDatedReminder } from "../shared/calendar.ts";
import { API_PATHS, type FirstOccurrenceResponse, type Json } from "../shared/api.ts";
import { ouraResultText, takeOuraResult } from "./oura.tsx";
import { AnkiLoginFields, NO_ANKI_LOGIN, signInToAnki, type AnkiLogin } from "./anki.tsx";
import { api, failureText } from "./api.ts";
import { termsOfKind, type Term } from "./change-terms.tsx";
import {
  centsInputText,
  clockText,
  clockTime,
  formatDate,
  inBedByName,
  initial,
  minutesLeft,
  parseCents,
} from "./format.ts";
import { CameraIcon, CardsIcon, RingIcon } from "./icons.tsx";
import { scheduleKindOf, type Form } from "./pact-form.ts";
import { TermsList } from "./PactPage.tsx";
import { REMINDER_PROBLEMS, RemindersStep } from "./reminders-step.tsx";
import { LoadedFound, loadFailure, loadedData, useLoad, useNow, useSend } from "./ui.tsx";

type Step = "kind" | "connect" | "goal" | "schedule" | "penalty" | "reviewers" | "reminders" | "check";
const AFTER_KIND: Step[] = ["goal", "schedule", "penalty", "reviewers", "reminders", "check"];

type Pact = Json<PactTerms>;

/** The schedule step's day buttons: what each shows and its accessible name. */
const DAY_BUTTONS: Record<Weekday, { short: string; full: string }> = {
  mon: { short: "Mo", full: "Monday" },
  tue: { short: "Tu", full: "Tuesday" },
  wed: { short: "We", full: "Wednesday" },
  thu: { short: "Th", full: "Thursday" },
  fri: { short: "Fr", full: "Friday" },
  sat: { short: "Sa", full: "Saturday" },
  sun: { short: "Su", full: "Sunday" },
};

const EMPTY_FORM: Form = {
  kind: "camera",
  inBedBy: "",
  ankiDeckId: null,
  ankiDeckName: "",
  named: false,
  name: "",
  description: "",
  scheduleKind: "fixed-days",
  days: [],
  target: 3,
  deadline: "",
  submitAnytime: false,
  dueByOn: false,
  dueBy: "",
  startDate: "",
  endDate: "",
  penalty: "",
  recipientId: null,
  reviewerIds: [],
  reminders: [],
};

export function formOf(pact: Pact): Form {
  const anki = pact.evidenceKind === "anki" ? pact.anki : null;
  return {
    kind: pact.evidenceKind,
    ...dueTimesForm(pact),
    ankiDeckId: anki?.deckId ?? null,
    ankiDeckName: anki?.deckName ?? "",
    named: true,
    name: pact.name,
    description: pact.description,
    scheduleKind: pact.schedule.kind,
    days: pact.schedule.kind === "fixed-days" ? pact.schedule.days : [],
    target: pact.schedule.kind === "weekly-count" ? pact.schedule.target : EMPTY_FORM.target,
    deadline: pact.schedule.kind === "one-time" ? pact.schedule.deadline : "",
    submitAnytime: pact.schedule.kind === "one-time" && pact.schedule.submitAnytime,
    startDate: pact.startDate ?? "",
    endDate: pact.endDate ?? "",
    penalty: centsInputText(pact.penaltyCents),
    recipientId: pact.recipient.id,
    reviewerIds: pact.reviewers.map((reviewer) => reviewer.id),
    reminders: pact.reminders,
  };
}

/** The form's in-bed-by and due-by fields, as a pact's terms have them. */
function dueTimesForm(terms: Pact): Pick<Form, "inBedBy" | "dueByOn" | "dueBy"> {
  if (terms.evidenceKind === "oura") return { inBedBy: terms.inBedBy, dueByOn: false, dueBy: "" };
  return { inBedBy: "", dueByOn: terms.dueBy !== null, dueBy: terms.dueBy ?? "" };
}

/**
 * What's wrong, in the owner's words: the core's refusals at Create or Save,
 * and the steps' own checks that a field is filled in.
 */
type Problem = EditPactRefusal | "no-deadline" | "no-amount" | "no-recipient" | "anki-due-by";

export const PROBLEMS: Record<Problem, string> = {
  "oura-not-connected": "Connect your Oura Ring first.",
  "anki-not-connected": "Connect AnkiWeb first.",
  "unknown-deck": "Pick a deck.",
  "anki-due-by": "Pick a time from noon until your Anki day ends, or turn off Due by a set time.",
  "invalid-in-bed-by": "Pick a time.",
  "blank-name": "Give it a name.",
  "blank-description": "Say what your photo will show.",
  "no-days": "Pick at least one day.",
  "no-deadline": "Pick a deadline.",
  "deadline-too-soon": "The deadline must be at least an hour after you create the pact. Pick a later one.",
  "invalid-schedule": `Pick from 1 to ${MAX_WEEKLY_TARGET} days a week.`,
  "invalid-due-by": "Pick a time before midnight, or turn off Due by a set time.",
  "invalid-start-date": "Pick a start date, or clear it.",
  "invalid-end-date": "Pick an end date, or clear it.",
  "end-date-too-early": "The end date is before the first day. Pick a later one.",
  ...REMINDER_PROBLEMS,
  "no-amount": "Enter an amount, like 5 or 2.50.",
  "invalid-penalty": "Set a penalty above $0.",
  "no-recipient": "Pick a recipient.",
  "unknown-recipient": "That recipient isn't on your list. Pick another.",
  "no-reviewers": "Pick at least one reviewer.",
  "not-a-friend": "Only friends can be reviewers.",
  "no-timezone": "Confirm your timezone first.",
  "pact-not-found": "This pact wasn't found.",
  "edit-window-closed": "The 10 minutes are up.",
  "evidence-kind-fixed": "A pact's evidence kind can't change.",
};

/** A field left empty, an amount that isn't one, or a $0 penalty stops the owner leaving a step. The core judges the rest at Create. */
function stepProblem(step: Step, form: Form): Problem | null {
  switch (step) {
    case "goal":
      if (form.kind === "oura" && form.inBedBy === "") return "invalid-in-bed-by";
      if (form.kind === "anki" && form.ankiDeckId === null) return "unknown-deck";
      if (form.name.trim() === "") return "blank-name";
      if (form.kind !== "camera") return null;
      if (form.description.trim() === "") return "blank-description";
      return null;
    case "schedule": {
      const scheduleKind = scheduleKindOf(form);
      if (scheduleKind === "one-time" && form.deadline === "") return "no-deadline";
      if (scheduleKind === "fixed-days" && form.days.length === 0) return "no-days";
      return form.kind !== "oura" && form.dueByOn && form.dueBy === "" ? "invalid-due-by" : null;
    }
    case "penalty": {
      const penaltyCents = parseCents(form.penalty);
      if (penaltyCents === null) return "no-amount";
      if (penaltyCents === 0) return "invalid-penalty";
      return form.recipientId === null ? "no-recipient" : null;
    }
    case "reviewers":
      return form.reviewerIds.length === 0 ? "no-reviewers" : null;
    case "reminders":
      return form.reminders.includes("") ? "invalid-reminders" : null;
    case "kind":
    case "connect":
    case "check":
      return null;
  }
}

/** The form for a pact in its edit window, or word that the window has closed. */
export function EditPact({
  pactId,
  onDone,
  onInvite,
}: {
  pactId: string;
  /** After saving, cancelling, or finding the window closed: back to the pact. */
  onDone: () => void;
  onInvite: () => void;
}) {
  const { state } = useLoad(() => api.pact(pactId));
  return (
    <LoadedFound
      state={state}
      what="This pact"
      notFound={{ title: "Pact not found", body: "It isn't one of your pacts." }}
    >
      {({ pact }) => <CreatePact editing={pact} onCancel={onDone} onCreated={onDone} onInvite={onInvite} />}
    </LoadedFound>
  );
}

/** What the evidence kind step needs to know about the account's connections and this server. */
interface Connections {
  /** Whether the account has an Oura connection: without one, Oura Ring adds the Connect step. */
  ouraConnected: boolean;
  /** Whether this server has Oura set up: without it, the Oura Ring tile can't be picked. */
  ouraAvailable: boolean;
  /** Whether the account has an AnkiWeb connection: without one, Anki adds the Connect AnkiWeb step. */
  ankiConnected: boolean;
  /** Whether this server has Anki set up: without it, the Anki tile can't be picked. */
  ankiAvailable: boolean;
}

/**
 * The form, for a new pact or for `editing`. A pact's evidence kind never
 * changes, so editing skips that step, and with it the connections.
 */
export function CreatePact({
  onCancel,
  onCreated,
  onInvite,
  ...opened
}: ({ editing: Pact } | { connections: Connections }) & {
  onCancel: () => void;
  /** After creating the pact, or saving the edit. */
  onCreated: (pactId: string, name: string) => void;
  onInvite: () => void;
}) {
  const editing = "editing" in opened ? opened.editing : undefined;
  const connections = "connections" in opened ? opened.connections : null;
  const now = useNow();
  const [windowClosed, setWindowClosed] = useState(false);
  // Back from Oura's page: connected goes on to Goal; anything else stays at the kind step, saying why.
  const [ouraResult] = useState(takeOuraResult);
  const [ouraError, setOuraError] = useState(() => ouraResultText(ouraResult));
  const [form, setForm] = useState<Form>(
    editing ? formOf(editing) : { ...EMPTY_FORM, kind: ouraResult === "connected" ? "oura" : "camera" },
  );
  // Connecting AnkiWeb happens on this page, so the Connect step goes once it has.
  const [ankiConnected, setAnkiConnected] = useState(connections?.ankiConnected ?? false);
  const [ankiLogin, setAnkiLogin] = useState<AnkiLogin>(NO_ANKI_LOGIN);
  const [step, setStep] = useState<Step>(editing || ouraResult === "connected" ? "goal" : "kind");
  const [tried, setTried] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [loadFailed, setLoadFailed] = useState<{ error: unknown } | null>(null);
  const top = useRef<HTMLDivElement>(null);

  /** Whether picking `kind` adds a Connect step: Oura Ring or Anki, with no connection yet. */
  const connects = (kind: EvidenceKind) =>
    (kind === "oura" && connections?.ouraConnected === false) || (kind === "anki" && !ankiConnected);
  const steps: Step[] = editing
    ? AFTER_KIND
    : ["kind", ...(connects(form.kind) ? (["connect"] as const) : []), ...AFTER_KIND];
  const stepIndex = steps.indexOf(step);
  const problem = stepProblem(step, form);
  const update = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }));

  const {
    busy: creating,
    error: createError,
    setError: setCreateError,
    run: create,
  } = useSend(
    async () => {
      const terms = termsOfForm(form);
      // The Penalty step stops these first. Returning nothing here would count as sent and keep the button disabled.
      if ("problem" in terms) return problemText(terms.problem, form);
      if (editing) {
        const result = await api.editPact(editing.id, { evidenceKind: form.kind, ...terms });
        if (result.ok) return onCreated(editing.id, terms.name);
        if (result.reason === "edit-window-closed") setWindowClosed(true);
        return problemText(result.reason, form);
      }
      const result = await api.createPact({ evidenceKind: form.kind, ...terms });
      if (!result.ok) return problemText(result.reason, form);
      onCreated(result.pactId, terms.name);
    },
    (error) =>
      `Couldn't ${editing ? "save" : "create"} it. ${failureText(error, "Check your connection and try again.")}`,
    // Created or saved leaves for the pact's page: the button stays disabled till then.
    { leavesScreen: true },
  );

  const loadFriends = () => api.friends().then(setFriends, (error: unknown) => setLoadFailed({ error }));
  useEffect(() => {
    void loadFriends();
    api.recipients().then(
      (list) => {
        setRecipients(list);
        // With only one saved recipient, it's the one.
        if (list.length === 1) setForm((f) => (f.recipientId === null ? { ...f, recipientId: list[0]!.id } : f));
      },
      (error: unknown) => setLoadFailed({ error }),
    );
  }, []);

  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
  }, [step]);

  const goTo = (to: Step) => {
    setTried(false);
    setOuraError(null);
    setCreateError(null);
    setStep(to);
  };
  const next = () => {
    if (problem) return setTried(true);
    goTo(steps[stepIndex + 1]!);
  };

  const connectAnki = async () => {
    setAnkiLogin((login) => ({ ...login, busy: true, failed: null }));
    const result = await signInToAnki(ankiLogin);
    if (result !== true) return setAnkiLogin(result);
    // The password goes no further than that request.
    setAnkiLogin({ email: ankiLogin.email, password: "", busy: false, failed: null });
    setAnkiConnected(true);
    goTo("goal");
  };

  let body: ReactNode;
  switch (step) {
    case "kind":
      body = (
        <KindStep
          ouraAvailable={connections?.ouraAvailable ?? false}
          ankiAvailable={connections?.ankiAvailable ?? false}
          onPick={(kind) => {
            update({ kind });
            goTo(connects(kind) ? "connect" : "goal");
          }}
        />
      );
      break;
    case "connect":
      body =
        form.kind === "anki" ? (
          <ConnectAnkiStep login={ankiLogin} onChange={(change) => setAnkiLogin((l) => ({ ...l, ...change }))} />
        ) : (
          <ConnectStep />
        );
      break;
    case "goal":
      body = <GoalStep form={form} update={update} />;
      break;
    case "schedule":
      body = <ScheduleStep form={form} update={update} />;
      break;
    case "penalty":
      body = (
        <PenaltyStep
          form={form}
          update={update}
          recipients={recipients}
          onAdded={(recipient) => {
            setRecipients((list) => [...(list ?? []), recipient]);
            update({ recipientId: recipient.id });
          }}
        />
      );
      break;
    case "reviewers":
      body = (
        <ReviewersStep
          friends={friends}
          reviewerIds={form.reviewerIds}
          onReviewerIds={(reviewerIds) => update({ reviewerIds })}
          kind={form.kind}
          onInvite={onInvite}
          onCheckAgain={() => void loadFriends()}
        />
      );
      break;
    case "reminders":
      body = <RemindersStep form={form} onReminders={(reminders) => update({ reminders })} />;
      break;
    case "check":
      body = <CheckStep form={form} friends={friends ?? []} recipients={recipients ?? []} editing={editing} />;
      break;
  }

  const minutes = editing ? minutesLeft(editing.editWindowClosesAt, now) : null;
  if (editing && (windowClosed || minutes === null)) {
    return (
      <div className="alert bad" role="status">
        <b>The 10 minutes are up.</b>
        <span>Your changes weren't saved, and {editing.name} stays as it was.</span>
        <button className="btn sm self-start" onClick={onCancel}>
          Back to pact
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="stack" ref={top}>
        <div className="steps" aria-hidden="true">
          {steps.map((s, i) => (
            <i key={s} className={i <= stepIndex ? "on" : undefined} />
          ))}
        </div>
        <div className="spread">
          <small className="muted">
            Step {stepIndex + 1} of {steps.length}
          </small>
          {minutes !== null && <span className="chip c-new">{minutes} min left to edit</span>}
        </div>
      </div>
      {loadFailed && (
        <p className="error">
          Some of this couldn't load. {failureText(loadFailed.error, "Check your connection and reopen Pact.")}
        </p>
      )}
      {body}
      {tried && problem && <p className="error">{problemText(problem, form)}</p>}
      {ouraError && <p className="error">{ouraError}</p>}
      {createError && <p className="error">{createError}</p>}
      <div className="footbar">
        {stepIndex === 0 ? (
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button className="btn" disabled={creating} onClick={() => goTo(steps[stepIndex - 1]!)}>
            Back
          </button>
        )}
        {step === "check" ? (
          <button className="btn primary grow" disabled={creating} onClick={() => create()}>
            {editing ? "Save changes" : "Create pact"}
          </button>
        ) : step === "connect" && form.kind === "anki" ? (
          <button
            className="btn primary grow"
            disabled={ankiLogin.busy || ankiLogin.email.trim() === "" || ankiLogin.password === ""}
            onClick={() => void connectAnki()}
          >
            {ankiLogin.busy ? "Connecting…" : "Connect AnkiWeb"}
          </button>
        ) : step === "connect" ? (
          // A full page load: Oura's page, then its callback, which brings the browser back here.
          <a className="btn primary grow" href={API_PATHS.ouraConnect}>
            Connect Oura
          </a>
        ) : (
          step !== "kind" && (
            <button className="btn primary grow" onClick={next}>
              Next
            </button>
          )
        )}
      </div>
    </>
  );
}

// ---------- steps ----------

function KindStep({
  ouraAvailable,
  ankiAvailable,
  onPick,
}: {
  ouraAvailable: boolean;
  ankiAvailable: boolean;
  onPick: (kind: EvidenceKind) => void;
}) {
  return (
    <>
      <h2>How will you prove it?</h2>
      <div className="kind-tiles three">
        <button className="kind-tile" onClick={() => onPick("camera")}>
          <span className="tico">
            <CameraIcon />
          </span>
          <b>Camera</b>
          <small>Take a photo each time. Your reviewer checks it.</small>
        </button>
        <button className="kind-tile" disabled={!ouraAvailable} onClick={() => onPick("oura")}>
          <span className="tico">
            <RingIcon />
          </span>
          <b>Oura Ring</b>
          <small>Your ring reports when you got into bed. Nothing to submit.</small>
          {!ouraAvailable && <span className="chip c-soon">Oura isn't set up yet</span>}
        </button>
        <button className="kind-tile" disabled={!ankiAvailable} onClick={() => onPick("anki")}>
          <span className="tico">
            <CardsIcon />
          </span>
          <b>Anki</b>
          <small>Finish a deck each day. Pact checks AnkiWeb after you sync. Nothing to submit.</small>
          {!ankiAvailable && <span className="chip c-soon">Anki isn't set up yet</span>}
        </button>
      </div>
      <small className="muted">You can't change this later.</small>
    </>
  );
}

function ConnectStep() {
  return (
    <>
      <h2>Connect your Oura Ring</h2>
      <div className="card">
        <div className="row2">
          <span className="kico k-ring">
            <RingIcon />
          </span>
          <b>Oura asks you to sign in and allow Pact.</b>
        </div>
        <p>
          Pact checks when your main sleep each night starts. Your reviewers see only Satisfied or Missed and that time.
        </p>
      </div>
      <small className="muted">You'll come back here to set your bedtime.</small>
    </>
  );
}

function ConnectAnkiStep({ login, onChange }: { login: AnkiLogin; onChange: (change: Partial<AnkiLogin>) => void }) {
  return (
    <>
      <h2>Connect AnkiWeb</h2>
      <p>Sign in with your AnkiWeb account, the one your phone and computer sync to.</p>
      <AnkiLoginFields login={login} onChange={onChange} />
      <p className="tos">AnkiWeb doesn't officially allow other apps to sign in, and could suspend your account.</p>
      <p className="keeps">
        Pact trades your password for an AnkiWeb sign-in key, then forgets the password. It keeps the key, encrypted,
        and only ever reads your decks. Disconnect on Profile to delete it.
      </p>
    </>
  );
}

/** The last part of a deck's full name: "Verbs" for "Spanish::Verbs". */
function deckLeaf(name: string): string {
  return name.split("::").at(-1) ?? name;
}

/** Anki's Goal step: the deck tree, indented, with the picked deck's counts now, then the name. */
function AnkiGoalStep({ form, update }: { form: Form; update: (change: Partial<Form>) => void }) {
  const { state, reload } = useLoad(() => api.ankiDecks());
  const data = loadedData(state);
  const failed = loadFailure(state);
  let picker: ReactNode = <small className="muted">Loading your decks from AnkiWeb…</small>;
  if (failed || (data !== null && !data.ok)) {
    const reason = data !== null && !data.ok ? data.reason : null;
    picker = (
      <div className="alert bad" role="status">
        <span>
          {reason === "disconnected"
            ? "AnkiWeb didn't accept Pact's sign-in. Connect AnkiWeb again from Profile."
            : reason === "not-connected"
              ? "Connect AnkiWeb first."
              : `Couldn't load your decks. ${failed ? failureText(failed.error, "Check your connection.") : "AnkiWeb didn't answer."}`}
        </span>
        <button className="btn sm self-start" onClick={reload}>
          Try again
        </button>
      </div>
    );
  } else if (data?.ok && data.decks.length === 0) {
    picker = <small className="muted">AnkiWeb has no decks for this account yet. Make one in Anki and sync.</small>;
  } else if (data?.ok) {
    const depth = depthsOf(data.decks);
    picker = (
      <div className="deck-tree" role="radiogroup" aria-label="Deck">
        {data.decks.map((deck) => (
          <button
            key={deck.id}
            className="deck"
            role="radio"
            aria-checked={form.ankiDeckId === deck.id}
            style={{ paddingLeft: 14 + depth.get(deck.id)! * 20 }}
            onClick={() =>
              update({
                ankiDeckId: deck.id,
                ankiDeckName: deck.name,
                ...(!form.named && { name: deckLeaf(deck.name) }),
              })
            }
          >
            <span className="radio" />
            <span className="nm">{deckLeaf(deck.name)}</span>
          </button>
        ))}
      </div>
    );
  }
  const picked = data?.ok ? data.decks.find((deck) => deck.id === form.ankiDeckId) : undefined;
  return (
    <>
      <h2>Goal</h2>
      <div className="field">
        <span>Deck to finish each day</span>
        {picker}
        <small>
          Subdecks count in their parent, as in Anki's deck list. Renaming or moving the deck in Anki doesn't break the
          pact.
        </small>
      </div>
      {picked && (
        <div className="card">
          <b>{picked.name} today</b>
          <div>
            <span className="leftbig">{left(picked)}</span>{" "}
            <span className="muted">{left(picked) === 1 ? "card" : "cards"} left</span>
          </div>
          <p className="small muted">
            Finished means New, Learn and Due all at 0, Anki's "Congratulations! You have finished this deck for now."
          </p>
        </div>
      )}
      <NameField form={form} update={update} placeholder="e.g. Spanish" />
    </>
  );
}

/** The pact's name; once the owner types one, it no longer follows the deck or the in-bed-by time. */
function NameField({
  form,
  update,
  placeholder,
}: {
  form: Form;
  update: (change: Partial<Form>) => void;
  placeholder: string;
}) {
  return (
    <label className="field">
      <span>Name</span>
      <input
        className="inp"
        value={form.name}
        placeholder={placeholder}
        onChange={(e) => update({ name: e.target.value, named: e.target.value.trim() !== "" })}
      />
      <small>Shown on Today.</small>
    </label>
  );
}

/** The cards left in a deck: new, learning and due together. */
function left(deck: Pick<AnkiDeck, "counts">): number {
  return deck.counts.new + deck.counts.learn + deck.counts.review;
}

/** How deep each deck sits in the tree: 0 at the top. The list comes parents first. */
function depthsOf(decks: AnkiDeck[]): Map<string, number> {
  const depth = new Map<string, number>();
  for (const deck of decks) depth.set(deck.id, deck.parentId === null ? 0 : (depth.get(deck.parentId) ?? -1) + 1);
  return depth;
}

/** A problem in the owner's words; a due-by time an Anki pact refuses says what an Anki pact takes. */
function problemText(problem: Problem, form: Pick<Form, "kind">): string {
  return PROBLEMS[problem === "invalid-due-by" && form.kind === "anki" ? "anki-due-by" : problem];
}

export function GoalStep({ form, update }: { form: Form; update: (change: Partial<Form>) => void }) {
  if (form.kind === "anki") return <AnkiGoalStep form={form} update={update} />;
  if (form.kind === "oura") {
    return (
      <>
        <h2>Goal</h2>
        <label className="field">
          <span>In bed by</span>
          <input
            className="inp time-inp"
            type="time"
            value={form.inBedBy}
            onChange={(e) => {
              const inBedBy = e.target.value;
              update(form.named || inBedBy === "" ? { inBedBy } : { inBedBy, name: inBedByName(inBedBy) });
            }}
          />
          <small>Late is when your ring says you got into bed after this.</small>
        </label>
        <NameField form={form} update={update} placeholder="e.g. In bed by midnight" />
      </>
    );
  }
  return (
    <>
      <h2>Goal</h2>
      {/* Typed, it stays if the owner goes back and picks a bedtime or a deck instead. */}
      <NameField form={form} update={update} placeholder="e.g. Gym" />
      <label className="field">
        <span>What will your photo show?</span>
        <textarea
          className="inp"
          value={form.description}
          placeholder="e.g. Me at the gym with the equipment visible"
          onChange={(e) => update({ description: e.target.value })}
        />
        <small>Your reviewer sees this when checking your photo.</small>
      </label>
    </>
  );
}

/** The form's schedule as the core takes it. */
function scheduleOf(form: Form): Schedule {
  switch (scheduleKindOf(form)) {
    case "fixed-days":
      return { kind: "fixed-days", days: form.days };
    case "weekly-count":
      return { kind: "weekly-count", target: form.target };
    case "one-time":
      return { kind: "one-time", deadline: form.deadline, submitAnytime: form.submitAnytime };
  }
}

/** The terms the form's evidence kind and kind of schedule have. */
function termsOfFormKind(form: Form): Term[] {
  return termsOfKind({ evidenceKind: form.kind, schedule: { kind: scheduleKindOf(form) } });
}

/** The form's optional times as the core takes them: each left out when it isn't set, or its pact doesn't have it. */
function optionalTimes(form: Form): { dueBy?: string; startDate?: string; endDate?: string } {
  const terms = termsOfFormKind(form);
  return {
    ...(terms.includes("due-by") && form.dueByOn && { dueBy: form.dueBy }),
    ...(terms.includes("start-date") && form.startDate !== "" && { startDate: form.startDate }),
    ...(terms.includes("end-date") && form.endDate !== "" && { endDate: form.endDate }),
  };
}

/**
 * The form's terms as the core takes them, at Create, Save or Request
 * change, or what stops them being sent: an amount that isn't one, or no
 * recipient picked.
 */
export function termsOfForm(form: Form): Omit<PactChange, "note"> | { problem: "no-amount" | "no-recipient" } {
  const penaltyCents = parseCents(form.penalty);
  if (penaltyCents === null) return { problem: "no-amount" };
  if (form.recipientId === null) return { problem: "no-recipient" };
  return {
    name: form.name.trim(),
    description: form.kind === "camera" ? form.description.trim() : "",
    ...(form.kind === "oura" && { inBedBy: form.inBedBy }),
    ...(form.kind === "anki" && form.ankiDeckId !== null && { ankiDeckId: form.ankiDeckId }),
    ...optionalTimes(form),
    schedule: scheduleOf(form),
    penaltyCents,
    recipientId: form.recipientId,
    reviewerIds: form.reviewerIds,
    reminders: form.reminders,
  };
}

/**
 * The form's reminders as a schedule of kind `to` takes them: a One-time
 * pact's each have a date, the deadline's to start with.
 */
function remindersAs(form: Form, to: Schedule["kind"]): string[] {
  const dated = to === "one-time";
  if (dated === (scheduleKindOf(form) === "one-time")) return form.reminders;
  if (!dated) return form.reminders.map((reminder) => parseDatedReminder(reminder).time);
  return form.deadline === "" ? [] : form.reminders.map((time) => (time === "" ? "" : `${form.deadline}T${time}`));
}

export function ScheduleStep({
  form,
  update,
  kindFixed = false,
}: {
  form: Form;
  update: (change: Partial<Form>) => void;
  /** After the edit window, the kind of schedule can't change: only the chosen one shows. */
  kindFixed?: boolean;
}) {
  const { days } = form;
  const oura = form.kind === "oura";
  const anki = form.kind === "anki";
  const scheduleKind = scheduleKindOf(form);
  const weekly = scheduleKind === "weekly-count";
  const oneTime = scheduleKind === "one-time";
  const pick = (kind: Schedule["kind"]) => update({ scheduleKind: kind, reminders: remindersAs(form, kind) });
  const everyDay = days.length === WEEKDAYS.length;
  const onDays = (days: Weekday[]) => update({ days });
  // Kept in week order, Monday first.
  const toggle = (day: Weekday) => onDays(WEEKDAYS.filter((d) => (d === day ? !days.includes(d) : days.includes(d))));
  const until = form.dueByOn && form.dueBy !== "" ? clockText(form.dueBy) : "midnight";
  const setTarget = (target: number) => update({ target: Math.min(MAX_WEEKLY_TARGET, Math.max(1, target)) });
  return (
    <>
      <h2>Schedule</h2>
      {form.kind === "camera" && !kindFixed && (
        <div className="seg" role="group" aria-label="Schedule type">
          <button aria-pressed={scheduleKind === "fixed-days"} onClick={() => pick("fixed-days")}>
            Fixed days
          </button>
          <button aria-pressed={weekly} onClick={() => pick("weekly-count")}>
            Weekly count
          </button>
          <button aria-pressed={oneTime} onClick={() => pick("one-time")}>
            One-time
          </button>
        </div>
      )}
      {oneTime ? (
        <label className="field">
          <span>Deadline</span>
          <input
            className="inp"
            type="date"
            value={form.deadline}
            onChange={(e) => update({ deadline: e.target.value })}
          />
        </label>
      ) : weekly ? (
        <>
          <div className="field">
            <span>Days a week</span>
            <div className="stepper">
              <button
                className="iconbtn"
                aria-label="Fewer"
                disabled={form.target <= 1}
                onClick={() => setTarget(form.target - 1)}
              >
                −
              </button>
              <b className="num">{form.target}×</b>
              <span>per week (Mon–Sun)</span>
              <button
                className="iconbtn"
                aria-label="More"
                disabled={form.target >= MAX_WEEKLY_TARGET}
                onClick={() => setTarget(form.target + 1)}
              >
                +
              </button>
            </div>
          </div>
          <small className="muted">
            Any days you like, one photo a day. One penalty for each day you're short when the week ends.
          </small>
        </>
      ) : (
        <>
          <div className="field">
            <span>{oura ? "Nights" : "Days"}</span>
            <div className="days" role="group" aria-label={oura ? "Nights" : "Days"}>
              {WEEKDAYS.map((day) => (
                <button
                  key={day}
                  aria-pressed={days.includes(day)}
                  aria-label={DAY_BUTTONS[day].full}
                  onClick={() => toggle(day)}
                >
                  {DAY_BUTTONS[day].short}
                </button>
              ))}
            </div>
          </div>
          <button
            className="btn sm self-start"
            aria-pressed={everyDay}
            onClick={() => onDays(everyDay ? [] : [...WEEKDAYS])}
          >
            {oura ? "Every night" : "Every day"}
          </button>
        </>
      )}
      <small className="muted">
        {oura
          ? "Each night is judged when your ring syncs. A night with no sleep data by 6pm the next day counts as missed."
          : anki
            ? `Each day is judged from AnkiWeb. Finish the deck and sync before ${until}. A day Pact hasn't seen finished by then counts as missed.`
            : oneTime
              ? form.submitAnytime
                ? `You can submit any day until the deadline, until ${until} on its date.`
                : `You can submit on the deadline's date only, until ${until}.`
              : weekly
                ? `You can submit on any day of the week, until ${until}.`
                : `You can submit on scheduled days only, until ${until}.`}
      </small>
      {termsOfFormKind(form).includes("due-by") && (
        <>
          <div className="list">
            <label className="switch-row">
              <span className="rt">
                <b>Due by a set time</b>
                <small>Instead of midnight</small>
              </span>
              <input
                className="switch"
                type="checkbox"
                role="switch"
                checked={form.dueByOn}
                onChange={(e) => update({ dueByOn: e.target.checked })}
              />
            </label>
          </div>
          {form.dueByOn && (
            <label className="field">
              <span>Due by</span>
              <input
                className="inp time-inp"
                type="time"
                value={form.dueBy}
                onChange={(e) => update({ dueBy: e.target.value })}
              />
              {anki && (
                <small>
                  Up to when your Anki day ends, usually 4:00am. A time after midnight counts for the evening before.
                </small>
              )}
            </label>
          )}
        </>
      )}
      {oneTime ? (
        <OneTimeWindow form={form} update={update} />
      ) : (
        <DateRange form={form} update={update} weekly={weekly} />
      )}
    </>
  );
}

/** One-time's Submit anytime switch, under the deadline, and the hour the deadline needs. */
function OneTimeWindow({ form, update }: { form: Form; update: (change: Partial<Form>) => void }) {
  return (
    <>
      <div className="list">
        <label className="switch-row">
          <span className="rt">
            <b>Submit anytime</b>
            <small>Anytime from now until the selected deadline.</small>
          </span>
          <input
            className="switch"
            type="checkbox"
            role="switch"
            checked={form.submitAnytime}
            onChange={(e) => update({ submitAnytime: e.target.checked })}
          />
        </label>
      </div>
      <small className="muted">
        The deadline must be at least an hour after you create it. Then it's judged once, and Ended.
      </small>
    </>
  );
}

/** A recurring pact's optional start and end dates. */
function DateRange({ form, update, weekly }: { form: Form; update: (change: Partial<Form>) => void; weekly: boolean }) {
  const oura = form.kind === "oura";
  return (
    <>
      <div className="dates">
        <label className="field">
          <span>Start (optional)</span>
          <input
            className="inp"
            type="date"
            value={form.startDate}
            onChange={(e) => update({ startDate: e.target.value })}
          />
        </label>
        <label className="field">
          <span>End (optional)</span>
          <input
            className="inp"
            type="date"
            value={form.endDate}
            min={form.startDate || undefined}
            onChange={(e) => update({ endDate: e.target.value })}
          />
        </label>
      </div>
      <small className="muted">
        {weekly
          ? "It starts the Monday after you create it, or the first Monday from the start date if that's later. Only whole weeks up to the end date count, then it's Ended."
          : `It starts with the first ${oura ? "night" : "day"} that's due at least an hour after you create it, or on the start date if that's later. After the end date it makes no more ${oura ? "nights" : "days"} and is Ended.`}
      </small>
    </>
  );
}

export function PenaltyStep({
  form,
  update,
  recipients,
  onAdded,
}: {
  form: Form;
  update: (change: Partial<Form>) => void;
  recipients: Recipient[] | null;
  onAdded: (recipient: Recipient) => void;
}) {
  // The new-recipient form goes back to the picker on Cancel when it was opened from there.
  const [open, setOpen] = useState<"none" | "picker" | "form" | "form-from-picker">("none");
  const chosen = recipients?.find((r) => r.id === form.recipientId);
  const saved = recipients ?? [];

  let slot: ReactNode;
  if (open === "picker") {
    slot = (
      <div className="card">
        <div className="stack">
          {saved.map((r) => (
            <button
              key={r.id}
              className="opt"
              aria-pressed={form.recipientId === r.id}
              onClick={() => {
                update({ recipientId: r.id });
                setOpen("none");
              }}
            >
              <span className="glyph" aria-hidden="true">
                {initial(r.name)}
              </span>
              <span className="rt">
                <b>{r.name}</b>
              </span>
            </button>
          ))}
        </div>
        <button className="link self-start" onClick={() => setOpen("form-from-picker")}>
          New recipient
        </button>
        <button className="btn sm self-start" onClick={() => setOpen("none")}>
          Cancel
        </button>
      </div>
    );
  } else if (open !== "none") {
    slot = (
      <NewRecipientForm
        onSaved={(recipient) => {
          setOpen("none");
          onAdded(recipient);
        }}
        onCancel={() => setOpen(open === "form-from-picker" ? "picker" : "none")}
      />
    );
  } else if (chosen) {
    slot = (
      <div className="opt static">
        <span className="glyph" aria-hidden="true">
          {initial(chosen.name)}
        </span>
        <span className="rt">
          <b>{chosen.name}</b>
        </span>
        <button className="link" onClick={() => setOpen("picker")}>
          Change
        </button>
      </div>
    );
  } else {
    slot = (
      <>
        <button
          className="btn block"
          disabled={recipients === null}
          onClick={() => setOpen(saved.length === 0 ? "form" : "picker")}
        >
          Pick a recipient
        </button>
        <small>Who you pay when you miss.</small>
      </>
    );
  }

  return (
    <>
      <h2>Penalty</h2>
      <label className="field">
        <span>Penalty per miss</span>
        <span className="money-inp">
          <b>$</b>
          <input
            className="inp"
            inputMode="decimal"
            value={form.penalty}
            placeholder="5"
            onChange={(e) => update({ penalty: e.target.value })}
          />
        </span>
      </label>
      <div className="field">
        <span>Recipient</span>
        {slot}
      </div>
    </>
  );
}

function NewRecipientForm({ onSaved, onCancel }: { onSaved: (recipient: Recipient) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const {
    busy: saving,
    error,
    run: save,
  } = useSend(
    async () => {
      const result = await api.addRecipient({ name });
      if (!result.ok) return "Enter a name.";
      onSaved(result.recipient);
    },
    (error) => `Couldn't save it. ${failureText(error, "Check your connection and try again.")}`,
  );

  return (
    <div className="card">
      <label className="field">
        <span>Name</span>
        <input
          className="inp"
          value={name}
          placeholder="e.g. Sam, or City Food Bank"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row2">
        <button className="btn sm primary" disabled={name.trim() === "" || saving} onClick={() => save()}>
          Save
        </button>
        <button className="btn sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ReviewersStep({
  friends,
  reviewerIds,
  onReviewerIds,
  kind,
  hint,
  onInvite,
  onCheckAgain,
}: {
  friends: Friend[] | null;
  reviewerIds: string[];
  onReviewerIds: (ids: string[]) => void;
  kind: EvidenceKind;
  /** Says what picking does, in place of the default line. */
  hint?: string;
  onInvite: () => void;
  onCheckAgain: () => void;
}) {
  if (friends === null) return <h2>Reviewers</h2>;
  if (friends.length === 0) {
    return (
      <>
        <h2>Reviewers</h2>
        <div className="card">
          <h3>No friends yet</h3>
          <p className="muted">
            Only friends can review your pacts. Invite one, and they show up here once they accept.
          </p>
          <div className="row2">
            <button className="btn primary" onClick={onInvite}>
              Invite a friend
            </button>
            <button className="btn" onClick={onCheckAgain}>
              Check again
            </button>
          </div>
        </div>
      </>
    );
  }
  const toggle = (id: string) =>
    onReviewerIds(reviewerIds.includes(id) ? reviewerIds.filter((r) => r !== id) : [...reviewerIds, id]);
  return (
    <>
      <h2>Reviewers</h2>
      <div className="stack">
        {friends.map((f) => (
          <label key={f.id} className="opt">
            <input type="checkbox" checked={reviewerIds.includes(f.id)} onChange={() => toggle(f.id)} />
            <span className="avatar sm" aria-hidden="true">
              {initial(f.name)}
            </span>
            <span className="rt">
              <b>{f.name}</b>
            </span>
          </label>
        ))}
      </div>
      <small className="muted">
        {hint ??
          (kind === "oura"
            ? "Your ring decides each night, so there are no photos to review. Reviewers decide on your excuses."
            : kind === "anki"
              ? "AnkiWeb decides each day, so there's nothing to review. Reviewers decide on your excuses and change requests."
              : "Any reviewer you pick can check your photos.")}
      </small>
    </>
  );
}

type FirstState =
  | { kind: "loading" }
  | { kind: "loaded"; first: Json<FirstOccurrence> }
  | { kind: "refused"; reason: Refusal<FirstOccurrenceResponse> }
  | { kind: "failed"; error: unknown };

/** How often the Check step asks again, so the day it names stays the one Create would store. */
const FIRST_OCCURRENCE_REFRESH_MS = 60_000;

function CheckStep({
  form,
  friends,
  recipients,
  editing,
}: {
  form: Form;
  friends: Friend[];
  recipients: Recipient[];
  editing?: Pact;
}) {
  const [first, setFirst] = useState<FirstState>({ kind: "loading" });
  const schedule = scheduleOf(form);
  // Asked for again only when the schedule really changes.
  const scheduleKey = JSON.stringify(schedule);
  const inBedBy = form.kind === "oura" ? form.inBedBy : undefined;
  const { dueBy, startDate } = optionalTimes(form);

  useEffect(() => {
    let current = true;
    const show = (state: FirstState) => {
      if (current) setFirst(state);
    };
    const load = () =>
      api.firstOccurrence({ schedule, evidenceKind: form.kind, inBedBy, dueBy, startDate, editing: editing?.id }).then(
        (result) =>
          show(
            result.ok ? { kind: "loaded", first: result.firstOccurrence } : { kind: "refused", reason: result.reason },
          ),
        (error: unknown) => show({ kind: "failed", error }),
      );
    void load();
    const timer = window.setInterval(() => void load(), FIRST_OCCURRENCE_REFRESH_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [scheduleKey, form.kind, inBedBy, dueBy, startDate, editing?.id]);

  const terms = termsOfForm(form);
  const recipient = recipients.find((r) => r.id === form.recipientId);
  return (
    <>
      <h2>Check it over</h2>
      <div className="card">
        <h3>{form.name.trim()}</h3>
        {form.kind === "camera" && <p className="muted">{form.description.trim()}</p>}
        {recipient && !("problem" in terms) && (
          <TermsList
            deckName={form.kind === "anki" ? form.ankiDeckName : undefined}
            terms={{
              ...terms,
              evidenceKind: form.kind,
              dueBy: terms.dueBy ?? null,
              startDate: terms.startDate ?? null,
              endDate: terms.endDate ?? null,
              recipient,
              reviewers: friends.filter((f) => form.reviewerIds.includes(f.id)),
              reminders: form.reminders,
            }}
          />
        )}
      </div>
      <div className="alert info">
        <p>
          {!editing && "It's Active as soon as you create it."}
          {first.kind === "loaded" && (
            <>
              {" "}
              {inBedBy ? (
                <>
                  The first night is <b>{formatDate(first.first.date)}</b>, in bed by {clockText(inBedBy)}.
                </>
              ) : schedule.kind === "weekly-count" ? (
                <>
                  The first week starts <b>{formatDate(first.first.date)}</b>, due by the end of Sunday.
                </>
              ) : schedule.kind === "one-time" ? (
                <>
                  It's due <b>{oneTimeText(schedule.submitAnytime, first.first.date, dueBy)}</b>.
                </>
              ) : (
                <>
                  The first one is <b>{formatDate(first.first.date)}</b>, due {dueBy ? clockText(dueBy) : "midnight"}.
                </>
              )}
            </>
          )}
          {editing?.editWindowClosesAt && (
            // On this device's clock: the form has no profile timezone, and the window ends minutes from now.
            <> Your 10 minutes end at {clockTime(editing.editWindowClosesAt, undefined)}. Saving doesn't add more.</>
          )}
        </p>
        {first.kind === "refused" && <p className="error">{PROBLEMS[first.reason]}</p>}
        {first.kind === "failed" && (
          <p className="muted small">
            Couldn't load the first day. {failureText(first.error, "Check your connection.")}
          </p>
        )}
      </div>
    </>
  );
}

/** A One-time pact's occurrence as the Check step names it: "Thu Nov 12, due midnight", or "Anytime until Thu Nov 12, midnight". */
function oneTimeText(submitAnytime: boolean, date: string, dueBy: string | undefined): string {
  const due = dueBy ? clockText(dueBy) : "midnight";
  return submitAnytime ? `Anytime until ${formatDate(date)}, ${due}` : `${formatDate(date)}, due ${due}`;
}
