// The step-by-step pact form: evidence kind, goal, schedule, penalty, reviewers,
// then a check before Create pact. Editing a pact in its edit window reuses it
// without the evidence kind step. The core decides every rule; the steps only
// stop the owner moving on with a field left empty.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  WEEKDAYS,
  type EditPactRefusal,
  type FirstOccurrence,
  type Friend,
  type PactTerms,
  type Recipient,
  type Weekday,
} from "../shared/types.ts";
import type { Json } from "../shared/api.ts";
import { api, failureText } from "./api.ts";
import { centsInputText, clockTime, formatDate, initial, minutesLeft, parseCents } from "./format.ts";
import { CameraIcon, RingIcon } from "./icons.tsx";
import { TermsList } from "./PactPage.tsx";
import { Empty, useLoad, useNow } from "./ui.tsx";

const STEPS = ["kind", "goal", "schedule", "penalty", "reviewers", "check"] as const;
type Step = (typeof STEPS)[number];
/** A pact's evidence kind never changes, so editing skips that step. */
const EDIT_STEPS = STEPS.slice(1);

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
  name: string;
  description: string;
  days: Weekday[];
  /** As typed, in dollars: "5" or "2.50". */
  penalty: string;
  recipientId: string | null;
  reviewerIds: string[];
}

const EMPTY_FORM: Form = { name: "", description: "", days: [], penalty: "", recipientId: null, reviewerIds: [] };

function formOf(pact: Pact): Form {
  return {
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
type Problem = EditPactRefusal | "no-amount" | "no-recipient";

const PROBLEMS: Record<Problem, string> = {
  "evidence-kind-unavailable": "Oura Ring pacts aren't available yet.",
  "blank-name": "Give it a name.",
  "blank-description": "Say what your photo will show.",
  "no-days": "Pick at least one day.",
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

/** A field left empty (or an amount that isn't one) stops the owner leaving a step. The core judges the rest at Create. */
function stepProblem(step: Step, form: Form): Problem | null {
  switch (step) {
    case "goal":
      if (form.name.trim() === "") return "blank-name";
      if (form.description.trim() === "") return "blank-description";
      return null;
    case "schedule":
      return form.days.length === 0 ? "no-days" : null;
    case "penalty":
      if (parseCents(form.penalty) === null) return "no-amount";
      return form.recipientId === null ? "no-recipient" : null;
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
  return <CreatePact editing={data.pact} onCancel={onDone} onCreated={onDone} onInvite={onInvite} />;
}

/** The form, for a new pact or for `editing`. */
export function CreatePact({
  editing,
  onCancel,
  onCreated,
  onInvite,
}: {
  editing?: Pact;
  onCancel: () => void;
  /** After creating the pact, or saving the edit. */
  onCreated: (pactId: string, name: string) => void;
  onInvite: () => void;
}) {
  const steps = editing ? EDIT_STEPS : STEPS;
  const now = useNow();
  const [windowClosed, setWindowClosed] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<Form>(editing ? formOf(editing) : EMPTY_FORM);
  const [tried, setTried] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [loadFailed, setLoadFailed] = useState<{ error: unknown } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
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
        evidenceKind: editing?.evidenceKind ?? "camera",
        name: form.name.trim(),
        description: form.description.trim(),
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
      body = <KindStep onCamera={() => goTo(1)} />;
      break;
    case "goal":
      body = <GoalStep form={form} update={update} />;
      break;
    case "schedule":
      body = <ScheduleStep days={form.days} onDays={(days) => update({ days })} />;
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

function KindStep({ onCamera }: { onCamera: () => void }) {
  return (
    <>
      <h2>How will you prove it?</h2>
      <div className="kind-tiles">
        <button className="kind-tile" onClick={onCamera}>
          <span className="tico">
            <CameraIcon />
          </span>
          <b>Camera</b>
          <small>Take a photo each time. Your reviewer checks it.</small>
        </button>
        <button className="kind-tile" disabled>
          <span className="tico">
            <RingIcon />
          </span>
          <b>Oura Ring</b>
          <small>Your ring reports when you got into bed. Nothing to submit.</small>
          <span className="chip c-soon">Not available yet</span>
        </button>
      </div>
      <small className="muted">You can't change this later.</small>
    </>
  );
}

function GoalStep({ form, update }: { form: Form; update: (change: Partial<Form>) => void }) {
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

function ScheduleStep({ days, onDays }: { days: Weekday[]; onDays: (days: Weekday[]) => void }) {
  const everyDay = days.length === WEEKDAYS.length;
  // Kept in week order, Monday first.
  const toggle = (day: Weekday) => onDays(WEEKDAYS.filter((d) => (d === day ? !days.includes(d) : days.includes(d))));
  return (
    <>
      <h2>Schedule</h2>
      <div className="field">
        <span>Days</span>
        <div className="days" role="group" aria-label="Days">
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
        Every day
      </button>
      <small className="muted">You can submit on scheduled days only, until midnight.</small>
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
  onInvite,
  onCheckAgain,
}: {
  friends: Friend[] | null;
  reviewerIds: string[];
  onReviewerIds: (ids: string[]) => void;
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
      <small className="muted">Any reviewer you pick can check your photos.</small>
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

  useEffect(() => {
    let current = true;
    const show = (state: FirstState) => {
      if (current) setFirst(state);
    };
    const load = () =>
      api.firstOccurrence({ schedule: { kind: "fixed-days", days }, editing: editing?.id }).then(
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
  }, [days, editing?.id]);

  const recipient = recipients.find((r) => r.id === form.recipientId);
  return (
    <>
      <h2>Check it over</h2>
      <div className="card">
        <h3>{form.name.trim()}</h3>
        <p className="muted">{form.description.trim()}</p>
        {recipient && (
          <TermsList
            terms={{
              evidenceKind: editing?.evidenceKind ?? "camera",
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
              The first one is <b>{formatDate(first.first.date)}</b>, due midnight.
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
