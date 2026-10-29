// The step-by-step create-pact form: evidence kind, goal, schedule, penalty,
// reviewers, then a check before Create pact. The core decides every rule;
// the steps only stop the owner moving on with a field left empty.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { WEEKDAYS, type CreatePactRefusal, type FirstOccurrence, type Friend, type Recipient, type Weekday } from "../shared/types.ts";
import type { Json } from "../shared/api.ts";
import { api } from "./api.ts";
import { formatDate, initial } from "./format.ts";
import { CameraIcon, RingIcon } from "./icons.tsx";
import { TermsList } from "./PactPage.tsx";

const STEPS = ["kind", "goal", "schedule", "penalty", "reviewers", "check"] as const;
type Step = (typeof STEPS)[number];

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

/**
 * What's wrong, in the owner's words: the core's refusals at Create, and the
 * steps' own checks that a field is filled in.
 */
type Problem = CreatePactRefusal | "no-amount" | "no-recipient";

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
};

/** Dollars as typed ("5", "$2.50") in whole cents, or null when it isn't an amount. */
function parseCents(text: string): number | null {
  const match = /^\$?\s*(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

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

export function CreatePact({
  onCancel,
  onCreated,
  onInvite,
}: {
  onCancel: () => void;
  onCreated: (pactId: string, name: string) => void;
  onInvite: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [tried, setTried] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  const step = STEPS[stepIndex]!;
  const problem = stepProblem(step, form);
  const update = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }));

  const loadFriends = () => api.friends().then(setFriends, () => setLoadFailed(true));
  useEffect(() => {
    void loadFriends();
    api.recipients().then(setRecipients, () => setLoadFailed(true));
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
      const result = await api.createPact({
        evidenceKind: "camera",
        name: form.name.trim(),
        description: form.description.trim(),
        schedule: { kind: "fixed-days", days: form.days },
        penaltyCents,
        recipientId,
        reviewerIds: form.reviewerIds,
      });
      if (result.ok) return onCreated(result.pactId, form.name.trim());
      setCreateError(PROBLEMS[result.reason]);
    } catch {
      setCreateError("Couldn't create it. Check your connection and try again.");
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
          friends={friends}
          recipients={recipients}
          onAdded={(recipient) => {
            // Adding a friend who's already a recipient gives back that recipient.
            setRecipients((list) =>
              list?.some((r) => r.id === recipient.id) ? list : [...(list ?? []), recipient],
            );
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
      body = <CheckStep form={form} friends={friends ?? []} recipients={recipients ?? []} />;
      break;
  }

  return (
    <>
      <div className="stack" ref={top}>
        <div className="steps" aria-hidden="true">
          {STEPS.map((s, i) => (
            <i key={s} className={i <= stepIndex ? "on" : undefined} />
          ))}
        </div>
        <small className="muted">
          Step {stepIndex + 1} of {STEPS.length}
        </small>
      </div>
      {loadFailed && <p className="error">Some of this couldn't load. Check your connection and reopen Pact.</p>}
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
            Create pact
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
        <input className="inp" value={form.name} placeholder="e.g. Gym" onChange={(e) => update({ name: e.target.value })} />
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
            <button key={day} aria-pressed={days.includes(day)} aria-label={DAY_BUTTONS[day].full} onClick={() => toggle(day)}>
              {DAY_BUTTONS[day].short}
            </button>
          ))}
        </div>
      </div>
      <button className="btn sm self-start" aria-pressed={everyDay} onClick={() => onDays(everyDay ? [] : [...WEEKDAYS])}>
        Every day
      </button>
      <small className="muted">You can submit on scheduled days only, until midnight.</small>
    </>
  );
}

function PenaltyStep({
  form,
  update,
  friends,
  recipients,
  onAdded,
}: {
  form: Form;
  update: (change: Partial<Form>) => void;
  friends: Friend[] | null;
  recipients: Recipient[] | null;
  onAdded: (recipient: Recipient) => void;
}) {
  const [adding, setAdding] = useState<"person" | "organization" | null>(null);

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
        {recipients?.length === 0 && <small>No recipients yet. Add one below.</small>}
        {recipients?.map((r) => (
          <button key={r.id} className="opt" aria-pressed={form.recipientId === r.id} onClick={() => update({ recipientId: r.id })}>
            <span className="glyph" aria-hidden="true">
              {initial(r.name)}
            </span>
            <span className="rt">
              <b>{r.name}</b>
              <small>{r.kind === "organization" ? r.link : "A friend"}</small>
            </span>
          </button>
        ))}
        {adding === null ? (
          <div className="row2">
            {friends !== null && friends.length > 0 && (
              <button className="link" onClick={() => setAdding("person")}>
                Add a person
              </button>
            )}
            <button className="link" onClick={() => setAdding("organization")}>
              Add an organization
            </button>
          </div>
        ) : (
          <AddRecipient
            kind={adding}
            friends={friends ?? []}
            onAdded={(recipient) => {
              setAdding(null);
              onAdded(recipient);
            }}
            onCancel={() => setAdding(null)}
          />
        )}
      </div>
    </>
  );
}

