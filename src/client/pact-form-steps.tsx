// The steps that fill in a pact's terms: Goal, Schedule, Penalty, Reviewers
// and Reminders, and the problems that stop the owner leaving one. Create
// pact shows them in turn; Request change opens each in a sheet; the pact
// page's own Add a reviewer reuses the Reviewers step.

import { useEffect, useState, type ReactNode } from "react";
import {
  MAX_NAME_CHARS,
  MAX_TEXT_CHARS,
  MAX_WEEKLY_TARGET,
  WEEKDAYS,
  type AnkiDeck,
  type EditPactRefusal,
  type EvidenceKind,
  type Friend,
  type Recipient,
  type Schedule,
  type ThisWeek,
  type Weekday,
  type WeekStarts,
  type WeekStartsRequest,
} from "../shared/types.ts";
import { addDays } from "../shared/calendar.ts";
import { isBedtimeKind } from "../shared/evidence-kinds.ts";
import { isOncePerPeriod, lastDayOf, type OncePerPeriodKind } from "../shared/schedules.ts";
import { api, failureText, TEXT_TOO_LONG_TEXT } from "./api.ts";
import {
  clockText,
  dateIn,
  dateSpan,
  EDIT_WINDOW_TEXT,
  formatDate,
  inBedByName,
  initial,
  monthDay,
  NIGHT_CLOSES_TEXT,
  periodName,
} from "./format.ts";
import { optionalTimes, remindersAs, scheduleKindOf, termsOfFormKind, type Form } from "./pact-form.ts";
import { REMINDER_PROBLEMS, RemindersStep } from "./reminders-step.tsx";
import { plural } from "./vacation-text.ts";
import { loadFailure, loadedData, useLoad, useSend } from "./ui.tsx";

/** The Schedule step's "How often?" list: each kind of schedule in plain words, with an example. */
const PRESETS: { kind: Schedule["kind"]; name: string; example: string }[] = [
  { kind: "fixed-days", name: "Set days of the week", example: "e.g. Mon, Wed, Fri" },
  { kind: "weekly-count", name: "Some days each week", example: "e.g. 3× a week, any days" },
  { kind: "every-2-weeks", name: "Every 2 weeks", example: "Any day in the 2 weeks" },
  { kind: "once-a-month", name: "Once a month", example: "Any day in the month" },
  { kind: "one-time", name: "Once, by a deadline", example: "One photo, one date" },
];

/** The steps that fill in the pact's terms: Request change opens each of them on its own. */
export type FormStep = "goal" | "schedule" | "penalty" | "reviewers" | "reminders";

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

/**
 * What's wrong, in the owner's words: the core's refusals at Create or Save,
 * and the steps' own checks that a field is filled in.
 */
export type Problem =
  EditPactRefusal | "no-deadline" | "no-first-period" | "no-amount" | "no-recipient" | "anki-due-by";

export const PROBLEMS: Record<Problem, string> = {
  "oura-not-connected": "Connect your Oura Ring first.",
  "anki-not-connected": "Connect AnkiWeb first.",
  "unknown-deck": "Pick a deck.",
  "anki-due-by": "Pick a time from noon until your Anki day ends, or turn off Due by a set time.",
  "invalid-in-bed-by": "Pick a time.",
  "blank-name": "Give it a name.",
  "blank-description": "Say what your photo will show.",
  "text-too-long": TEXT_TOO_LONG_TEXT,
  "no-days": "Pick at least one day.",
  "no-deadline": "Pick a deadline.",
  "no-first-period": "Pick when to start. If the dates didn't load, go Back and try again.",
  "deadline-too-soon": "The deadline must be at least an hour after you create the pact. Pick a later one.",
  "invalid-schedule": `Pick from 1 to ${MAX_WEEKLY_TARGET} days a week.`,
  "invalid-due-by": "Pick a time before midnight, or turn off Due by a set time.",
  "invalid-start-date": "Pick a start date, or clear it.",
  "invalid-end-date": "Pick an end date, or clear it.",
  "end-date-too-early": "The end date is before the first day. Pick a later one.",
  "start-not-monday": "A weekly pact starts on a Monday. Pick a week.",
  "week-too-short": "There aren't enough days left this week. Pick next week.",
  ...REMINDER_PROBLEMS,
  "no-amount": "Enter an amount, like 5 or 2.50.",
  "invalid-penalty": "Set a penalty above $0.",
  "no-recipient": "Pick a recipient.",
  "unknown-recipient": "That recipient isn't on your list. Pick another.",
  "no-reviewers": "Pick at least one reviewer.",
  "not-a-friend": "Only friends can be reviewers.",
  "pact-not-found": "This pact wasn't found.",
  "edit-window-closed": `The ${EDIT_WINDOW_TEXT} for editing are over. To change the pact now, use Request change on its page.`,
  "evidence-kind-fixed": "A pact's evidence kind can't change.",
};

