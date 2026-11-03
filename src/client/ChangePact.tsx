// Request change, pushed from a pact's page after its edit window: the
// pact's terms on one Check list, each with Change, which opens just that
// step of the create form in a sheet. A changed row shows the old value
// struck out and what it needs. Under the list, the core's verdict on the
// whole change, an optional "Why?" when it needs approval, and Send or Apply.

import { useEffect, useState, type ReactNode } from "react";
import type { Json } from "../shared/api.ts";
import type {
  ChangePactRefusal,
  ChangePreview,
  CreatePactRefusal,
  Friend,
  PactChange,
  PactTerms,
  Recipient,
} from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import {
  changeValue,
  currentValue,
  effectText,
  listNames,
  openOccurrenceText,
  termLabel,
  termsOfKind,
  type Term,
} from "./change-terms.tsx";
import {
  formOf,
  GoalStep,
  optionalTimes,
  PenaltyStep,
  PROBLEMS,
  ReviewersStep,
  scheduleOf,
  ScheduleStep,
  type Form,
} from "./CreatePact.tsx";
import { formatDate, money, parseCents } from "./format.ts";
import { RemindersStep } from "./reminders-step.tsx";
import { Empty, Sheet, useLoad } from "./ui.tsx";

type Pact = Json<PactTerms>;
type Step = "goal" | "schedule" | "penalty" | "reviewers" | "reminders";

/** The create form's step each term is changed on. */
const STEP_OF: Record<Term, Step> = {
  name: "goal",
  description: "goal",
  "in-bed-by": "goal",
  schedule: "schedule",
  "due-by": "schedule",
  "start-date": "schedule",
  "end-date": "schedule",
  penalty: "penalty",
  recipient: "penalty",
  reviewers: "reviewers",
  reminders: "reminders",
};

const STEP_TITLES: Record<Step, string> = {
  goal: "Goal",
  schedule: "Schedule",
  penalty: "Penalty",
  reviewers: "Reviewers",
  reminders: "Reminders",
};

const REFUSALS: Record<Exclude<ChangePactRefusal, CreatePactRefusal>, string> = {
  "pact-not-found": "This pact wasn't found.",
  "edit-window-open": "It's still in its first 10 minutes. Edit it instead.",
  "pact-ended": "This pact has Ended.",
  "change-request-waiting":
    "A change request is waiting. Until it's decided or you withdraw it, only the name, reminders and new reviewers can change.",
  "pact-started": "It has already started, so the start date can't change.",
  "schedule-kind-fixed": "Fixed days and a weekly count can't be swapped now. Make a new pact for that.",
  "nothing-changed": "Nothing changed yet.",
};

function refusalText(reason: ChangePactRefusal | "no-amount" | "no-recipient"): string {
  return reason in REFUSALS
    ? REFUSALS[reason as keyof typeof REFUSALS]
    : PROBLEMS[reason as Exclude<typeof reason, keyof typeof REFUSALS>];
}

