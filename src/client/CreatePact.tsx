// The step-by-step pact form: evidence kind, goal, schedule, penalty, reviewers,
// then a check before Create pact. Picking Oura Ring with no connection adds
// a Connect step, which leaves for Oura's page; Oura's callback brings the
// browser back here (`?oura=connected`) at Goal. Editing a pact in its edit
// window reuses the form without the evidence kind step. The core decides every rule; the steps only
// stop the owner moving on with a field left empty.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  WEEKDAYS,
  type EditPactRefusal,
  type EvidenceKind,
  type FirstOccurrence,
  type Friend,
  type PactTerms,
  type Recipient,
  type Weekday,
} from "../shared/types.ts";
import { API_PATHS, OURA_RESULT_PARAM, type Json, type OuraResult } from "../shared/api.ts";
import { api, failureText } from "./api.ts";
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
import { CameraIcon, RingIcon } from "./icons.tsx";
import { TermsList } from "./PactPage.tsx";
import { Empty, useLoad, useNow } from "./ui.tsx";

type Step = "kind" | "connect" | "goal" | "schedule" | "penalty" | "reviewers" | "check";
const AFTER_KIND: Step[] = ["goal", "schedule", "penalty", "reviewers", "check"];

/** The form's steps. A pact's evidence kind never changes, so editing skips that step. */
function stepsFor(
  kind: EvidenceKind,
  { editing, ouraConnected }: { editing: boolean; ouraConnected: boolean },
): Step[] {
  if (editing) return AFTER_KIND;
  return ["kind", ...(kind === "oura" && !ouraConnected ? (["connect"] as const) : []), ...AFTER_KIND];
}

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

interface Form {
  kind: EvidenceKind;
  /** Oura Ring: "HH:MM" as the time field gives it, or "" until picked. */
  inBedBy: string;
  /** Whether the owner typed the name; until then a bedtime pact's name follows its in-bed-by time. */
  named: boolean;
  name: string;
  description: string;
  days: Weekday[];
  /** As typed, in dollars: "5" or "2.50". */
  penalty: string;
  recipientId: string | null;
  reviewerIds: string[];
}

const EMPTY_FORM: Form = {
  kind: "camera",
  inBedBy: "",
  named: false,
  name: "",
  description: "",
  days: [],
  penalty: "",
  recipientId: null,
  reviewerIds: [],
};

function formOf(pact: Pact): Form {
  return {
    kind: pact.evidenceKind,
    inBedBy: pact.inBedBy ?? "",
    named: true,
    name: pact.name,
    description: pact.description,
    days: pact.schedule.days,
    penalty: centsInputText(pact.penaltyCents),
    recipientId: pact.recipient.id,
    reviewerIds: pact.reviewers.map((reviewer) => reviewer.id),
  };
}

/**
 * What's wrong, in the owner's words: the core's refusals at Create or Save,
 * and the steps' own checks that a field is filled in.
 */
type Problem = EditPactRefusal | "no-amount" | "no-recipient" | "oura-failed";

const PROBLEMS: Record<Problem, string> = {
  "oura-not-connected": "Connect your Oura Ring first.",
  "invalid-in-bed-by": "Pick a time.",
  "blank-name": "Give it a name.",
  "blank-description": "Say what your photo will show.",
  "no-days": "Pick at least one day.",
  "no-amount": "Enter an amount, like 5 or 2.50.",
  "invalid-penalty": "Set a penalty above $0.",
  "no-recipient": "Pick a recipient.",
  "oura-failed": "Oura didn't connect. Try again.",
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
      if (form.name.trim() === "") return "blank-name";
      if (form.kind === "oura") return null;
      if (form.description.trim() === "") return "blank-description";
      return null;
    case "schedule":
      return form.days.length === 0 ? "no-days" : null;
    case "penalty": {
      const penaltyCents = parseCents(form.penalty);
      if (penaltyCents === null) return "no-amount";
      if (penaltyCents === 0) return "invalid-penalty";
      return form.recipientId === null ? "no-recipient" : null;
    }
    case "reviewers":
      return form.reviewerIds.length === 0 ? "no-reviewers" : null;
    default:
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
  const { data, failed } = useLoad(() => api.pact(pactId));
  if (failed) {
    return (
      <Empty
        title="This pact couldn't load"
        body={failureText(failed.error, "Check your connection and reopen Pact.")}
      />
    );
  }
  if (data === null) return null;
  if (!data.ok) return <Empty title="Pact not found" body="It isn't one of your pacts." />;
  return <CreatePact editing={data.pact} ouraConnected onCancel={onDone} onCreated={onDone} onInvite={onInvite} />;
}