/** A problem in the owner's words; a due-by time an Anki pact refuses says what an Anki pact takes. */
export function problemText(problem: Problem, form: Pick<Form, "kind">): string {
  return PROBLEMS[problem === "invalid-due-by" && form.kind === "anki" ? "anki-due-by" : problem];
}

/** The friends and recipients the form's steps pick from, as `usePactFormLists` loads them. */
export interface PactFormLists {
  /** Null until loaded (or if loading failed). */
  friends: Friend[] | null;
  recipients: Recipient[] | null;
  /** Why a list didn't load, so the step says so rather than looking empty. */
  failed: { error: unknown } | null;
  /** Check again for friends, after inviting one. */
  reloadFriends: () => void;
  /** A recipient just saved from the Penalty step joins the list. */
  addRecipient: (recipient: Recipient) => void;
}

/** Loads the friends and recipients once, on mount. `onRecipients` sees the recipients when they arrive. */
export function usePactFormLists(onRecipients?: (list: Recipient[]) => void): PactFormLists {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [failed, setFailed] = useState<{ error: unknown } | null>(null);
  const reloadFriends = () => void api.friends().then(setFriends, (error: unknown) => setFailed({ error }));
  useEffect(() => {
    reloadFriends();
    api.recipients().then(
      (list) => {
        setRecipients(list);
        onRecipients?.(list);
      },
      (error: unknown) => setFailed({ error }),
    );
  }, []);
  const addRecipient = (recipient: Recipient) => setRecipients((list) => [...(list ?? []), recipient]);
  return { friends, recipients, failed, reloadFriends, addRecipient };
}

/** "Some of this couldn't load", and why: above a step whose lists didn't all load. */
export function ListsFailed({ failed }: { failed: { error: unknown } }) {
  return (
    <p className="error">
      Some of this couldn't load. {failureText(failed.error, "Check your connection and reopen Pact.")}
    </p>
  );
}

/**
 * One of the steps that fill in the pact's terms, as Create pact shows it in
 * turn and Request change in a sheet. `kindFixed`: the kind of schedule
 * can't change. `hints` say what changing the reviewers or reminders does.
 * `weekStartsFor`: the pact being edited or changed, if any, whose first week
 * or period is worked out from when it was made.
 */
export function PactFormStep({
  step,
  form,
  update,
  lists,
  onInvite,
  kindFixed,
  weekStartsFor = {},
  hints = {},
}: {
  step: FormStep;
  form: Form;
  update: (change: Partial<Form>) => void;
  lists: PactFormLists;
  onInvite: () => void;
  kindFixed?: boolean;
  weekStartsFor?: WeekStartsFor;
  hints?: { reviewers?: string; reminders?: string };
}) {
  switch (step) {
    case "goal":
      return <GoalStep form={form} update={update} />;
    case "schedule":
      return <ScheduleStep form={form} update={update} kindFixed={kindFixed} weekStartsFor={weekStartsFor} />;
    case "penalty":
      return (
        <PenaltyStep
          form={form}
          update={update}
          recipients={lists.recipients}
          onAdded={(recipient) => {
            lists.addRecipient(recipient);
            update({ recipientId: recipient.id });
          }}
        />
      );
    case "reviewers":
      return (
        <ReviewersStep
          friends={lists.friends}
          reviewerIds={form.reviewerIds}
          onReviewerIds={(reviewerIds) => update({ reviewerIds })}
          kind={form.kind}
          hint={hints.reviewers}
          onInvite={onInvite}
          onCheckAgain={lists.reloadFriends}
        />
      );
    case "reminders":
      return <RemindersStep form={form} onReminders={(reminders) => update({ reminders })} hint={hints.reminders} />;
  }
}

