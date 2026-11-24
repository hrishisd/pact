// Request change, pushed from a pact's page after its edit window: the
// pact's terms on one Check list, each with Change, which opens just that
// step of the create form in a sheet. A changed row shows the old value
// struck out and what it needs. Under the list, the core's verdict on the
// whole change, an optional "Why?" when it needs approval, and Send or Apply.

import { useEffect, useState } from "react";
import type { Json } from "../shared/api.ts";
import { isOncePerPeriod } from "../shared/schedules.ts";
import {
  MAX_TEXT_CHARS,
  type AppliesNow,
  type ChangePactRefusal,
  type ChangePreview,
  type CreatePactRefusal,
  type PactChange,
  type PactTerms,
} from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import {
  AT_ONCE_REFUSAL_TEXT,
  changeValue,
  currentValue,
  effectText,
  openOccurrenceText,
  termsOfKind,
  type Term,
} from "./change-terms.tsx";
import { formatDate, listNames, money, remindersText, termLabel } from "./format.ts";
import { formOf, termsOfForm, type Form } from "./pact-form.ts";
import { ListsFailed, PactFormStep, PROBLEMS, usePactFormLists, type FormStep } from "./pact-form-steps.tsx";
import { LoadedFound, Sheet, useLoad, useSend } from "./ui.tsx";

type Pact = Json<PactTerms>;

/** The create form's step each term is changed on. */
const STEP_OF: Record<Term, FormStep> = {
  name: "goal",
  description: "goal",
  deck: "goal",
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

const STEP_TITLES: Record<FormStep, string> = {
  goal: "Goal",
  schedule: "Schedule",
  penalty: "Penalty",
  reviewers: "Reviewers",
  reminders: "Reminders",
};

const REFUSALS: Record<Exclude<ChangePactRefusal, CreatePactRefusal>, string> = {
  ...AT_ONCE_REFUSAL_TEXT,
  "change-request-waiting":
    "A change request is already waiting. Until it's decided or you withdraw it, you can only change the name and reminders, or add reviewers.",
  "end-approved":
    "Ending this pact is approved. Until it ends, you can only change the name and reminders, or add reviewers.",
  "pact-started": "It has already started, so the start date can't change.",
  "schedule-kind-fixed": "You can't change the type of schedule. Create a new pact instead.",
  "nothing-changed": "Nothing changed yet.",
};

/** The words for each refusal: the create form's, then this page's own, which win where both have one. */
const REFUSAL_TEXT = { ...PROBLEMS, ...REFUSALS } satisfies Record<
  ChangePactRefusal | "no-amount" | "no-recipient",
  string
>;

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
  const { state } = useLoad(() => api.pact(pactId));
  return (
    <LoadedFound
      state={state}
      what="This pact"
      notFound={{ title: "Pact not found", body: "It isn't one of your pacts." }}
    >
      {({ pact }) => <ChangeForm pact={pact} onDone={onDone} onInvite={onInvite} />}
    </LoadedFound>
  );
}