/** The form, for a new pact or for `editing`. */
export function CreatePact({
  editing,
  ouraConnected,
  onCancel,
  onCreated,
  onInvite,
}: {
  editing?: Pact;
  /** Whether the account has an Oura connection: without one, Oura Ring adds the Connect step. */
  ouraConnected: boolean;
  onCancel: () => void;
  /** After creating the pact, or saving the edit. */
  onCreated: (pactId: string, name: string) => void;
  onInvite: () => void;
}) {
  const now = useNow();
  const [windowClosed, setWindowClosed] = useState(false);
  // Back from Oura's page: connected goes on to Goal; anything else stays at the kind step.
  const [ouraResult] = useState(takeOuraResult);
  const [form, setForm] = useState<Form>(
    editing ? formOf(editing) : { ...EMPTY_FORM, kind: ouraResult === "connected" ? "oura" : "camera" },
  );
  const steps = stepsFor(form.kind, { editing: editing !== undefined, ouraConnected });
  const [stepIndex, setStepIndex] = useState(ouraResult === "connected" ? steps.indexOf("goal") : 0);
  const [tried, setTried] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [loadFailed, setLoadFailed] = useState<{ error: unknown } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(
    ouraResult === "failed" ? PROBLEMS["oura-failed"] : null,
  );
  const top = useRef<HTMLDivElement>(null);

  const step = steps[stepIndex]!;
  const problem = stepProblem(step, form);
  const update = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }));

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
  }, [stepIndex]);

  const goTo = (index: number) => {
    setTried(false);
    setCreateError(null);
    setStepIndex(index);
  };
  const next = () => {
    if (problem) return setTried(true);
    goTo(stepIndex + 1);
  };

  const create = async () => {
    const recipientId = form.recipientId;
    const penaltyCents = parseCents(form.penalty);
    if (recipientId === null || penaltyCents === null) return;
    setCreating(true);
    setCreateError(null);
    try {
      const pact = {
        evidenceKind: form.kind,
        name: form.name.trim(),
        description: form.kind === "oura" ? "" : form.description.trim(),
        ...(form.kind === "oura" && { inBedBy: form.inBedBy }),
        schedule: { kind: "fixed-days", days: form.days },
        penaltyCents,
        recipientId,
        reviewerIds: form.reviewerIds,
      } as const;
      if (editing) {
        const result = await api.editPact(editing.id, pact);
        if (result.ok) return onCreated(editing.id, pact.name);
        if (result.reason === "edit-window-closed") setWindowClosed(true);
        setCreateError(PROBLEMS[result.reason]);
      } else {
        const result = await api.createPact(pact);
        if (result.ok) return onCreated(result.pactId, pact.name);
        setCreateError(PROBLEMS[result.reason]);
      }
    } catch (error) {
      const action = editing ? "save" : "create";
      setCreateError(`Couldn't ${action} it. ${failureText(error, "Check your connection and try again.")}`);
    }
    setCreating(false);
  };

  let body: ReactNode;
  switch (step) {
    case "kind":
      body = (
        <KindStep
          onPick={(kind) => {
            update({ kind });
            goTo(1);
          }}
        />
      );
      break;
    case "connect":
      body = <ConnectStep />;
      break;
    case "goal":
      body = <GoalStep form={form} update={update} />;
      break;
    case "schedule":
      body = <ScheduleStep kind={form.kind} days={form.days} onDays={(days) => update({ days })} />;
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
      {tried && problem && <p className="error">{PROBLEMS[problem]}</p>}
      {createError && <p className="error">{createError}</p>}
      <div className="footbar">
        {stepIndex === 0 ? (
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button className="btn" disabled={creating} onClick={() => goTo(stepIndex - 1)}>
            Back
          </button>
        )}
        {step === "check" ? (
          <button className="btn primary grow" disabled={creating} onClick={() => void create()}>
            {editing ? "Save changes" : "Create pact"}
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

/**
 * How connecting Oura went, when Oura's callback just brought the browser
 * back: read once, then taken off the URL so a reload doesn't repeat it.
 */
function takeOuraResult(): OuraResult | null {
  const params = new URLSearchParams(window.location.search);
  const result = params.get(OURA_RESULT_PARAM);
  if (result === null) return null;
  params.delete(OURA_RESULT_PARAM);
  const search = params.toString();
  window.history.replaceState(window.history.state, "", window.location.pathname + (search ? `?${search}` : ""));
  return result === "connected" || result === "cancelled" ? result : "failed";
}

function KindStep({ onPick }: { onPick: (kind: EvidenceKind) => void }) {
  return (
    <>
      <h2>How will you prove it?</h2>
      <div className="kind-tiles">
        <button className="kind-tile" onClick={() => onPick("camera")}>
          <span className="tico">
            <CameraIcon />
          </span>
          <b>Camera</b>
          <small>Take a photo each time. Your reviewer checks it.</small>
        </button>
        <button className="kind-tile" onClick={() => onPick("oura")}>
          <span className="tico">
            <RingIcon />
          </span>
          <b>Oura Ring</b>
          <small>Your ring reports when you got into bed. Nothing to submit.</small>
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
        <p>Pact checks when your main sleep each night starts. Your reviewers see only Kept or Missed and that time.</p>
      </div>
      <small className="muted">You'll come back here to set your bedtime.</small>
    </>
  );
}

function GoalStep({ form, update }: { form: Form; update: (change: Partial<Form>) => void }) {
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
        <label className="field">
          <span>Name</span>
          <input
            className="inp"
            value={form.name}
            placeholder="e.g. In bed by midnight"
            onChange={(e) => update({ name: e.target.value, named: e.target.value.trim() !== "" })}
          />
          <small>Shown on Today.</small>
        </label>
      </>
    );
  }
  return (
    <>
      <h2>Goal</h2>
      <label className="field">
        <span>Name</span>
        <input
          className="inp"
          value={form.name}
          placeholder="e.g. Gym"
          onChange={(e) => update({ name: e.target.value })}
        />
        <small>Shown on Today.</small>
      </label>
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

function ScheduleStep({
  kind,
  days,
  onDays,
}: {
  kind: EvidenceKind;
  days: Weekday[];
  onDays: (days: Weekday[]) => void;
}) {
  const oura = kind === "oura";
  const everyDay = days.length === WEEKDAYS.length;
  // Kept in week order, Monday first.
  const toggle = (day: Weekday) => onDays(WEEKDAYS.filter((d) => (d === day ? !days.includes(d) : days.includes(d))));
  return (
    <>
      <h2>Schedule</h2>
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
      <small className="muted">
        {oura
          ? "Each night is judged when your ring syncs. A night with no sleep data by 6pm the next day counts as missed."
          : "You can submit on scheduled days only, until midnight."}
      </small>
    </>
  );
}

function PenaltyStep({
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await api.addRecipient({ name });
      if (result.ok) return onSaved(result.recipient);
      setError("Enter a name.");
    } catch (error) {
      setError(`Couldn't save it. ${failureText(error, "Check your connection and try again.")}`);
    }
    setSaving(false);
  };

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
        <button className="btn sm primary" disabled={name.trim() === "" || saving} onClick={() => void save()}>
          Save
        </button>
        <button className="btn sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ReviewersStep({
  friends,
  reviewerIds,
  onReviewerIds,
  kind,
  onInvite,
  onCheckAgain,
}: {
  friends: Friend[] | null;
  reviewerIds: string[];
  onReviewerIds: (ids: string[]) => void;
  kind: EvidenceKind;
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
        {kind === "oura"
          ? "Your ring decides each night, so there are no photos to review. Reviewers decide on your excuses."
          : "Any reviewer you pick can check your photos."}
      </small>
    </>
  );
}

type FirstState =
  { kind: "loading" } | { kind: "loaded"; first: Json<FirstOccurrence> } | { kind: "failed"; error: unknown };

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
  const days = form.days;
  const inBedBy = form.kind === "oura" ? form.inBedBy : undefined;

  useEffect(() => {
    let current = true;
    const show = (state: FirstState) => {
      if (current) setFirst(state);
    };
    const load = () =>
      api.firstOccurrence({ schedule: { kind: "fixed-days", days }, inBedBy, editing: editing?.id }).then(
        (result) =>
          show(
            result.ok ? { kind: "loaded", first: result.firstOccurrence } : { kind: "failed", error: result.reason },
          ),
        (error: unknown) => show({ kind: "failed", error }),
      );
    void load();
    const timer = window.setInterval(() => void load(), FIRST_OCCURRENCE_REFRESH_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [days, inBedBy, editing?.id]);

  const recipient = recipients.find((r) => r.id === form.recipientId);
  return (
    <>
      <h2>Check it over</h2>
      <div className="card">
        <h3>{form.name.trim()}</h3>
        {form.kind === "camera" && <p className="muted">{form.description.trim()}</p>}
        {recipient && (
          <TermsList
            terms={{
              evidenceKind: form.kind,
              inBedBy: inBedBy ?? null,
              schedule: { kind: "fixed-days", days },
              penaltyCents: parseCents(form.penalty) ?? 0,
              recipient,
              reviewers: friends.filter((f) => form.reviewerIds.includes(f.id)),
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
              ) : (
                <>
                  The first one is <b>{formatDate(first.first.date)}</b>, due midnight.
                </>
              )}
            </>
          )}
          {editing?.editWindowClosesAt && (
            <> Your 10 minutes end at {clockTime(editing.editWindowClosesAt)}. Saving doesn't add more.</>
          )}
        </p>
        {first.kind === "failed" && (
          <p className="muted small">
            Couldn't load the first day. {failureText(first.error, "Check your connection.")}
          </p>
        )}
      </div>
    </>
  );
}