export function ChangePact({
  pactId,
  onDone,
  onInvite,
}: {
  pactId: string;
  /** After sending or applying: back to the pact. */
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
  return <ChangeForm pact={data.pact} onDone={onDone} onInvite={onInvite} />;
}

/** The form's terms as the core takes them, or what stops them being sent. */
function changeOf(form: Form, note: string): PactChange | { problem: "no-amount" | "no-recipient" } {
  const penaltyCents = parseCents(form.penalty);
  if (penaltyCents === null) return { problem: "no-amount" };
  if (form.recipientId === null) return { problem: "no-recipient" };
  return {
    name: form.name.trim(),
    description: form.kind === "oura" ? "" : form.description.trim(),
    ...(form.kind === "oura" && { inBedBy: form.inBedBy }),
    ...optionalTimes(form),
    schedule: scheduleOf(form),
    penaltyCents,
    recipientId: form.recipientId,
    reviewerIds: form.reviewerIds,
    reminders: form.reminders,
    ...(note.trim() !== "" && { note }),
  };
}

type Verdict =
  | { kind: "loading" }
  | { kind: "loaded"; preview: Json<ChangePreview> }
  | { kind: "refused"; text: string }
  | { kind: "failed"; error: unknown };

/** How long typing pauses before the verdict is asked for again. */
const PREVIEW_DELAY_MS = 250;

function ChangeForm({ pact, onDone, onInvite }: { pact: Pact; onDone: () => void; onInvite: () => void }) {
  const [form, setForm] = useState<Form>(() => formOf(pact));
  const [note, setNote] = useState("");
  const [step, setStep] = useState<Step | null>(null);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [verdict, setVerdict] = useState<Verdict>({ kind: "loading" });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const update = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }));

  const loadFriends = () => api.friends().then(setFriends, () => setFriends([]));
  useEffect(() => {
    void loadFriends();
    api.recipients().then(setRecipients, () => setRecipients([]));
  }, []);

  const change = changeOf(form, "");
  const key = JSON.stringify(change);
  useEffect(() => {
    if ("problem" in change) return setVerdict({ kind: "refused", text: refusalText(change.problem) });
    let current = true;
    const timer = window.setTimeout(() => {
      api.changePreview(pact.id, change).then(
        (result) => {
          if (!current) return;
          setVerdict(
            result.ok
              ? { kind: "loaded", preview: result.preview }
              : { kind: "refused", text: refusalText(result.reason) },
          );
        },
        (error: unknown) => current && setVerdict({ kind: "failed", error }),
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [key]);

  const send = async () => {
    const sent = changeOf(form, note);
    if ("problem" in sent) return;
    setSending(true);
    setSendError(null);
    try {
      const result = await api.changePact(pact.id, sent);
      if (result.ok) return onDone();
      setSendError(refusalText(result.reason));
    } catch (error) {
      setSendError(`Couldn't send it. ${failureText(error, "Check your connection and try again.")}`);
    }
    setSending(false);
  };

  const changes = verdict.kind === "loaded" ? verdict.preview.changes : [];
  const reviewerNames = pact.reviewers.map((r) => r.name);

  let sheet: ReactNode = null;
  if (step !== null) {
    let body: ReactNode;
    switch (step) {
      case "goal":
        body = <GoalStep form={form} update={update} />;
        break;
      case "schedule":
        body = <ScheduleStep form={form} update={update} kindFixed />;
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
            hint="Adding a reviewer applies at once. Removing one needs approval. There's always at least one."
            onInvite={onInvite}
            onCheckAgain={() => void loadFriends()}
          />
        );
        break;
      case "reminders":
        body = (
          <RemindersStep form={form} onReminders={(reminders) => update({ reminders })} hint="Changes apply at once." />
        );
        break;
    }
    sheet = (
      <Sheet title={STEP_TITLES[step]} onClose={() => setStep(null)}>
        <div className="stack step-in-sheet">{body}</div>
        <button className="btn primary block" onClick={() => setStep(null)}>
          Done
        </button>
      </Sheet>
    );
  }

  return (
    <>
      <p className="muted small">
        Change what you need, then send. Stricter changes apply on their own; anything looser goes to{" "}
        {listNames(reviewerNames)}.
      </p>
      <dl className="list term-list">
        {termsOfKind(pact).map((term) => {
          const changed = changes.find((c) => c.term === term);
          return (
            <div key={term} className={changed ? `termrow changed ${changed.effect}` : "termrow"}>
              <dt>{termLabel(term, pact.schedule)}</dt>
              <dd>
                {changed ? (
                  <>
                    <s>{changeValue(changed, "before")}</s>
                    {changeValue(changed, "after")}
                    <span className={`tagline t-${changed.effect}`}>{effectText(changed)}</span>
                  </>
                ) : (
                  currentValue(term, pact)
                )}
              </dd>
              <button className="btn sm" onClick={() => setStep(STEP_OF[term])}>
                Change
              </button>
            </div>
          );
        })}
      </dl>
      <VerdictBox verdict={verdict} pactName={pact.name} open={openOccurrenceText(pact.schedule)} />
      {verdict.kind === "loaded" && verdict.preview.outcome.kind === "needs-approval" && (
        <label className="field">
          <span>Why? (optional)</span>
          <textarea
            className="inp"
            value={note}
            placeholder="e.g. Money is tight this month"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      )}
      {sendError && <p className="error">{sendError}</p>}
      <button
        className="btn primary block"
        disabled={sending || verdict.kind !== "loaded" || verdict.preview.outcome.kind === "nothing"}
        onClick={() => void send()}
      >
        {buttonText(verdict)}
      </button>
      {sheet}
    </>
  );
}

function buttonText(verdict: Verdict): string {
  if (verdict.kind !== "loaded") return "Apply change";
  const { outcome } = verdict.preview;
  switch (outcome.kind) {
    case "nothing":
      return "Nothing to send";
    case "needs-approval":
      return `Send to ${listNames(outcome.reviewerNames)}`;
    default:
      return "Apply change";
  }
}

/** The core's verdict on the whole change, in words. */
/** `open` names the occurrence open now, which keeps its terms: "Today", or "This week". */
function VerdictBox({ verdict, pactName, open }: { verdict: Verdict; pactName: string; open: string }) {
  switch (verdict.kind) {
    case "loading":
      return <div className="verdict nothing">Checking the change…</div>;
    case "failed":
      return (
        <div className="verdict nothing">
          Couldn't check the change. {failureText(verdict.error, "Check your connection.")}
        </div>
      );
    case "refused":
      return <div className="verdict nothing">{verdict.text}</div>;
    case "loaded":
      break;
  }
  const { outcome, changes } = verdict.preview;
  // What applies now even inside a change that waits: the name, the reminders, and reviewers added.
  const now = [
    ...(changes.some((c) => c.term === "name") ? ["the name"] : []),
    ...(changes.some((c) => c.term === "reminders") ? ["the reminders"] : []),
    ...changes.flatMap((c) =>
      c.term === "reviewers" && c.added.length > 0
        ? [c.added.length === 1 ? "the new reviewer" : "the new reviewers"]
        : [],
    ),
  ];
  const nowLine =
    now.length > 0
      ? ` ${capitalize(listNames(now))} ${now.length === 1 && !now[0]!.endsWith("s") ? "changes" : "change"} now.`
      : "";
  switch (outcome.kind) {
    case "nothing":
      return <div className="verdict nothing">Nothing changed yet.</div>;
    case "at-once":
      return (
        <div className="verdict at-once">
          <p>
            <b>Applies now.</b> It doesn't change what counts, so no approval.
          </p>
        </div>
      );
    case "stricter":
      return (
        <div className="verdict stricter">
          <p>
            <b>Applies without approval from {formatDate(outcome.appliesFrom)}.</b>
            {outcome.todayKeepsCents !== null && ` ${open} keeps ${money(outcome.todayKeepsCents)} per miss.`}
            {nowLine}
          </p>
        </div>
      );
    case "needs-approval": {
      const names = outcome.reviewerNames;
      const who =
        names.length === 1 ? `Needs ${names[0]}'s approval.` : `Needs approval from ${listNames(names, "or")}.`;
      return (
        <div className="verdict needs-approval">
          <p>
            <b>{who}</b> Until then {pactName} keeps its current terms
            {outcome.bundlesStricter &&
              ", the stricter changes too, since a change that relaxes anything is reviewed as a whole"}
            .{nowLine}
          </p>
        </div>
      );
    }
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