/** The form's terms and note as the core takes them, or what stops them being sent. */
function changeOf(form: Form, note: string): PactChange | { problem: "no-amount" | "no-recipient" } {
  const terms = termsOfForm(form);
  if ("problem" in terms) return terms;
  return { ...terms, ...(note.trim() !== "" && { note }) };
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
  const [step, setStep] = useState<FormStep | null>(null);
  // As on Create pact: a list that didn't load says so, rather than looking empty.
  const lists = usePactFormLists();
  const [verdict, setVerdict] = useState<Verdict>({ kind: "loading" });
  const {
    busy: sending,
    error: sendError,
    run: sendChange,
  } = useSend(
    async (sent: PactChange) => {
      const result = await api.changePact(pact.id, sent);
      if (!result.ok) return REFUSAL_TEXT[result.reason];
      onDone();
    },
    (error) => `Couldn't send it. ${failureText(error, "Check your connection and try again.")}`,
    // Done goes Back, which lands a moment later: the button stays disabled till then.
    { leavesScreen: true },
  );
  const update = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }));

  const change = changeOf(form, "");
  const key = JSON.stringify(change);
  useEffect(() => {
    if ("problem" in change) return setVerdict({ kind: "refused", text: REFUSAL_TEXT[change.problem] });
    let current = true;
    const timer = window.setTimeout(() => {
      api.changePreview(pact.id, change).then(
        (result) => {
          if (!current) return;
          setVerdict(
            result.ok
              ? { kind: "loaded", preview: result.preview }
              : { kind: "refused", text: REFUSAL_TEXT[result.reason] },
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

  const send = () => {
    const sent = changeOf(form, note);
    if (!("problem" in sent)) sendChange(sent);
  };

  const changes = verdict.kind === "loaded" ? verdict.preview.changes : [];
  const reviewerNames = pact.reviewers.map((r) => r.name);

  const sheet = step !== null && (
    <Sheet title={STEP_TITLES[step]} onClose={() => setStep(null)}>
      <div className="stack step-in-sheet">
        {lists.failed && (step === "penalty" || step === "reviewers") && <ListsFailed failed={lists.failed} />}
        <PactFormStep
          step={step}
          form={form}
          update={update}
          lists={lists}
          onInvite={onInvite}
          kindFixed
          hints={{
            reviewers:
              "Adding a reviewer applies right away. Removing one needs approval. A pact must keep at least one reviewer.",
            reminders: "Changes apply right away without approval.",
          }}
        />
      </div>
      <button className="btn primary block" onClick={() => setStep(null)}>
        Done
      </button>
    </Sheet>
  );

  return (
    <>
      <p className="muted small">
        Change what you need, then send. Stricter changes apply on their own; anything looser goes to{" "}
        {listNames(reviewerNames)}.
      </p>
      <dl className="list term-list">
        {termsOfKind(pact)
          // Every 2 weeks and Once a month have nothing in their schedule to change, and their first period has opened.
          .filter((term) => !(isOncePerPeriod(pact.schedule) && (term === "schedule" || term === "start-date")))
          .map((term) => {
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
                  ) : term === "reminders" ? (
                    remindersText(pact.reminders)
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
      <VerdictBox
        verdict={verdict}
        pactName={pact.name}
        open={openOccurrenceText(pact.schedule)}
        oneTime={pact.schedule.kind === "one-time"}
      />
      {verdict.kind === "loaded" && verdict.preview.outcome.kind === "needs-approval" && (
        <label className="field">
          <span>Why? (optional)</span>
          <textarea
            className="inp"
            maxLength={MAX_TEXT_CHARS}
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
        onClick={send}
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
    case "at-once":
    case "stricter":
      return "Apply change";
  }
}

/** The core's verdict on the whole change, in words. */
/**
 * `open` names the occurrence open now, which keeps its terms: "Today", or
 * "This week". A `oneTime` pact's one occurrence takes the change at once.
 */
function VerdictBox({
  verdict,
  pactName,
  open,
  oneTime,
}: {
  verdict: Verdict;
  pactName: string;
  open: string;
  oneTime: boolean;
}) {
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
  const { outcome } = verdict.preview;
  switch (outcome.kind) {
    case "nothing":
      return <div className="verdict nothing">Nothing changed yet.</div>;
    case "at-once":
      return (
        <div className="verdict at-once">
          <p>
            <b>Applies now.</b> No approval needed, because it doesn't change what you have to do.
          </p>
        </div>
      );
    case "stricter":
      return (
        <div className="verdict stricter">
          <p>
            <b>
              {oneTime
                ? "Applies now. No approval needed, because it makes the pact stricter."
                : `Applies from ${formatDate(outcome.appliesFrom)}. No approval needed, because it makes the pact stricter.`}
            </b>
            {outcome.todayKeepsCents !== null && ` ${open} penalty stays ${money(outcome.todayKeepsCents)}.`}
            {nowLine(outcome.appliesNow)}
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
            <b>{who}</b> Until then, the pact keeps its current terms.
            {outcome.bundlesStricter &&
              " Part of this change makes the pact easier, so the whole change waits for approval, including the stricter parts."}
            {nowLine(outcome.appliesNow)}
          </p>
        </div>
      );
    }
  }
}

/** What applies at once inside a change that waits or is stricter: " The name and the new reviewers change now." */
export function nowLine(appliesNow: AppliesNow[]): string {
  const [first, ...rest] = appliesNow;
  if (first === undefined) return "";
  const verb = rest.length === 0 && !APPLIES_NOW[first].plural ? "changes" : "change";
  return ` ${capitalize(listNames(appliesNow.map((what) => APPLIES_NOW[what].text)))} ${verb} now.`;
}

const APPLIES_NOW: Record<AppliesNow, { text: string; plural: boolean }> = {
  name: { text: "the name", plural: false },
  reminders: { text: "the reminders", plural: true },
  "new-reviewer": { text: "the new reviewer", plural: false },
  "new-reviewers": { text: "the new reviewers", plural: true },
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
