// The invariants the randomised test checks (fuzz.ts runs it).
//
// Each has a name, which a `Violation` carries. They read the core only
// through its queries, as every scenario does, with one exception: to tell
// whether anything was written, `dump` reads every table on its own
// connection, as the verdict check does.
//
// A violation that is a bug with a ticket goes in KNOWN below, so the run
// carries on past it. Remove the entry with the fix.

import { addDays } from "../../shared/calendar.ts";
import { termsOf } from "../../shared/terms.ts";
import type {
  ChangePactResult,
  ChangePreviewResult,
  CreatePactResult,
  DecideResult,
  ExcusePreviewResult,
  FileExcuseResult,
  FileVacationResult,
  FirstOccurrenceResult,
  HeatMapDay,
  Ledger,
  NotificationSetting,
  NewExcuse,
  NewPact,
  NewVacation,
  OccurrenceRecord,
  PactChange,
  PactTerms,
  ReviewItem,
  Today,
  TodayWaitingItem,
  VacationPreviewResult,
  VacationRequest,
} from "../../shared/types.ts";
import { localDateOf } from "../calendar.ts";
import { openWithPragmas, type Db } from "../db.ts";
import type { NotificationKind } from "../ports.ts";
import { describeItem, type World } from "./fuzz.ts";
import type { AccountHandle } from "./scenario.ts";

/** A broken invariant: which one, and what was seen. */
export class Violation extends Error {
  readonly invariant: string;

  constructor(invariant: string, detail: string) {
    super(`${invariant}: ${detail}`);
    this.invariant = invariant;
  }
}

/** Violations the checks skip: each a bug a ticket fixes. */
const KNOWN: { invariant: string; ticket: string; matches: (detail: string) => boolean }[] = [
  {
    invariant: "current-terms-are-valid",
    ticket: "design review 38: a reminder at or after the due time once a waiting change is approved",
    matches: (detail) => detail.includes('"reason":"reminder-after-due-time"'),
  },
];