function GoalStep({ form, update }: { form: Form; update: (change: Partial<Form>) => void }) {
  if (form.kind === "anki") return <AnkiGoalStep form={form} update={update} />;
  if (isBedtimeKind(form.kind)) {
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
          <small>If your ring shows you got into bed after this time, the night is missed.</small>
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
          maxLength={MAX_TEXT_CHARS}
          value={form.description}
          placeholder="e.g. Me at the gym with the equipment visible"
          onChange={(e) => update({ description: e.target.value })}
        />
        <small>Reviewers see this when they check your photo.</small>
      </label>
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
            ? "AnkiWeb rejected Pact's sign-in. Reconnect AnkiWeb in Profile."
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
                ...(!form.named && { name: deckLeaf(deck.name).slice(0, MAX_NAME_CHARS) }),
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
        <small>Cards in subdecks count toward the parent deck, as in Anki.</small>
      </div>
      {picked && (
        <div className="card">
          <b>{picked.name} today</b>
          <div>
            <span className="leftbig">{left(picked)}</span>{" "}
            <span className="muted">{left(picked) === 1 ? "card" : "cards"} left</span>
          </div>
          <p className="small muted">The deck is finished when New, Learn and Due are all 0.</p>
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
        maxLength={MAX_NAME_CHARS}
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

function ScheduleStep({
  form,
  update,
  kindFixed = false,
  weekStartsFor,
}: {
  form: Form;
  update: (change: Partial<Form>) => void;
  /** After the edit window, the kind of schedule can't change: only the chosen one shows. */
  kindFixed?: boolean;
  weekStartsFor: WeekStartsFor;
}) {
  const { days } = form;
  const bedtime = isBedtimeKind(form.kind);
  const anki = form.kind === "anki";
  const scheduleKind = scheduleKindOf(form);
  const weekly = scheduleKind === "weekly-count";
  const oneTime = scheduleKind === "one-time";
  const schedule = { kind: scheduleKind };
  const periodKind = isOncePerPeriod(schedule) ? schedule.kind : null;
  const pick = (kind: Schedule["kind"]) =>
    update({
      scheduleKind: kind,
      reminders: remindersAs(form, kind),
      // A start date on these is the first period's, picked again for the new kind.
      ...((isOncePerPeriod({ kind }) || periodKind) && { startDate: "", firstPeriodPicked: false }),
    });
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
        <div className="field">
          <span>How often?</span>
          <div className="stack" role="radiogroup" aria-label="How often?">
            {PRESETS.map(({ kind, name, example }) => (
              <label key={kind} className="opt">
                <input type="radio" name="how-often" checked={scheduleKind === kind} onChange={() => pick(kind)} />
                <span className="rt">
                  <b>{name}</b>
                  <small>{example}</small>
                </span>
              </label>
            ))}
          </div>
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
      ) : periodKind ? (
        !kindFixed && (
          <FirstPeriodChoice
            key={periodKind}
            kind={periodKind}
            form={form}
            update={update}
            editing={weekStartsFor.editing}
          />
        )
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
            Pick any days, with one photo per day. When the week ends, you pay one penalty for each day you're short.
          </small>
        </>
      ) : (
        <>
          <div className="field">
            <span>{bedtime ? "Nights" : "Days"}</span>
            <div className="days" role="group" aria-label={bedtime ? "Nights" : "Days"}>
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
            {bedtime ? "Every night" : "Every day"}
          </button>
        </>
      )}
      <small className="muted">
        {bedtime
          ? `Pact checks each night when your ring syncs. If there's no sleep data by ${NIGHT_CLOSES_TEXT} the next day, the night is missed.`
          : anki
            ? `Finish the deck and sync before ${until}. If AnkiWeb doesn't show the deck finished by then, the day is missed.`
            : oneTime
              ? form.submitAnytime
                ? `You can submit your photo any day until ${until} on the deadline date.`
                : `You can submit your photo only on the deadline date, until ${until}.`
              : periodKind === "once-a-month"
                ? `Take one photo on any day of the month, until ${until} that day. If the month ends without one, you pay the penalty.`
                : periodKind === "every-2-weeks"
                  ? `Take one photo on any day of the 2 weeks, until ${until} that day. If they end without one, you pay the penalty.`
                  : weekly
                    ? `You can submit a photo on any day of the week, until ${until} that day.`
                    : `You can submit a photo only on the days you picked, until ${until}.`}
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
                  Pick a time from noon until your Anki day ends, usually 4:00am. A time after midnight means early the
                  next morning.
                </small>
              )}
            </label>
          )}
        </>
      )}
      {oneTime ? (
        <OneTimeWindow form={form} update={update} />
      ) : (
        <DateRange form={form} update={update} kind={scheduleKind} weekStartsFor={weekStartsFor} />
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
        The deadline must be at least an hour after you create the pact. Pact checks it once at the deadline.
      </small>
    </>
  );
}