function AddRecipient({
  kind,
  friends,
  onAdded,
  onCancel,
}: {
  kind: "person" | "organization";
  friends: Friend[];
  onAdded: (recipient: Recipient) => void;
  onCancel: () => void;
}) {
  const [friendId, setFriendId] = useState(friends[0]?.id ?? "");
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = kind === "person" ? friendId !== "" : name.trim() !== "" && link.trim() !== "";
  const add = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await api.addRecipient(
        kind === "person" ? { kind, friendId } : { kind, name: name.trim(), link: link.trim() },
      );
      if (result.ok) return onAdded(result.recipient);
      setError(result.reason === "not-a-friend" ? "You can only add a friend." : "Enter a name and a link starting with https://.");
    } catch {
      setError("Couldn't add it. Check your connection and try again.");
    }
    setSaving(false);
  };

  return (
    <div className="card">
      {kind === "person" ? (
        <label className="field">
          <span>Friend</span>
          <select className="inp" value={friendId} onChange={(e) => setFriendId(e.target.value)}>
            {friends.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="field">
            <span>Organization</span>
            <input className="inp" value={name} placeholder="e.g. City Food Bank" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Link</span>
            <input
              className="inp"
              type="url"
              inputMode="url"
              value={link}
              placeholder="https://"
              onChange={(e) => setLink(e.target.value)}
            />
            <small>Where you'll pay them, like a donation page.</small>
          </label>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row2">
        <button className="btn sm primary" disabled={!ready || saving} onClick={() => void add()}>
          Add
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
          <p className="muted">Only friends can review your pacts. Invite one, and they show up here once they accept.</p>
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

type FirstState = { kind: "loading" } | { kind: "loaded"; first: Json<FirstOccurrence> } | { kind: "failed" };

/** How often the Check step asks again, so the day it names stays the one Create would store. */
const FIRST_OCCURRENCE_REFRESH_MS = 60_000;

function CheckStep({ form, friends, recipients }: { form: Form; friends: Friend[]; recipients: Recipient[] }) {
  const [first, setFirst] = useState<FirstState>({ kind: "loading" });
  const days = form.days;

  useEffect(() => {
    let current = true;
    const show = (state: FirstState) => {
      if (current) setFirst(state);
    };
    const load = () =>
      api.firstOccurrence({ schedule: { kind: "fixed-days", days } }).then(
        (result) => show(result.ok ? { kind: "loaded", first: result.firstOccurrence } : { kind: "failed" }),
        () => show({ kind: "failed" }),
      );
    void load();
    const timer = window.setInterval(() => void load(), FIRST_OCCURRENCE_REFRESH_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [days]);

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
              evidenceKind: "camera",
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
          It's Active as soon as you create it.
          {first.kind === "loaded" && (
            <>
              {" "}
              The first one is <b>{formatDate(first.first.date)}</b>, due midnight.
            </>
          )}
        </p>
        {first.kind === "failed" && <p className="muted small">Couldn't load the first day. Check your connection.</p>}
      </div>
    </>
  );
}
