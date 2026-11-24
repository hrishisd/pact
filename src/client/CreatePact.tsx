// The step-by-step pact form: evidence kind, goal, schedule (Fixed days,
// Weekly count, Every 2 weeks, Once a month or One-time, with the optional
// due-by time, and for recurring pacts the start date or first period, and
// the end date), penalty, reviewers, reminders,
// then a check before Create pact. Picking Oura Ring with no connection adds
// a Connect step, which leaves for Oura's page; Oura's callback brings the
// browser back here (`?oura=connected`) at Goal. Picking Anki with no
// connection adds a Connect AnkiWeb step, which signs in on the spot and goes
// on to Goal, where the owner picks the deck. Editing a pact in its edit
// window reuses the form without the evidence kind step. The core decides
// every rule; the steps only stop the owner moving on with a field left empty.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EvidenceKind, FirstOccurrence, Friend, PactTerms, Recipient, Refusal } from "../shared/types.ts";
import { API_PATHS, type FirstOccurrenceResponse, type Json } from "../shared/api.ts";
import { isOncePerPeriod, lastDayOf } from "../shared/schedules.ts";
import { ouraResultText, takeOuraResult } from "./oura.tsx";
import { AnkiLoginFields, NO_ANKI_LOGIN, signInToAnki, type AnkiLogin } from "./anki.tsx";
import { api, failureText } from "./api.ts";
import { clockText, clockTime, EDIT_WINDOW_TEXT, formatDate, minutesLeft, parseCents, periodName } from "./format.ts";
import { CameraIcon, CardsIcon, RingIcon } from "./icons.tsx";
import { EMPTY_FORM, formOf, optionalTimes, scheduleKindOf, scheduleOf, termsOfForm, type Form } from "./pact-form.ts";
import {
  ListsFailed,
  PactFormStep,
  PROBLEMS,
  problemText,
  usePactFormLists,
  type FormStep,
  type Problem,
} from "./pact-form-steps.tsx";
import { TermsList } from "./terms-list.tsx";
import { LoadedFound, useLoad, useNow, useSend } from "./ui.tsx";

type Step = "kind" | "connect" | FormStep | "check";
const AFTER_KIND: Step[] = ["goal", "schedule", "penalty", "reviewers", "reminders", "check"];

type Pact = Json<PactTerms>;

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
      if (isOncePerPeriod({ kind: scheduleKind }) && !form.firstPeriodPicked) return "no-first-period";
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
  // With only one saved recipient, it's the one.
  const lists = usePactFormLists((list) => {
    if (list.length === 1) setForm((f) => (f.recipientId === null ? { ...f, recipientId: list[0]!.id } : f));
  });
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
    case "schedule":
    case "penalty":
    case "reviewers":
    case "reminders":
      body = (
        <PactFormStep step={step} form={form} update={update} lists={lists} onInvite={onInvite} editing={editing?.id} />
      );
      break;
    case "check":
      body = (
        <CheckStep form={form} friends={lists.friends ?? []} recipients={lists.recipients ?? []} editing={editing} />
      );
      break;
  }

  const minutes = editing ? minutesLeft(editing.editWindowClosesAt, now) : null;
  if (editing && (windowClosed || minutes === null)) {
    return (
      <div className="alert bad" role="status">
        <b>The {EDIT_WINDOW_TEXT} are up.</b>
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
      {lists.failed && <ListsFailed failed={lists.failed} />}
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
          <small>Take a photo each time. A reviewer checks it.</small>
        </button>
        <button className="kind-tile" disabled={!ouraAvailable} onClick={() => onPick("oura")}>
          <span className="tico">
            <RingIcon />
          </span>
          <b>Oura Ring</b>
          <small>Your ring tells Pact when you got into bed. You don't need to submit anything.</small>
          {!ouraAvailable && <span className="chip c-soon">Oura isn't set up yet</span>}
        </button>
        <button className="kind-tile" disabled={!ankiAvailable} onClick={() => onPick("anki")}>
          <span className="tico">
            <CardsIcon />
          </span>
          <b>Anki</b>
          <small>Finish a deck each day and sync. Pact checks AnkiWeb, so you don't need to submit anything.</small>
          {!ankiAvailable && <span className="chip c-soon">Anki isn't set up yet</span>}
        </button>
      </div>
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
          Pact checks when you start your main sleep each night. Your reviewers see only that time and whether you were
          in bed on time.
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
        Pact uses your password once to get a sign-in key from AnkiWeb, then forgets the password. Pact stores the key
        encrypted and only reads your decks. To delete the key, disconnect AnkiWeb in Profile.
      </p>
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
  const due = dueBy ? clockText(dueBy) : "midnight";

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
          {!editing &&
            `The pact starts as soon as you create it. You can edit or delete it for the first ${EDIT_WINDOW_TEXT}.`}
          {first.kind === "loaded" && (
            <>
              {" "}
              {inBedBy ? (
                <>
                  The first night is <b>{formatDate(first.first.date)}</b>, in bed by {clockText(inBedBy)}.
                </>
              ) : schedule.kind === "once-a-month" ? (
                <>
                  Your first month is <b>{periodName(schedule.kind, first.first.date)}</b>. It's due by {due} on{" "}
                  <b>{formatDate(lastDayOf(schedule, first.first.date))}</b>.
                </>
              ) : schedule.kind === "every-2-weeks" ? (
                <>
                  Your first 2 weeks start <b>{formatDate(first.first.date)}</b>. They're due by {due} on{" "}
                  <b>{formatDate(lastDayOf(schedule, first.first.date))}</b>.
                </>
              ) : schedule.kind === "weekly-count" ? (
                <>
                  Your first week starts <b>{formatDate(first.first.date)}</b> and ends on Sunday.
                </>
              ) : schedule.kind === "one-time" ? (
                <>
                  It's due <b>{oneTimeText(schedule.submitAnytime, first.first.date, dueBy)}</b>.
                </>
              ) : (
                <>
                  Your first day is <b>{formatDate(first.first.date)}</b>, due by {due}.
                </>
              )}
            </>
          )}
          {editing?.editWindowClosesAt && (
            // On this device's clock: the form has no profile timezone, and the window ends minutes from now.
            <>
              {" "}
              You can edit this pact until {clockTime(editing.editWindowClosesAt, undefined)}. Saving doesn't extend
              that time.
            </>
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