function fail(invariant: string, detail: string): void {
  if (KNOWN.some((known) => known.invariant === invariant && known.matches(detail))) return;
  throw new Violation(invariant, detail);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function show(value: unknown): string {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

function isRefusal(result: unknown): result is { ok: false; reason: string } {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}

/** Every occurrence a pact's heat map shows, with its day. */
function occurrencesOf(pact: PactTerms): { date: string; occurrence: OccurrenceRecord }[] {
  const days: (HeatMapDay | { date: string; occurrence: OccurrenceRecord | null })[] =
    pact.history.kind === "fixed-days"
      ? pact.history.days
      : pact.history.kind === "weekly-count"
        ? pact.history.weeks
        : [pact.history.day];
  return days.flatMap((day) => (day.occurrence ? [{ date: day.date, occurrence: day.occurrence }] : []));
}

/** The occurrence a pact's heat map shows for `date`: on Weekly count, the week it falls in. */
function occurrenceOn(pact: PactTerms, date: string): OccurrenceRecord | undefined {
  const weekly = pact.history.kind === "weekly-count";
  return occurrencesOf(pact).find((entry) =>
    weekly ? entry.date <= date && date < addDays(entry.date, 7) : entry.date === date,
  )?.occurrence;
}

/** What one person's queries showed at one moment. */
interface Seen {
  who: AccountHandle;
  timezone: string;
  today: Today;
  pacts: PactTerms[];
  ledgers: Ledger[];
  queue: ReviewItem[];
  waitingOnReply: ReviewItem[];
}

/** The setting that turns each kind of notification off; null for a kind nothing turns off. */
const SETTING_OF_KIND: Record<NotificationKind, NotificationSetting | null> = {
  "operator-alert": null,
  "picked-as-reviewer": "picked-as-reviewer",
  "review-item": "review-item",
  "evidence-decided": "decision",
  "payment-decided": "decision",
  "missed-occurrence": "missed-occurrence",
  "excuse-decided": "decision",
  "change-request-decided": "decision",
  "vacation-decided": "decision",
  "reviewer-question": "comment",
  "owner-replied": "comment",
  "stale-review-items": "review-item",
  "unanswered-question": "comment",
  "new-bill": "new-bill",
  "overdue-bill": "overdue-bill",
  "connection-problem": "connection-problem",
  reminder: null,
};

/** What the last check saw, for the invariants about what may change between two checks. */
interface Before {
  /** By pact and day: a judged occurrence's outcome. */
  outcomes: Map<string, string>;
  /** By ledger: approved payments, lifetime. */
  paid: Map<string, number>;
  /** By item: its state once decided or withdrawn. */
  settled: Map<string, string>;
  /** By pact: when it Ended. */
  ended: Map<string, string>;
  /** By person: their timezone. */
  timezones: Map<string, string>;
  /** By penalty: a billed penalty as its ledger showed it. */
  billed: Map<string, string>;
  /** Recipients whose ledger has held a payment, with whose it is. */
  paidLedgers: Map<string, string>;
  /** By pact: an Ended pact's terms, and each pact's evidence kind and (past its edit window) schedule kind. */
  frozen: Map<string, string>;
}

export class Checks {
  readonly #world: World;
  #db: Db | null = null;
  #tables: string[] | null = null;
  #before: Before | null = null;
  /** How many pushes and emails the last check had seen. */
  #pushesSeen = 0;
  #emailsSeen = 0;
  /** By person, kind and local day: the once-a-day messages sent. */
  readonly #onceADay = new Set<string>();
  /** By person: the notification settings turned on when the messages were last checked. */
  readonly #settingsOn = new Map<string, NotificationSetting[]>();
  /** Every item seen waiting, by id: whose it is and its kind. */
  readonly #items = new Map<string, { owner: AccountHandle; kind: TodayWaitingItem["kind"] }>();

  constructor(world: World) {
    this.#world = world;
  }

  /** Runs `step`; anything it throws that isn't a violation becomes one. */
  async guard(label: string, step: () => Promise<void>): Promise<void> {
    try {
      await step();
    } catch (error) {
      throw this.#asViolation(label, error);
    }
  }

  #asViolation(label: string, error: unknown): Violation {
    if (error instanceof Violation) return error;
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
    // The scenario's own check, after every command and tick (verdict-check.ts).
    if (text.includes("stored outcomes differ from verdictOf")) {
      return new Violation("outcomes-match-verdict", `after ${label}: ${text.split("\n").slice(0, 6).join("\n")}`);
    }
    return new Violation("never-throws", `${label} threw: ${text.split("\n").slice(0, 8).join("\n")}`);
  }

  /** Every table's rows, as one string per table. */
  dump(): Map<string, string> {
    this.#db ??= openWithPragmas(this.#world.s.dbPath);
    const db = this.#db;
    this.#tables ??= db
      .prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all()
      .map((row) => row.name)
      .sort();
    return new Map(this.#tables.map((table) => [table, JSON.stringify(db.prepare(`SELECT * FROM "${table}"`).all())]));
  }

  close(): void {
    this.#db?.close();
    this.#db = null;
  }

  /** The tables that differ between two dumps, each with the rows that went and the rows that came. */
  #changed(before: Map<string, string>, after: Map<string, string>): string[] {
    return [...after]
      .filter(([table, rows]) => before.get(table) !== rows)
      .map(([table, rows]) => {
        const was = new Set((JSON.parse(before.get(table) ?? "[]") as unknown[]).map((row) => JSON.stringify(row)));
        const is = new Set((JSON.parse(rows) as unknown[]).map((row) => JSON.stringify(row)));
        const gone = [...was].filter((row) => !is.has(row)).slice(0, 3);
        const come = [...is].filter((row) => !was.has(row)).slice(0, 3);
        return `${table} (was ${gone.join(" ") || "nothing"}, now ${come.join(" ") || "nothing"})`;
      });
  }

  /**
   * A command: it never throws, and a refusal changes nothing and tells
   * nobody. Every command also does the tick's housekeeping for requests
   * that no longer matter (`withdrawMoot`), which can judge a day whose due
   * time passed since the last tick. So a refusal's writes are checked only
   * when a tick ran at this very time and left no such work.
   */
  async command<T>(label: string, run: () => Promise<T>): Promise<T> {
    const before = this.dump();
    const sent = this.#world.s.notifier.sent.length;
    let result: T;
    try {
      result = await run();
    } catch (error) {
      throw this.#asViolation(label, error);
    }
    if (isRefusal(result) && this.#world.tickedAt === this.#world.now().getTime()) {
      const changed = this.#changed(before, this.dump());
      if (changed.length > 0) {
        fail("refusal-changes-nothing", `${label} was refused (${result.reason}) but wrote to ${changed.join(", ")}`);
      }
      if (this.#world.s.notifier.sent.length !== sent) {
        fail("refusal-changes-nothing", `${label} was refused (${result.reason}) but sent a notification`);
      }
    }
    return result;
  }

  /** Two ticks at the same time: the second changes nothing and sends nothing. */
  async tickTwice(): Promise<void> {
    const { s } = this.#world;
    const now = this.#world.now();
    await this.#world.tick(now);
    const before = this.dump();
    const sent = s.notifier.sent.length;
    const mailed = s.mailer.sent.length;
    await this.#world.tick(now);
    const changed = this.#changed(before, this.dump());
    if (changed.length > 0)
      fail("tick-is-idempotent", `a second tick at ${now.toISOString()} wrote to ${changed.join(", ")}`);
    if (s.notifier.sent.length !== sent || s.mailer.sent.length !== mailed) {
      fail("tick-is-idempotent", `a second tick at ${now.toISOString()} sent something`);
    }
  }

  /** A restart: every query answers as before it. */
  async restart(): Promise<void> {
    const before = JSON.stringify(this.everything());
    await this.#world.s.restart();
    const after = JSON.stringify(this.everything());
    if (before !== after) fail("restart-changes-nothing", `queries answer differently after a restart`);
  }

  /** What every person's queries answer now. */
  everything(): unknown {
    return this.#world.people.map((who) => ({ ...this.#see(who), who: who.name, vacations: who.vacations() }));
  }

  pactOf(who: AccountHandle, pactId: string): PactTerms {
    const result = who.pact(pactId);
    if (!result.ok) throw new Violation("links-resolve", `${who.name}'s pact ${pactId} is listed but not found`);
    return result.pact;
  }

  #see(who: AccountHandle): Seen {
    return {
      who,
      timezone: who.profile().timezone,
      today: who.today(),
      pacts: who.pacts().map((summary) => this.pactOf(who, summary.id)),
      ledgers: who.ledgers().map((summary) => {
        const result = who.ledger(summary.recipientId);
        if (!result.ok) throw new Violation("links-resolve", `${who.name}'s ledger for ${summary.name} is not found`);
        if (!same(result.ledger.summary, summary)) {
          fail(
            "ledger-adds-up",
            `${who.name}'s ledger page and list disagree: ${show([result.ledger.summary, summary])}`,
          );
        }
        return result.ledger;
      }),
      queue: who.reviewQueue(),
      waitingOnReply: who.waitingOnReply(),
    };
  }

  /** The instants ahead at which something happens: where bugs live. */
  edgesAhead(): { at: Date; what: string }[] {
    const now = this.#world.now().getTime();
    const edges: { at: Date; what: string }[] = [];
    for (const who of this.#world.people) {
      for (const summary of who.pacts()) {
        const pact = this.pactOf(who, summary.id);
        if (pact.editWindowClosesAt)
          edges.push({ at: pact.editWindowClosesAt, what: `${pact.name}'s edit window closing` });
        for (const { date, occurrence } of occurrencesOf(pact)) {
          const status = occurrence.status;
          if (status.kind === "not-judged") {
            edges.push({ at: status.opensAt, what: `${pact.name} ${date} opening` });
            edges.push({ at: status.dueAt, what: `${pact.name} ${date} due` });
          }
          if (status.kind === "missed")
            edges.push({ at: status.excusableUntil, what: `${pact.name} ${date} excuse window closing` });
        }
      }
      for (const summary of who.ledgers()) {
        if (summary.billDue)
          edges.push({ at: summary.billDue.dueAt, what: `${who.name}'s bill for ${summary.name} due` });
      }
    }
    return edges
      .filter((edge) => edge.at.getTime() > now && edge.at.getTime() < now + 10 * 24 * 60 * 60 * 1000)
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .slice(0, 12);
  }

  // What a preview said, against what the command then did.

  firstOccurrenceOf(who: AccountHandle, pact: NewPact): FirstOccurrenceResult {
    const { schedule, evidenceKind, inBedBy, dueBy, startDate } = pact;
    return who.firstOccurrence({
      schedule,
      evidenceKind,
      ...(inBedBy !== undefined && { inBedBy }),
      ...(dueBy !== undefined && { dueBy }),
      ...(startDate !== undefined && { startDate }),
    });
  }

  createdAsPreviewed(
    who: AccountHandle,
    pact: NewPact,
    preview: FirstOccurrenceResult,
    result: CreatePactResult,
  ): void {
    if (!result.ok) return;
    const created = this.pactOf(who, result.pactId);
    if (!preview.ok || !same(preview.firstOccurrence, created.firstOccurrence)) {
      fail(
        "preview-matches-command",
        `firstOccurrence said ${show(preview)} but ${pact.name} was created with ${show(created.firstOccurrence)}`,
      );
    }
  }

  changePreviewOf(who: AccountHandle, pactId: string, change: PactChange): ChangePreviewResult {
    return who.changePreview(pactId, change);
  }

  changedAsPreviewed(preview: ChangePreviewResult, result: ChangePactResult): void {
    const agree = preview.ok
      ? preview.preview.outcome.kind === "nothing"
        ? !result.ok && result.reason === "nothing-changed"
        : result.ok && result.outcome.kind === preview.preview.outcome.kind
      : !result.ok && result.reason === preview.reason;
    if (!agree)
      fail("preview-matches-command", `changePreview said ${show(preview)} but changePact did ${show(result)}`);
  }

  excusePreviewOf(who: AccountHandle, pactId: string, excuse: NewExcuse): ExcusePreviewResult {
    return who.excusePreview(pactId, { from: excuse.from, to: excuse.to });
  }

  excusedAsPreviewed(
    who: AccountHandle,
    excuse: NewExcuse,
    preview: ExcusePreviewResult,
    result: FileExcuseResult,
  ): void {
    const said = `excusePreview said ${show(preview)} but fileExcuse did ${show(result)}`;
    if (!preview.ok) {
      if (result.ok || result.reason !== preview.reason) fail("preview-matches-command", said);
      return;
    }
    if (!result.ok) {
      const covered = preview.preview.covered.length > 0;
      const fine =
        result.reason === "nothing-to-excuse"
          ? !covered
          : result.reason === "blank-reason" && excuse.reason.trim() === "";
      if (!fine) fail("preview-matches-command", said);
      return;
    }
    const page = who.excuse(result.excuseId);
    if (!page.ok) throw new Violation("links-resolve", `the excuse just filed is not found`);
    const filed = page.excuse.days.map((day) => day.date);
    const previewed = preview.preview.covered.map((day) => day.date);
    if (!same(filed, previewed)) fail("preview-matches-command", `${said}, which covers ${show(filed)}`);
  }

  vacationPreviewOf(who: AccountHandle, request: VacationRequest): VacationPreviewResult {
    return who.vacationPreview(request);
  }

  vacationAsPreviewed(
    who: AccountHandle,
    vacation: NewVacation,
    preview: VacationPreviewResult,
    result: FileVacationResult,
  ): void {
    const said = `vacationPreview said ${show(preview)} but fileVacation did ${show(result)}`;
    if (!preview.ok) {
      // Filing checks for no pacts and no reviewers too, and may say so first.
      const fine =
        !result.ok &&
        (result.reason === preview.reason || result.reason === "no-pacts" || result.reason === "no-reviewers");
      if (!fine) fail("preview-matches-command", said);
      return;
    }
    if (preview.preview.coversNothing && result.ok) fail("preview-matches-command", said);
    if (!result.ok) {
      const explained =
        (result.reason === "nothing-to-cover" && preview.preview.coversNothing) ||
        (result.reason === "no-pacts" && vacation.pactIds.length === 0) ||
        result.reason === "no-reviewers" ||
        result.reason === "reviewer-not-offered";
      if (!explained) fail("preview-matches-command", said);
      return;
    }
    const item = this.#world.people
      .flatMap((reviewer) => reviewer.reviewQueue())
      .find((queued) => queued.id === result.vacationId);
    if (!item || item.kind !== "vacation") {
      fail("waiting-items-agree", `the vacation ${who.name} just filed is in no reviewer's queue`);
      return;
    }
    const filed = item.covers.map((cover) => [cover.pactId, cover.covered]);
    const previewed = preview.preview.pacts
      .filter((pact) => pact.ticked && pact.covered.length > 0)
      .map((pact) => [pact.pactId, pact.covered]);
    const byPact = (pairs: unknown[][]) => [...pairs].sort((x, y) => String(x[0]).localeCompare(String(y[0]), "en-US"));
    if (!same(byPact(filed), byPact(previewed))) {
      fail("preview-matches-command", `${said}, which covers ${show(filed)}`);
    }
  }

  // What a reviewer's queue offers can be done.

  /** What a reviewer's queue offers can be decided. */
  #decidable(who: AccountHandle, item: ReviewItem, decision: "approve" | "reject", result: DecideResult): void {
    if (result.ok) return;
    // Withdrawn as the decision arrived: the clock had passed the moment it stopped mattering, with no tick yet.
    if (result.reason === "withdrawn") return;
    if (result.reason === "deadline-too-soon" && item.kind === "change-request" && decision === "approve") return;
    fail(
      "queue-items-can-be-decided",
      `${who.name} could not ${decision} ${describeItem(item)} from their queue: ${result.reason}`,
    );
  }

  /** An item from the queue can be decided, and approving an end request Ends the pact or sets the last day it keeps. */
  decidedFromQueue(who: AccountHandle, item: ReviewItem, decision: "approve" | "reject", result: DecideResult): void {
    if (result.ok && decision === "approve" && item.kind === "change-request" && item.endsPact) {
      const owner = this.#world.people.find((person) => person.name === item.ownerName)!;
      const pact = this.pactOf(owner, item.pactId);
      if (pact.stage === "active" && pact.ending === null) {
        fail("approved-end-ends", `${who.name} approved ending ${pact.name}, which is still Active with no last day`);
      }
    }
    this.#decidable(who, item, decision, result);
  }

  /** A decided item stays decided: deciding it again is refused. */
  decidedOnce(who: AccountHandle, what: string, result: DecideResult): void {
    if (result.ok) fail("decided-once", `${who.name} decided ${what} a second time`);
  }

  askedFromQueue(
    who: AccountHandle,
    item: ReviewItem,
    validQuestion: boolean,
    result: { ok: boolean; reason?: string },
  ): void {
    if (!validQuestion) {
      if (result.ok) fail("questions-are-valid", `${who.name} asked a blank or too long question and it was accepted`);
      return;
    }
    if (!result.ok) {
      fail(
        "queue-items-can-be-decided",
        `${who.name} could not ask about ${describeItem(item)} from their queue: ${result.reason}`,
      );
    }
  }

  repliedToQuestion(who: AccountHandle, item: TodayWaitingItem, result: { ok: boolean; reason?: string }): void {
    if (!result.ok) {
      fail(
        "queue-items-can-be-decided",
        `${who.name} could not reply to the question Today shows on ${describeItem(item)}: ${result.reason}`,
      );
    }
  }

  // What a command accepted, against what the queries showed just before it.

  /** A payment is never more than the ledger showed payable; checked only when no housekeeping waits (see `command`). */
  paidWhatIsPayable(ledger: Ledger["summary"], amountCents: number, result: { ok: boolean }): void {
    if (!result.ok || this.#world.tickedAt !== this.#world.now().getTime()) return;
    if (amountCents > ledger.payableCents) {
      fail(
        "payments-fit-what-is-payable",
        `a payment of ${amountCents}c to ${ledger.name} was accepted with ${ledger.payableCents}c payable: ${show(ledger)}`,
      );
    }
  }

  /** An excuse never covers a day that was Satisfied. */
  excusedNoSatisfiedDay(who: AccountHandle, before: PactTerms, result: FileExcuseResult): void {
    if (!result.ok) return;
    const page = who.excuse(result.excuseId);
    if (!page.ok) return;
    for (const { date } of page.excuse.days) {
      if (occurrenceOn(before, date)?.status.kind === "satisfied") {
        fail(
          "excuses-skip-satisfied-days",
          `${who.name}'s excuse on ${before.name} covers ${date}, which was Satisfied`,
        );
      }
    }
  }

  /** The days `pact`'s heat map shows Satisfied. */
  satisfiedDates(pact: PactTerms): string[] {
    return occurrencesOf(pact).flatMap(({ date, occurrence }) =>
      occurrence.status.kind === "satisfied" ? [date] : [],
    );
  }

  /** A vacation never covers an occurrence that had already opened. */
  vacationCoversNothingOpen(who: AccountHandle, before: PactTerms[], result: FileVacationResult): void {
    if (!result.ok) return;
    const item = this.#world.people
      .flatMap((reviewer) => reviewer.reviewQueue())
      .find((queued) => queued.id === result.vacationId);
    if (item?.kind !== "vacation") return;
    for (const cover of item.covers) {
      const pact = before.find((p) => p.id === cover.pactId);
      for (const { date } of cover.covered) {
        const status = pact && occurrenceOn(pact, date)?.status;
        if (status && (status.kind !== "not-judged" || status.phase !== "ahead")) {
          fail(
            "vacations-cover-what-has-not-opened",
            `${who.name}'s vacation covers ${pact.name} ${date}, which was ${status.kind} (${status.phase})`,
          );
        }
      }
    }
  }

  /** Lowering the penalty of a reviewed pact waits for a reviewer. */
  easierNeedsApproval(pact: PactTerms, change: PactChange, result: ChangePactResult): void {
    if (!result.ok || pact.reviewers.length === 0 || change.penaltyCents >= pact.penaltyCents) return;
    if (result.outcome.kind !== "needs-approval") {
      fail(
        "easier-needs-approval",
        `${pact.name}'s penalty went from ${pact.penaltyCents}c to ${change.penaltyCents}c as ${result.outcome.kind}`,
      );
    }
  }

  /** A pact is edited only while its edit window is open. */
  editedInWindow(pact: PactTerms, result: { ok: boolean }): void {
    if (result.ok && pact.editWindowClosesAt === null) {
      fail("edits-only-in-edit-window", `${pact.name} was edited after its edit window closed`);
    }
  }

  /** Evidence is accepted only for an Active pact. */
  submittedWhileActive(pact: PactTerms, result: { ok: boolean }): void {
    if (result.ok && pact.stage !== "active") {
      fail("evidence-only-while-active", `evidence for ${pact.name} was accepted after it Ended`);
    }
  }

  /**
   * Right after a tick, nothing waits that deciding could no longer change
   * (R8, moot.ts): no evidence on an occurrence already Satisfied, no excuse
   * whose every day is Satisfied, and nothing on a pact that's gone.
   */
  nothingMootWaits(): void {
    for (const who of this.#world.people) {
      for (const item of who.today().waiting) {
        if (!("pactId" in item)) continue;
        const found = who.pact(item.pactId);
        if (!found.ok) {
          fail("no-moot-items-wait", `${who.name}'s ${describeItem(item)} waits on a pact that's gone`);
          continue;
        }
        if (item.kind === "excuse") {
          const page = who.excuse(item.id);
          const days = page.ok ? page.excuse.days : [];
          if (days.length > 0 && days.every((day) => day.status.kind === "satisfied")) {
            fail(
              "no-moot-items-wait",
              `${who.name}'s ${describeItem(item)} waits, but every day it covers is Satisfied`,
            );
          }
        }
        if (item.kind !== "evidence") continue;
        if (occurrenceOn(found.pact, item.occurrenceDate)?.status.kind === "satisfied") {
          fail(
            "no-moot-items-wait",
            `${who.name}'s ${describeItem(item)} waits on ${found.pact.name} ${item.occurrenceDate}, already Satisfied`,
          );
        }
      }
    }
  }

  /** Every invariant about the state as it stands, and about how it changed since the last check. */
  all(): void {
    const { people, outsider } = this.#world;
    const before = this.dump();
    let seen: Seen[];
    try {
      seen = people.map((who) => this.#see(who));
      for (const who of people) {
        who.vacations();
        who.lastVacation();
        who.vacationOptions();
        who.friends();
        who.recipients();
        who.notificationSettings();
        who.dailySummary();
      }
    } catch (error) {
      throw this.#asViolation("a query", error);
    }
    const written = this.#changed(before, this.dump());
    if (written.length > 0) fail("queries-never-write", `the queries wrote to ${written.join(", ")}`);

    for (const person of seen) {
      this.#ledgersAddUp(person);
      this.#penaltiesMatchMisses(person);
      this.#todayShowsActivePacts(person);
      this.#todayShowsBills(person);
      this.#pactsAreWellFormed(person);
      this.#currentTermsAreValid(person);
    }
    this.messagesFollowSettings();
    this.#waitingItemsAgree(seen);
    this.#othersSeeNothing(seen, outsider);
    this.#endingWithdrawsChangeRequests(seen);
    this.#changesSinceLastCheck(seen);
  }

  /**
   * Ending a pact withdraws its waiting change request as it Ends, so one
   * withdrawn because its pact Ended was withdrawn when the pact Ended. (A
   * change request waiting on an Ended pact is checked in `#waitingItemsAgree`.)
   */
  #endingWithdrawsChangeRequests(seen: Seen[]): void {
    for (const [id, { owner, kind }] of this.#items) {
      if (kind !== "change-request") continue;
      const page = owner.changeRequest(id);
      if (!page.ok) continue;
      const { state, pactId } = page.changeRequest;
      if (state.kind !== "withdrawn" || state.reason !== "pact-ended") continue;
      const pact = seen.find((person) => person.who.id === owner.id)?.pacts.find((p) => p.id === pactId);
      if (pact?.stage === "ended" && pact.endedAt.getTime() !== state.withdrawnAt.getTime()) {
        fail(
          "ending-withdraws-change-request",
          `${owner.name}'s ${pact.name} Ended at ${pact.endedAt.toISOString()} but its change request was withdrawn at ${state.withdrawnAt.toISOString()}`,
        );
      }
    }
  }

  /** A ledger's summary is its history added up. */
  #ledgersAddUp({ who, ledgers }: Seen): void {
    for (const { summary, history } of ledgers) {
      const where = `${who.name}'s ledger for ${summary.name}`;
      const penalties = history.flatMap((entry) => (entry.kind === "penalty" ? [entry] : []));
      const payments = history.flatMap((entry) => (entry.kind === "payment" ? [entry] : []));
      const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0);
      const counted = sum(penalties.filter((p) => !p.held).map((p) => p.amountCents));
      const approved = sum(payments.filter((p) => p.state.kind === "approved").map((p) => p.amountCents));
      const awaiting = payments.filter((p) => p.state.kind === "waiting");
      const expected = {
        owedCents: Math.max(0, counted - approved),
        creditCents: Math.max(0, approved - counted),
        paidCents: approved,
        awaitingCents: sum(awaiting.map((p) => p.amountCents)),
        awaitingCount: awaiting.length,
      };
      for (const [field, value] of Object.entries(expected) as [keyof typeof expected, number][]) {
        if (summary[field] !== value) {
          fail(
            "ledger-adds-up",
            `${where}: ${field} is ${summary[field]} but its history adds up to ${value}: ${show(summary)}`,
          );
        }
      }
      if (summary.payableCents !== Math.max(0, summary.owedCents - summary.awaitingCents)) {
        fail("ledger-adds-up", `${where}: payable isn't owed less awaiting: ${show(summary)}`);
      }
      if (summary.suggestedPaymentCents > summary.payableCents || summary.suggestedPaymentCents < 0) {
        fail("ledger-adds-up", `${where}: the suggested payment is more than payable: ${show(summary)}`);
      }
      const billed = summary.overdueCents + (summary.billDue?.amountCents ?? 0);
      if (summary.overdueCents < 0 || (summary.billDue?.amountCents ?? 1) <= 0 || billed > summary.payableCents) {
        fail("ledger-adds-up", `${where}: the open bills ask for more than is payable: ${show(summary)}`);
      }
      // Approved payments pay the penalties not held (billed ones first), and nothing else.
      const paidOff = sum(penalties.filter((p) => !p.held).map((p) => p.paidCents));
      if (paidOff !== Math.min(approved, counted)) {
        fail(
          "ledger-adds-up",
          `${where}: its penalties show ${paidOff} paid, but approved payments cover ${Math.min(approved, counted)}`,
        );
      }
      for (const penalty of penalties) {
        if (penalty.held && penalty.paidCents !== 0) fail("ledger-adds-up", `${where}: a held penalty shows as paid`);
        if (penalty.amountCents <= 0) fail("ledger-adds-up", `${where}: a penalty of ${penalty.amountCents}`);
        if (penalty.paidCents < 0 || penalty.paidCents > penalty.amountCents) {
          fail("ledger-adds-up", `${where}: a penalty of ${penalty.amountCents} shows ${penalty.paidCents} paid`);
        }
      }
    }
  }

  /** Each Missed occurrence a pact page shows has one penalty on the ledgers, and each penalty a Missed occurrence. */
  #penaltiesMatchMisses({ who, pacts, ledgers }: Seen): void {
    const onLedgers = new Map<string, { amountCents: number; held: boolean }>();
    for (const { history } of ledgers) {
      for (const entry of history) {
        if (entry.kind !== "penalty") continue;
        const key = `${entry.pactId} ${entry.occurrenceDate}`;
        if (onLedgers.has(key))
          fail("penalties-match-misses", `${who.name} has two penalties for ${entry.pactName} ${entry.occurrenceDate}`);
        onLedgers.set(key, { amountCents: entry.amountCents, held: entry.held });
      }
    }
    for (const pact of pacts) {
      for (const { date, occurrence } of occurrencesOf(pact)) {
        const key = `${pact.id} ${date}`;
        const penalty = onLedgers.get(key);
        onLedgers.delete(key);
        const status = occurrence.status;
        if (status.kind !== "missed") {
          if (penalty)
            fail("penalties-match-misses", `${who.name}'s ${pact.name} ${date} is ${status.kind} but has a penalty`);
          continue;
        }
        const held = status.cover?.state === "waiting";
        if (!penalty || penalty.amountCents !== status.penaltyCents || penalty.held !== held) {
          fail(
            "penalties-match-misses",
            `${who.name}'s ${pact.name} ${date} is Missed (${status.penaltyCents}c${held ? ", held" : ""}) but the ledger has ${show(penalty)}`,
          );
        }
      }
    }
    if (onLedgers.size > 0) {
      fail(
        "penalties-match-misses",
        `${who.name} has penalties for occurrences no pact page shows: ${[...onLedgers.keys()].join(", ")}`,
      );
    }
  }

  /** Today's cards about what to do are for Active pacts, and every pact a card names is the owner's. */
  #todayShowsActivePacts({ who, today, pacts }: Seen): void {
    const byId = new Map(pacts.map((pact) => [pact.id, pact]));
    for (const section of today.sections) {
      for (const card of section.cards) {
        if (!("pactId" in card)) continue;
        const pact = byId.get(card.pactId);
        if (!pact) {
          fail(
            "today-shows-active-pacts",
            `${who.name}'s Today has a ${section.kind} card for a pact not in their list`,
          );
        } else if (pact.stage === "ended" && section.kind !== "missed") {
          fail(
            "today-shows-active-pacts",
            `${who.name}'s Today has a ${section.kind} card for ${pact.name}, which Ended`,
          );
        }
      }
    }
  }

  /** Today's overdue alert and bill card say what the ledger says, one of each per recipient at most. */
  #todayShowsBills({ who, today, ledgers }: Seen): void {
    const alerts = today.alerts.flatMap((alert) => (alert.kind === "bill-overdue" ? [alert] : []));
    const cards = today.sections
      .flatMap((section) => (section.kind === "to-do" ? section.cards : []))
      .flatMap((card) => ("kind" in card && card.kind === "bill" ? [card] : []));
    const expectedAlerts = ledgers
      .filter(({ summary }) => summary.overdueCents > 0)
      .map(({ summary }) => [summary.recipientId, summary.overdueCents]);
    const expectedCards = ledgers
      .filter(({ summary }) => summary.billDue !== null)
      .map(({ summary }) => [summary.recipientId, summary.billDue!.amountCents, summary.billDue!.dueAt]);
    const sorted = (rows: unknown[][]) => [...rows].sort((x, y) => String(x[0]).localeCompare(String(y[0]), "en-US"));
    const shownAlerts = alerts.map((alert) => [alert.recipientId, alert.overdueCents]);
    const shownCards = cards.map((card) => [card.recipientId, card.amountCents, card.dueAt]);
    if (!same(sorted(shownAlerts), sorted(expectedAlerts))) {
      fail(
        "today-shows-bills",
        `${who.name}'s overdue alerts are ${show(shownAlerts)} but the ledgers say ${show(expectedAlerts)}`,
      );
    }
    if (!same(sorted(shownCards), sorted(expectedCards))) {
      fail(
        "today-shows-bills",
        `${who.name}'s bill cards are ${show(shownCards)} but the ledgers say ${show(expectedCards)}`,
      );
    }
  }

  /** What every pact's terms keep to, whatever was done to it. */
  #pactsAreWellFormed({ who, pacts }: Seen): void {
    for (const pact of pacts) {
      const broken = (what: string) =>
        fail("pacts-are-well-formed", `${who.name}'s ${pact.name} ${what}: ${show(termsOf(pact))}`);
      if (pact.reviewers.length === 0) broken("has no reviewers");
      if (pact.reviewers.some((reviewer) => reviewer.id === who.id)) broken("is reviewed by its owner");
      if (!Number.isInteger(pact.penaltyCents) || pact.penaltyCents <= 0) broken("has no penalty");
      if (pact.reminders.length > 5) broken("has more than 5 reminders");
      if (pact.evidenceKind !== "camera" && (pact.schedule.kind !== "fixed-days" || pact.description !== "")) {
        broken("isn't a Camera pact but has a Camera pact's terms");
      }
      if (pact.schedule.kind === "fixed-days" && pact.schedule.days.length === 0) broken("has no days");
      if (pact.schedule.kind === "one-time" && (pact.startDate !== null || pact.endDate !== null)) {
        broken("is One-time with a start or end date");
      }
      if (pact.stage === "ended" && (pact.ending !== null || pact.editWindowClosesAt !== null))
        broken("Ended but is still ending");
      if (pact.stage === "active" && pact.schedule.kind === "one-time") {
        const judged = occurrencesOf(pact).some(({ occurrence }) => occurrence.status.kind !== "not-judged");
        if (judged) broken("is One-time and judged but still Active");
      }
    }
  }

  /**
   * Nobody gets a push of a kind they turned off, and the once-a-day
   * messages (the stale-item pushes and the daily summary) come once a day.
   */
  messagesFollowSettings(): void {
    const { notifier, mailer } = this.#world.s;
    const now = this.#world.now();
    const people = this.#world.people.map((who) => ({
      who,
      timezone: who.profile().timezone,
      settingsOn: who
        .notificationSettings()
        .filter((state) => state.enabled)
        .map((state) => state.setting),
    }));
    for (const push of notifier.sent.slice(this.#pushesSeen)) {
      const person = people.find(({ who }) => who.id === push.recipient);
      if (!person) continue;
      const setting = SETTING_OF_KIND[push.kind];
      // Off when last looked and off now: a command that turns a setting on or off is in neither.
      const wasOff = setting !== null && this.#settingsOn.get(push.recipient)?.includes(setting) === false;
      if (setting !== null && wasOff && !person.settingsOn.includes(setting)) {
        fail("messages-follow-settings", `${person.who.name} got a ${push.kind} push with ${setting} turned off`);
      }
      if (push.kind === "stale-review-items" || push.kind === "unanswered-question") {
        this.#onceToday(person, push.kind, now);
      }
    }
    for (const email of mailer.sent.slice(this.#emailsSeen)) {
      const person = people.find(({ who }) => `${who.name}@example.test` === email.to);
      if (person && email.subject === "Pact Daily Summary") this.#onceToday(person, "daily summary", now);
    }
    for (const { who, settingsOn } of people) this.#settingsOn.set(who.id, settingsOn);
    this.#pushesSeen = notifier.sent.length;
    this.#emailsSeen = mailer.sent.length;
  }

  #onceToday({ who, timezone }: { who: AccountHandle; timezone: string }, what: string, now: Date): void {
    const key = `${who.id} ${what} ${localDateOf(now, timezone)}`;
    if (this.#onceADay.has(key))
      fail("messages-follow-settings", `${who.name} got a second ${what} on ${localDateOf(now, timezone)}`);
    this.#onceADay.add(key);
  }

  /**
   * An Active pact's terms, sent again as they stand, break none of the
   * rules a change is checked against: a pact never holds terms the app
   * itself would refuse.
   */
  #currentTermsAreValid({ who, pacts }: Seen): void {
    const fine = new Set([
      "nothing-changed",
      "change-request-waiting",
      "end-approved",
      "edit-window-open",
      "pact-ended",
      // Not about the terms: with Oura or AnkiWeb disconnected, the Request change form refuses any change.
      "oura-not-connected",
      "anki-not-connected",
    ]);
    for (const pact of pacts) {
      if (pact.stage !== "active" || pact.editWindowClosesAt !== null) continue;
      const preview = who.changePreview(pact.id, termsOf(pact));
      if (preview.ok ? preview.preview.outcome.kind !== "nothing" : !fine.has(preview.reason)) {
        fail(
          "current-terms-are-valid",
          `${who.name}'s ${pact.name}, sent as it stands, answers ${show(preview)}; terms ${show(termsOf(pact))}`,
        );
      }
    }
  }

  /** What an owner sees waiting is what some reviewer can decide, and the other way round. */
  #waitingItemsAgree(seen: Seen[]): void {
    const deciders = new Map<string, string[]>();
    for (const { who, queue, waitingOnReply } of seen) {
      const ids = [...queue, ...waitingOnReply].map((item) => item.id);
      if (new Set(ids).size !== ids.length) fail("waiting-items-agree", `${who.name}'s queue lists an item twice`);
      for (const item of queue) {
        if (item.thread.waitingOnReply)
          fail("waiting-items-agree", `${who.name}'s queue has ${describeItem(item)}, which waits on a reply`);
      }
      for (const item of waitingOnReply) {
        if (!item.thread.waitingOnReply)
          fail("waiting-items-agree", `${who.name}'s waiting-on-reply list has ${describeItem(item)}, which doesn't`);
      }
      for (const item of [...queue, ...waitingOnReply]) {
        if (item.ownerName === who.name)
          fail("waiting-items-agree", `${who.name} can decide their own ${describeItem(item)}`);
        deciders.set(item.id, [...(deciders.get(item.id) ?? []), who.name]);
        const owner = seen.find((person) => person.who.name === item.ownerName);
        if (!owner?.today.waiting.some((waiting) => waiting.id === item.id && waiting.kind === item.kind)) {
          fail(
            "waiting-items-agree",
            `${who.name} can decide ${describeItem(item)}, which its owner's Today doesn't show as waiting`,
          );
        }
      }
    }
    for (const { who, today, pacts } of seen) {
      for (const item of today.waiting) {
        this.#items.set(item.id, { owner: who, kind: item.kind });
        // A reviewer can't see a pact's evidence until its edit window closes.
        const inEditWindow =
          item.kind === "evidence" && pacts.find((p) => p.id === item.pactId)?.editWindowClosesAt !== null;
        if (!deciders.has(item.id) && !inEditWindow) {
          fail("waiting-items-agree", `${who.name}'s ${describeItem(item)} waits, but nobody can decide it`);
        }
        const state = this.#stateOf(who, item.kind, item.id);
        if (state !== undefined && state.kind !== "waiting") {
          fail(
            "waiting-items-agree",
            `${who.name}'s Today shows ${describeItem(item)} waiting, but its page says ${state.kind}`,
          );
        }
        if ("pactId" in item && !pacts.find((p) => p.id === item.pactId)?.waiting.some((w) => w.id === item.id)) {
          fail(
            "waiting-items-agree",
            `${who.name}'s Today shows ${describeItem(item)} waiting, but its pact page doesn't`,
          );
        }
      }
      for (const alert of today.alerts) {
        if (alert.kind === "reviewer-question" && !today.waiting.some((item) => item.id === alert.item.id)) {
          fail(
            "waiting-items-agree",
            `${who.name}'s Today asks for a reply about ${describeItem(alert.item)}, which isn't waiting`,
          );
        }
      }
      for (const pact of pacts) {
        for (const item of pact.waiting) {
          if (!today.waiting.some((waiting) => waiting.id === item.id)) {
            fail(
              "waiting-items-agree",
              `${who.name}'s ${pact.name} page shows ${describeItem(item)} waiting, but Today doesn't`,
            );
          }
        }
        if (pact.stage === "ended" && pact.waiting.some((item) => item.kind === "change-request")) {
          fail("waiting-items-agree", `${who.name}'s ${pact.name} Ended with a change request still waiting`);
        }
      }
    }
  }

  /** An item's state as its owner's page gives it; undefined for a vacation, which has no page, or an item that's gone. */
  #stateOf(who: AccountHandle, kind: TodayWaitingItem["kind"], id: string): { kind: string } | undefined {
    switch (kind) {
      case "evidence": {
        const page = who.evidence(id);
        return page.ok ? page.evidence.state : undefined;
      }
      case "excuse": {
        const page = who.excuse(id);
        return page.ok ? page.excuse.state : undefined;
      }
      case "payment": {
        const page = who.payment(id);
        return page.ok ? page.payment.state : undefined;
      }
      case "change-request": {
        const page = who.changeRequest(id);
        return page.ok ? page.changeRequest.state : undefined;
      }
      case "vacation":
        return undefined;
    }
  }

  /** Nobody sees another person's pact, item or ledger, and the outsider's queue is empty. */
  #othersSeeNothing(seen: Seen[], outsider: AccountHandle): void {
    if (outsider.reviewQueue().length > 0 || outsider.waitingOnReply().length > 0) {
      fail("others-see-nothing", `${outsider.name}, who reviews nothing, has items in their queue`);
    }
    for (const { who, pacts, ledgers } of seen) {
      const others = [...this.#world.people.filter((other) => other.id !== who.id), outsider];
      for (const other of others) {
        for (const pact of pacts) {
          if (other.pact(pact.id).ok)
            fail("others-see-nothing", `${other.name} can open ${who.name}'s pact ${pact.name}`);
        }
        for (const { summary } of ledgers) {
          const theirs = other.recipients().some((recipient) => recipient.id === summary.recipientId);
          if (!theirs && other.ledger(summary.recipientId).ok) {
            fail("others-see-nothing", `${other.name} can open ${who.name}'s ledger for ${summary.name}`);
          }
        }
      }
    }
    for (const [id, { owner, kind }] of this.#items) {
      for (const other of [...this.#world.people, outsider]) {
        if (other.id !== owner.id && this.#stateOf(other, kind, id) !== undefined) {
          fail("others-see-nothing", `${other.name} can open the page of ${owner.name}'s ${kind} ${id}`);
        }
      }
    }
  }

  /** What may never change between two checks. */
  #changesSinceLastCheck(seen: Seen[]): void {
    const now: Before = {
      outcomes: new Map(),
      paid: new Map(),
      settled: new Map(),
      ended: new Map(),
      timezones: new Map(),
      billed: new Map(),
      paidLedgers: new Map(),
      frozen: new Map(),
    };
    const before = this.#before;
    for (const { who, timezone, pacts, ledgers } of seen) {
      now.timezones.set(who.id, timezone);
      // A new timezone gives every day a new place in time: its pacts start afresh here.
      const moved = before !== null && before.timezones.get(who.id) !== timezone;
      for (const pact of pacts) {
        if (pact.stage === "ended") {
          const endedAt = pact.endedAt.toISOString();
          now.ended.set(pact.id, endedAt);
          const was = before?.ended.get(pact.id);
          if (was !== undefined && was !== endedAt)
            fail("the-past-stays", `${who.name}'s ${pact.name} Ended at ${was}, and now at ${endedAt}`);
        } else if (before?.ended.has(pact.id)) {
          fail("the-past-stays", `${who.name}'s ${pact.name} had Ended and is Active again`);
        }
        const outcomes = new Map<string, string>();
        for (const { date, occurrence } of occurrencesOf(pact)) {
          if (occurrence.status.kind !== "not-judged") outcomes.set(`${pact.id} ${date}`, occurrence.status.kind);
        }
        for (const [key, outcome] of outcomes) now.outcomes.set(key, outcome);
        if (before === null || moved || pact.editWindowClosesAt !== null) continue;
        for (const [key, was] of before.outcomes) {
          if (!key.startsWith(`${pact.id} `)) continue;
          const outcome = outcomes.get(key);
          // A Missed occurrence can still be Excused, and an Excused one Satisfied by evidence approved late; nothing else judged changes.
          const allowed = (was === "missed" && outcome === "excused") || (was === "excused" && outcome === "satisfied");
          if (outcome !== was && !allowed) {
            fail(
              "the-past-stays",
              `${who.name}'s ${pact.name} ${key.split(" ")[1]} was ${was} and is now ${outcome ?? "not judged"}`,
            );
          }
        }
      }
      for (const pact of pacts) {
        // The evidence kind never changes; nor the schedule's kind after the edit window, nor an Ended pact's terms.
        const kept = [
          pact.evidenceKind,
          pact.editWindowClosesAt === null ? pact.schedule.kind : null,
          pact.stage === "ended" ? [termsOf(pact), pact.reminders] : null,
        ];
        now.frozen.set(pact.id, JSON.stringify(kept));
        const was = before?.frozen.get(pact.id);
        if (was === undefined) continue;
        const [kind, schedule, terms] = JSON.parse(was) as unknown[];
        if (kind !== kept[0]) fail("the-past-stays", `${who.name}'s ${pact.name} changed its evidence kind`);
        if (schedule !== null && schedule !== kept[1])
          fail("the-past-stays", `${who.name}'s ${pact.name} changed its schedule's kind from ${String(schedule)}`);
        if (terms !== null && !same(terms, kept[2]))
          fail("the-past-stays", `${who.name}'s ${pact.name} Ended and its terms changed: ${show([terms, kept[2]])}`);
      }
      const listed = new Set(ledgers.map(({ summary }) => summary.recipientId));
      for (const [recipientId, owner] of before?.paidLedgers ?? []) {
        if (owner !== who.id) continue;
        now.paidLedgers.set(recipientId, owner);
        if (!listed.has(recipientId))
          fail("the-past-stays", `${who.name}'s ledger ${recipientId}, which has payments, is no longer listed`);
      }
      for (const { summary, history } of ledgers) {
        if (history.some((entry) => entry.kind === "payment")) now.paidLedgers.set(summary.recipientId, who.id);
        const billedNow = new Map<string, string>();
        for (const entry of history) {
          if (entry.kind !== "penalty" || entry.bill.kind !== "on-bill") continue;
          const { amountCents, occurrenceDate, addedAt, bill, held } = entry;
          billedNow.set(entry.penaltyId, JSON.stringify({ amountCents, occurrenceDate, addedAt, bill, held }));
          if (held)
            fail("the-past-stays", `${who.name}'s billed penalty for ${entry.pactName} ${occurrenceDate} is held`);
        }
        for (const [id, text] of billedNow) now.billed.set(id, text);
      }
      for (const { summary } of ledgers) {
        now.paid.set(summary.recipientId, summary.paidCents);
        const was = before?.paid.get(summary.recipientId) ?? 0;
        if (summary.paidCents < was)
          fail(
            "the-past-stays",
            `${who.name}'s lifetime paid to ${summary.name} fell from ${was} to ${summary.paidCents}`,
          );
      }
    }
    // A bill never changes: a billed penalty stays as it was billed.
    for (const [id, was] of before?.billed ?? []) {
      const moved = seen.some(({ who, timezone }) => before?.timezones.get(who.id) !== timezone);
      if (!moved && now.billed.get(id) !== was)
        fail("the-past-stays", `a billed penalty was ${was} and is now ${now.billed.get(id) ?? "gone"}`);
    }
    for (const [id, { owner, kind }] of this.#items) {
      const state = this.#stateOf(owner, kind, id);
      if (state === undefined || state.kind === "waiting") continue;
      const settled = show(state);
      now.settled.set(id, settled);
      const was = before?.settled.get(id);
      if (was !== undefined && was !== settled)
        fail("the-past-stays", `${owner.name}'s ${kind} ${id} was ${was} and is now ${settled}`);
    }
    for (const [id, was] of before?.settled ?? []) {
      if (
        !now.settled.has(id) &&
        this.#stateOf(this.#items.get(id)!.owner, this.#items.get(id)!.kind, id) !== undefined
      ) {
        fail("the-past-stays", `an item that was ${was} is waiting again`);
      }
    }
    this.#before = now;
  }
}