/**
 * Which pact the Schedule step's first week or period choice is for: a new
 * one, one `editing` in its window, or one a change request is `changing`.
 */
export type WeekStartsFor = Pick<WeekStartsRequest, "editing" | "changing">;

/**
 * A recurring pact's optional start and end dates. A Weekly count pact picks
 * its first week instead, and Every 2 weeks and Once a month their first period.
 */
function DateRange({
  form,
  update,
  kind,
  weekStartsFor,
}: {
  form: Form;
  update: (change: Partial<Form>) => void;
  kind: Schedule["kind"];
  weekStartsFor: WeekStartsFor;
}) {
  // A start date before today would change nothing. On this device's clock: the form has no profile timezone.
  const today = dateIn(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  const endField = (
    <label className="field">
      <span>End (optional)</span>
      <input
        className="inp"
        type="date"
        value={form.endDate}
        min={form.startDate || today}
        onChange={(e) => update({ endDate: e.target.value })}
      />
    </label>
  );
  if (kind === "weekly-count") {
    return <WeekStartField form={form} update={update} weekStartsFor={weekStartsFor} endField={endField} />;
  }
  if (isOncePerPeriod({ kind })) {
    return (
      <>
        <div className="dates">{endField}</div>
        <small className="muted">
          Only whole {kind === "once-a-month" ? "months" : "2 weeks"} up to the end date count.
        </small>
      </>
    );
  }
  return (
    <div className="dates">
      <label className="field">
        <span>Start (optional)</span>
        <input
          className="inp"
          type="date"
          value={form.startDate}
          min={today}
          onChange={(e) => update({ startDate: e.target.value })}
        />
      </label>
      {endField}
    </div>
  );
}

/** "the whole week", or "4 days left (Thu–Sun)": the days of this week left for a photo. */
export function daysLeftText(daysLeft: number, monday: string): string {
  if (daysLeft === WEEKDAYS.length) return "the whole week";
  const first = formatDate(addDays(monday, WEEKDAYS.length - daysLeft)).slice(0, 3);
  return `${plural(daysLeft, "day", "days")} left (${daysLeft === 1 ? first : `${first}–Sun`})`;
}

/** Why this week can't be a Weekly count pact's first: "Only 2 days left, fewer than 3×." */
function notOfferedText(thisWeek: Extract<ThisWeek, { offered: false }>, target: number): string {
  if (thisWeek.reason === "ends-within-an-hour") return "The week ends in less than an hour.";
  const { daysLeft } = thisWeek;
  return `Only ${plural(daysLeft, "day", "days")} left, fewer than ${target}×.`;
}

/** A week as its option names it: "Nov 23 – 29". */
function weekSpan(monday: string): string {
  return dateSpan(monday, addDays(monday, WEEKDAYS.length - 1));
}

/**
 * A Weekly count pact's first week, as the core offers it (`WeekStarts`):
 * this week, next week or a later Monday, then the end date with the last
 * whole week it gives. Until the owner picks, the core's default is picked
 * and no start date is sent. A change request has no this week, and nothing
 * picked until the owner picks.
 */
function WeekStartField({
  form,
  update,
  weekStartsFor,
  endField,
}: {
  form: Form;
  update: (change: Partial<Form>) => void;
  weekStartsFor: WeekStartsFor;
  endField: ReactNode;
}) {
  const { dueBy, endDate } = optionalTimes(form);
  const request: WeekStartsRequest = {
    target: form.target,
    ...(dueBy !== undefined && { dueBy }),
    ...(endDate !== undefined && { endDate }),
    ...weekStartsFor,
  };
  const key = JSON.stringify(request);
  const [starts, setStarts] = useState<{ key: string; answer: WeekStarts | { failed: unknown } } | null>(null);
  useEffect(() => {
    let current = true;
    const show = (answer: WeekStarts | { failed: unknown }) => {
      if (current) setStarts({ key, answer });
    };
    api.weekStarts(JSON.parse(key) as WeekStartsRequest).then(
      (result) => show(result.ok ? result.weekStarts : { failed: new Error(result.reason) }),
      (error: unknown) => show({ failed: error }),
    );
    return () => {
      current = false;
    };
  }, [key]);
  const loaded = starts !== null && !("failed" in starts.answer) ? starts.answer : null;
  const thisWeek = loaded?.thisWeek ?? null;
  // This week picked, then made too short by a higher target or a due-by time: back to the default.
  const tooShort = thisWeek !== null && !thisWeek.offered && form.startDate === thisWeek.monday;
  useEffect(() => {
    if (tooShort) update({ startDate: "" });
  }, [tooShort, update]);

  const field = (body: ReactNode) => (
    <>
      <div className="field">
        <span>Starts</span>
        {body}
      </div>
      {endField}
      {loaded?.lastWeek && <small className="muted">Last week: {weekSpan(loaded.lastWeek)}.</small>}
      <small className="muted">Only full Monday–Sunday weeks up to the end date count.</small>
    </>
  );
  if (starts === null) return field(<small className="muted">Loading the weeks…</small>);
  if (loaded === null) {
    const { failed } = starts.answer as { failed: unknown };
    return field(
      <small className="muted">Couldn't load the weeks. {failureText(failed, "Check your connection.")}</small>,
    );
  }
  const [next, ...later] = loaded.mondays as [string, ...string[]];
  const chosen = form.startDate !== "" ? form.startDate : thisWeek === null ? "" : loaded.defaultMonday;
  const laterChosen = chosen !== "" && chosen !== thisWeek?.monday && chosen !== next;
  // A start date the list doesn't have, such as one stored before they had to be Mondays, stays listed.
  const laterMondays = laterChosen && !later.includes(chosen) ? [chosen, ...later] : later;
  const pick = (monday: string) => update({ startDate: monday });
  const target = `${form.target}×`;
  return field(
    <div className="stack">
      {thisWeek && (
        <label className="opt" aria-disabled={!thisWeek.offered || undefined}>
          <input
            type="radio"
            name="week-start"
            checked={chosen === thisWeek.monday}
            disabled={!thisWeek.offered}
            onChange={() => pick(thisWeek.monday)}
          />
          <span className="rt">
            <b>This week · {weekSpan(thisWeek.monday)}</b>
            <small>
              {thisWeek.offered
                ? `${target} by Sunday, with ${daysLeftText(thisWeek.daysLeft, thisWeek.monday)}`
                : notOfferedText(thisWeek, form.target)}
            </small>
          </span>
        </label>
      )}
      <label className="opt">
        <input type="radio" name="week-start" checked={chosen === next} onChange={() => pick(next)} />
        <span className="rt">
          <b>Next week · {weekSpan(next)}</b>
          <small>
            {target} by {formatDate(addDays(next, WEEKDAYS.length - 1))}
          </small>
        </span>
      </label>
      <label className="opt">
        <input type="radio" name="week-start" checked={laterChosen} onChange={() => pick(laterMondays[0]!)} />
        <span className="rt">
          <b>A later week</b>
          {!laterChosen && <small>Pick the Monday it starts</small>}
        </span>
      </label>
      {laterChosen && (
        <select className="inp" aria-label="Monday it starts" value={chosen} onChange={(e) => pick(e.target.value)}>
          {laterMondays.map((monday) => (
            <option key={monday} value={monday}>
              {formatDate(monday)} · {weekSpan(monday)}
            </option>
          ))}
        </select>
      )}
    </div>,
  );
}

/**
 * Every 2 weeks and Once a month: whether the first period is this one or
 * the next, as the core offers them. This one is picked to start with when
 * it has 7 days left, counting today, and isn't offered when it's due within
 * the hour.
 */
function FirstPeriodChoice({
  kind,
  form,
  update,
  editing,
}: {
  kind: OncePerPeriodKind;
  form: Form;
  update: (change: Partial<Form>) => void;
  editing?: string;
}) {
  const schedule = { kind };
  const { state } = useLoad(() => api.firstOccurrence({ schedule, evidenceKind: "camera", editing }));
  const result = loadedData(state);
  const offered = result?.ok ? result.offered : undefined;
  const daysLeft = offered?.current?.daysLeft ?? 0;
  useEffect(() => {
    if (offered && !form.firstPeriodPicked) {
      update({ startDate: daysLeft >= 7 ? "" : offered.next.date, firstPeriodPicked: true });
    }
  }, [offered]);
  const failed = loadFailure(state);
  const label = kind === "once-a-month" ? "First month" : "First 2 weeks";
  if (!offered) {
    return (
      <div className="field">
        <span>{label}</span>
        <small className="muted">
          {failed ? `Couldn't load the dates. ${failureText(failed.error, "Check your connection.")}` : "Loading…"}
        </small>
      </div>
    );
  }
  const pickNext = (next: boolean) => update({ startDate: next ? offered.next.date : "", firstPeriodPicked: true });
  const option = (next: boolean, date: string, note: string) => (
    <label className="opt">
      <input
        type="radio"
        name="first-period"
        checked={(form.startDate !== "") === next}
        onChange={() => pickNext(next)}
      />
      <span className="rt">
        <b>{kind === "every-2-weeks" ? (next ? "Next week" : "This week") : periodName(kind, date)}</b>
        <small>{note}</small>
      </span>
    </label>
  );
  const { current, next } = offered;
  return (
    <div className="field">
      <span>{label}</span>
      <div className="stack" role="radiogroup" aria-label={label}>
        {current &&
          option(
            false,
            current.date,
            `Due by ${formatDate(lastDayOf(schedule, current.date))} · ${plural(daysLeft, "day", "days")}, counting today`,
          )}
        {option(true, next.date, `${monthDay(next.date)} to ${formatDate(lastDayOf(schedule, next.date))}`)}
      </div>
    </div>
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
        <small>The person or organization you pay when you miss.</small>
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
      if (!result.ok) return result.reason === "text-too-long" ? TEXT_TOO_LONG_TEXT : "Enter a name.";
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
          maxLength={MAX_NAME_CHARS}
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
            Only friends can review your pacts. Invite a friend, and they'll appear here after they accept.
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
            ? "Your ring decides each night, so there are no photos to review. Reviewers decide on your excuses, change requests, and payments."
            : kind === "anki"
              ? "AnkiWeb decides each day, so there's nothing to review. Reviewers decide on your excuses, change requests, and payments."
              : "One of your reviewers must approve each photo. Reviewers also decide on your excuses, change requests, and payments.")}
      </small>
    </>
  );
}
