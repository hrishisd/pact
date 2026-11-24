// The Today tab: alerts, then what's open now (evidence to submit and bills
// to pay), then recent misses, then what's coming up, then what's waiting for
// approval. Evidence is submitted inline on a To do card; an excuse is filed
// in the File excuse sheet, opened from a To do or Missed card or an alert; a
// payment is recorded in the Record a payment sheet, opened from a bill's To
// do card or an overdue alert. Last, Yesterday: how each pact due yesterday did.
// During an approved vacation, its banner comes after the alerts, and the
// pacts it covers are gone from the sections.
//
// A bedtime night Oura hasn't reported yet comes first, as No Oura data. While
// that card is on screen, Today checks Oura now: when it opens, when the app
// comes back to the foreground, and every 30 seconds. While an Anki day not
// judged yet is on screen, Today checks AnkiWeb now when it opens and when the
// app comes back to the foreground, so a deck just finished and synced clears.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { API_PATHS, type Json } from "../shared/api.ts";
import {
  MAX_EVIDENCE_PHOTOS,
  type AcceptExcuseRejectionResult,
  type AcceptMissRefusal,
  type AcceptVacationRejectionResult,
  type CheckNowResult,
  type ConnectionService,
  type LedgerSummary,
  type Refusal,
  type SubmitEvidenceRefusal,
  type TodayAlert,
  type TodayAnkiCard,
  type TodayBillCard,
  type TodayMissedCard,
  type TodayNoOuraDataCard,
  type TodaySection,
  type TodayToDoCard,
  type TodayWaitingItem,
  type LocalDate,
  type PeriodKind,
  type PeriodProgress,
} from "../shared/types.ts";
import { dayCount } from "../shared/calendar.ts";
import { AnkiConnectionAlert, AnkiDeckMissing } from "./anki.tsx";
import { api, failureText, uploadFailureText } from "./api.ts";
import {
  ankiMissText,
  clockText,
  clockTime,
  dateIn,
  dateSpan,
  dateUnlessToday,
  excusableText,
  fileExcuseLabel,
  formatDate,
  formatDay,
  formatDueAt,
  listNames,
  minutesLeft,
  money,
  NIGHT_CLOSES_TEXT,
  periodName,
  thisPeriod,
  timeLeft,
} from "./format.ts";
import { datesText } from "./excuse-days.tsx";
import { firstName, plural } from "./vacation-text.ts";
import { ExcuseSheet } from "./ExcuseSheet.tsx";
import { Yesterday } from "./history.tsx";
import { CameraIcon } from "./icons.tsx";
import { openItem, WaitingItemRow, type ItemOpeners } from "./item-page.tsx";
import { usePhotoPicks } from "./photos.ts";
import { VacationBanner } from "./VacationBanner.tsx";
import { OuraConnectionAlert, ouraResultText, takeOuraResult } from "./oura.tsx";
import { RecordPaymentSheet } from "./RecordPayment.tsx";
import { useRefreshOnPull } from "./pull-to-refresh.tsx";
import { EditWindowChip, Empty, Loaded, loadedData, useLoad, useNow, useSend } from "./ui.tsx";

/** What the File excuse sheet is open on: a pact, and the day it was opened from (none for the pact-page form). */
interface ExcuseTarget {
  pactId: string;
  pactName: string;
  day?: string;
}

/** Opens the File excuse sheet. */
type OnFileExcuse = (target: ExcuseTarget) => void;

/** File excuse from a card or alert about one of a pact's days: the sheet opens on that day. */
function excuseTargetFor(about: { pactId: string; name: string; occurrenceDate: string }): ExcuseTarget {
  return { pactId: about.pactId, pactName: about.name, day: about.occurrenceDate };
}

export function Today({
  timezone,
  onOpenPact,
  onOpenLedger,
  openers,
  onCreate,
  onInvite,
}: {
  /** The profile's timezone, for when bills and days are due and when AnkiWeb was checked. */
  timezone: string;
  onOpenPact: (id: string, name: string) => void;
  onOpenLedger: (recipientId: string, name: string) => void;
  /** Each kind's own page: a waiting row or a reviewer's question opens its item's. */
  openers: ItemOpeners;
  onCreate: () => void;
  onInvite: () => void;
}) {
  const { state, reload } = useLoad(api.today, API_PATHS.today);
  const today = loadedData(state);
  const now = useNow();
  const [excusing, setExcusing] = useState<ExcuseTarget | null>(null);
  // Back from reconnecting Oura: say so if it didn't work.
  const [ouraError] = useState(() => ouraResultText(takeOuraResult()));
  const brokenConnection = (service: ConnectionService) =>
    today?.alerts.some((alert) => alert.kind === "connection" && alert.service === service) ?? false;
  const ouraConnectionProblem = brokenConnection("oura");
  const ankiConnectionProblem = brokenConnection("anki");
  // Checking can't help while the connection is broken.
  const oura = useCheckNow(
    !ouraConnectionProblem && (today?.sections.some((section) => section.kind === "no-oura-data") ?? false),
    api.checkOura,
    reload,
    CHECK_OURA_EVERY_MS,
  );
  const anki = useCheckNow(
    !ankiConnectionProblem &&
      (today?.sections.some((section) => section.kind === "to-do" && section.cards.some((c) => c.kind === "anki")) ??
        false),
    api.checkAnki,
    reload,
    null,
  );
  // A pull checks Oura and AnkiWeb whatever cards show (the core asks only
  // about nights and days still waiting), then reloads Today.
  useRefreshOnPull(async () => {
    await Promise.all([ouraConnectionProblem || oura.pull(), ankiConnectionProblem || anki.pull()]);
    await reload();
  });
  // A waiting row or a reviewer's question opens the page of the item it's about.
  const open = (item: Json<TodayWaitingItem>) => openItem(item, openers);

  // A failed reload keeps the cards shown, with what failed above them.
  return (
    <Loaded state={state} what="Today">
      {(today) =>
        // Story 4: a new user's first screen says what to do next.
        !today.hasPacts ? (
          <Empty title="Welcome to Pact" body="Invite a friend to review your pacts, then create your first pact.">
            <div className="row2">
              <button className="btn primary" onClick={onInvite}>
                Invite a friend
              </button>
              <button className="btn" onClick={onCreate}>
                Create a pact
              </button>
            </div>
          </Empty>
        ) : (
          <>
            {today.alerts.length === 0 && today.sections.length === 0 && !today.vacations && (
              <Empty
                title="Nothing to do right now"
                body="When one of your pacts needs something from you, it shows up here."
              />
            )}
            {today.alerts.map((alert) => (
              <Alert
                key={alertKey(alert)}
                alert={alert}
                timezone={timezone}
                now={now}
                ouraError={ouraError}
                onFileExcuse={setExcusing}
                onOpenItem={open}
                onChanged={reload}
              />
            ))}
            {today.vacations?.map((vacation) => (
              <VacationBanner key={vacation.id} vacation={vacation} />
            ))}
            {today.sections.map((section) => (
              <Section
                key={section.kind}
                section={section}
                timezone={timezone}
                now={now}
                oura={oura}
                anki={anki}
                ouraConnectionProblem={ouraConnectionProblem}
                onOpenPact={onOpenPact}
                onOpenLedger={onOpenLedger}
                onFileExcuse={setExcusing}
                onChanged={reload}
              />
            ))}
            {today.waiting.length > 0 && <Waiting items={today.waiting} onOpenItem={open} />}
            <Yesterday entries={today.yesterday} timezone={timezone} now={now} onOpenPact={onOpenPact} />
            {excusing && (
              <ExcuseSheet
                pactId={excusing.pactId}
                pactName={excusing.pactName}
                timezone={timezone}
                {...(excusing.day !== undefined && { day: excusing.day })}
                onClose={() => setExcusing(null)}
                onFiled={() => {
                  setExcusing(null);
                  reload();
                }}
              />
            )}
          </>
        )
      }
    </Loaded>
  );
}

/** Each alert's React key: one per rejected occurrence, rejected excuse or vacation, or recipient overdue. */
function alertKey(alert: Json<TodayAlert>): string {
  switch (alert.kind) {
    case "evidence-rejected":
      return `evidence:${alert.pactId}:${alert.occurrenceDate}`;
    case "excuse-rejected":
      return `excuse:${alert.excuseId}`;
    case "vacation-rejected":
      return `vacation:${alert.vacationId}`;
    case "bill-overdue":
      return `overdue:${alert.recipientId}`;
    case "reviewer-question":
      return `question:${alert.item.id}`;
    case "connection":
      return alert.service;
  }
}

/** Under a card, after a check a pull sent couldn't reach the service. */
const UNREACHED_TEXT: Record<ConnectionService, string> = {
  oura: "Couldn't reach Oura. Pact will try again.",
  anki: "Couldn't reach AnkiWeb. Pact will try again.",
};

/** How often Today checks Oura while a No Oura data card is on screen. */
const CHECK_OURA_EVERY_MS = 30_000;

/** Where a check of Oura or AnkiWeb stands, for its card. */
interface CheckState {
  /** A check is running now. */
  checking: boolean;
  /** A check sent by a pull couldn't reach the service, and no check since has answered ok. */
  unreachable: boolean;
}

/**
 * While `active` (a No Oura data card, or an Anki day not judged, is on
 * screen), checks now at once, whenever the app comes back to the
 * foreground, and every `everyMs` while it's in front, if set; then
 * `onChecked` reloads Today. `pull` checks now whatever is on screen,
 * joining a check already running, and leaves the reload to the pull.
 * One check runs at a time; the core ignores checks that come too fast.
 * Only a check a pull sent shows that the service couldn't be reached; any
 * check that answers ok clears it.
 */
function useCheckNow(
  active: boolean,
  checkNow: () => Promise<CheckNowResult>,
  onChecked: () => void,
  everyMs: number | null,
): CheckState & { pull: () => Promise<void> } {
  const [checking, setChecking] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const running = useRef<Promise<CheckNowResult | null> | null>(null);
  const checked = useRef(onChecked);
  checked.current = onChecked;
  // A check that didn't reach Pact answers null: the reload says so, not the card.
  const send = useCallback(() => {
    if (running.current) return running.current;
    setChecking(true);
    const sent = checkNow()
      .catch(() => null)
      .then((result) => {
        running.current = null;
        setChecking(false);
        if (result?.ok) setUnreachable(false);
        return result;
      });
    running.current = sent;
    return sent;
  }, [checkNow]);
  const check = useCallback(() => {
    if (running.current || document.visibilityState === "hidden") return;
    void send().then(() => checked.current());
  }, [send]);
  const pull = useCallback(async () => {
    const result = await send();
    if (result && !result.ok) setUnreachable(true);
  }, [send]);
  useEffect(() => {
    if (!active) return;
    check();
    const timer = everyMs === null ? undefined : window.setInterval(check, everyMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, check, everyMs]);
  return { checking, unreachable, pull };
}

function Section({
  section,
  timezone,
  now,
  oura,
  anki,
  ouraConnectionProblem,
  onOpenPact,
  onOpenLedger,
  onFileExcuse,
  onChanged,
}: {
  section: Json<TodaySection>;
  timezone: string;
  now: number;
  /** Where the check of Oura stands. */
  oura: CheckState;
  /** Where the check of AnkiWeb stands. */
  anki: CheckState;
  /** Whether Pact can't read the owner's Oura: syncing won't help, reconnecting will. */
  ouraConnectionProblem: boolean;
  onOpenPact: (id: string, name: string) => void;
  onOpenLedger: (recipientId: string, name: string) => void;
  onFileExcuse: OnFileExcuse;
  /** After evidence is submitted, a miss is taken or a payment recorded: Today reloads. */
  onChanged: () => void;
}) {
  switch (section.kind) {
    case "no-oura-data":
      return section.cards.map((card) => (
        <NoOuraDataCard
          key={`no-oura-data:${card.pactId}:${card.occurrenceDate}`}
          card={card}
          now={now}
          check={oura}
          ouraConnectionProblem={ouraConnectionProblem}
          onOpen={() => onOpenPact(card.pactId, card.name)}
          onFileExcuse={() => onFileExcuse(excuseTargetFor(card))}
        />
      ));
    case "to-do":
      return section.cards.map((card) => {
        switch (card.kind) {
          case "bill":
            return (
              <BillCard
                key={`bill:${card.recipientId}`}
                card={card}
                timezone={timezone}
                now={now}
                onOpenLedger={onOpenLedger}
                onPaid={onChanged}
              />
            );
          case "anki":
            return (
              <AnkiCard
                key={`anki:${card.pactId}`}
                card={card}
                timezone={timezone}
                now={now}
                check={anki}
                onOpen={() => onOpenPact(card.pactId, card.name)}
                onFileExcuse={() => onFileExcuse(excuseTargetFor(card))}
              />
            );
          case "evidence":
            return (
              <PactCard
                key={`evidence:${card.pactId}`}
                name={card.name}
                penaltyCents={card.penaltyCents}
                editWindowClosesAt={card.editWindowClosesAt}
                now={now}
                chip={<span className="chip c-todo">To do</span>}
                onOpen={() => onOpenPact(card.pactId, card.name)}
              >
                {card.period ? (
                  <PeriodToDo card={card} period={card.period} timezone={timezone} now={now} />
                ) : (
                  <div className="meta due">
                    Due {dueDayText(card, timezone, now)}at {card.dueBy === null ? "midnight" : clockText(card.dueBy)} ·{" "}
                    {timeLeft(Date.parse(card.dueAt) - now)}
                  </div>
                )}
                <EvidenceForm
                  pactId={card.pactId}
                  period={card.period?.scheduleKind ?? null}
                  onSubmitted={onChanged}
                  onFileExcuse={() => onFileExcuse(excuseTargetFor(card))}
                />
              </PactCard>
            );
        }
      });
    case "missed":
      return section.cards.map((card) => (
        <PactCard
          key={`${card.pactId}:${card.occurrenceDate}`}
          name={card.name}
          penaltyCents={card.penaltyCents}
          chip={<span className="chip c-missed">{card.detail?.kind === "closed" ? "Closed" : "Missed"}</span>}
          onOpen={() => onOpenPact(card.pactId, card.name)}
        >
          <div className="meta">{missedLine(card, timezone)}</div>
          <MissedActions
            pactId={card.pactId}
            occurrenceDate={card.occurrenceDate}
            excusableUntil={card.excusableUntil}
            now={now}
            onFileExcuse={() => onFileExcuse(excuseTargetFor(card))}
            onTaken={onChanged}
          />
        </PactCard>
      ));
    case "automatic":
      return section.cards.map((card) => (
        <PactCard
          key={card.pactId}
          name={card.name}
          penaltyCents={card.penaltyCents}
          editWindowClosesAt={card.editWindowClosesAt}
          now={now}
          chip={<span className="chip c-soon">Automatic</span>}
          onOpen={() => onOpenPact(card.pactId, card.name)}
        >
          <div className="meta">
            Tonight, in bed by {clockText(card.inBedBy)} · {timeLeft(Date.parse(card.dueAt) - now)}
          </div>
        </PactCard>
      ));
    case "later":
      return (
        <section className="stack">
          <div className="label">{laterTitle(section.cards)}</div>
          {section.cards.map((card) => (
            <LaterCard
              key={card.pactId}
              card={card}
              timezone={timezone}
              onOpen={() => onOpenPact(card.pactId, card.name)}
              onSubmitted={onChanged}
            />
          ))}
        </section>
      );
    case "coming-up":
      return (
        <section className="stack">
          <div className="label">Coming up</div>
          {section.cards.map((card) => (
            <PactCard
              key={card.pactId}
              name={card.name}
              penaltyCents={card.penaltyCents}
              editWindowClosesAt={card.editWindowClosesAt}
              now={now}
              chip={
                <span className="chip c-soon">
                  {card.startDate === null ? "Next:" : "Starts"} {formatDate(card.opensOn)}
                </span>
              }
              onOpen={() => onOpenPact(card.pactId, card.name)}
            />
          ))}
        </section>
      );
  }
}

/**
 * A To do card's due day, when it isn't today: a One-time pact with Submit
 * anytime is due on the deadline's date ("Thu Nov 12 "). Empty for today.
 */
function dueDayText(card: Json<TodayToDoCard>, timezone: string, now: number): string {
  const day = dateUnlessToday(card.occurrenceDate, now, timezone);
  return day === null ? "" : `${day} `;
}

/**
 * A period on its To do card: a dot per day of the target, filled once a day
 * counts (or shaded while it waits for approval), "1 of 3 this week", and
 * when the period is due; with a due-by time, when today's photo is. A month
 * or 2 weeks also say how many days are left, and with a trip ahead, the day
 * to do it by and the trip.
 */
function PeriodToDo({
  card,
  period,
  timezone,
  now,
}: {
  card: Json<TodayToDoCard>;
  period: Json<PeriodProgress>;
  timezone: string;
  now: number;
}) {
  const { sessions, waiting, target, scheduleKind } = period;
  const trip = card.tripAhead;
  return (
    <>
      <div className="spread">
        <div className="dots" aria-hidden="true">
          {Array.from({ length: target }, (_, i) => (
            <i key={i} className={i < sessions ? "on" : i < sessions + waiting ? "wait" : undefined} />
          ))}
        </div>
        <span className="num meta">
          {sessions} of {target} {thisPeriod(scheduleKind)}
        </span>
      </div>
      <div className="meta due">
        {scheduleKind === "weekly-count"
          ? `Due by ${formatDate(lastDayOf(card, timezone))}`
          : `${trip ? `Do it by ${formatDate(trip.doItBy)}` : `Due by ${formatDate(lastDayOf(card, timezone))}`} · ${daysLeft(trip?.doItBy ?? lastDayOf(card, timezone), now, timezone)}`}
        {card.dueBy !== null && ` · today's photo by ${clockText(card.dueBy)}`}
      </div>
      {trip && <div className="meta">You're away {datesText(trip.firstDay, trip.lastDay)}</div>}
    </>
  );
}

/** A period card's last day in the owner's timezone: it's due at the midnight that ends it. */
function lastDayOf(card: Pick<Json<TodayToDoCard>, "dueAt">, timezone: string): LocalDate {
  return dateIn(Date.parse(card.dueAt) - 1, timezone);
}

/** "5 days left", counting today, until the end of `last`. */
function daysLeft(last: LocalDate, now: number, timezone: string): string {
  return `${plural(dayCount(dateIn(now, timezone), last), "day", "days")} left`;
}

/**
 * The later section's title: "This month" when every card in it is monthly,
 * "These 2 weeks" when every one is, else "Due later".
 */
function laterTitle(cards: Json<TodayToDoCard>[]): string {
  const kinds = new Set(cards.map((card) => card.period?.scheduleKind));
  if (kinds.size === 1 && kinds.has("once-a-month")) return "This month";
  if (kinds.size === 1 && kinds.has("every-2-weeks")) return "These 2 weeks";
  return "Due later";
}

/**
 * A period's card in the later section, before its reminder window: the
 * pact's name, how far the period got and when it's due, and Take photo.
 */
function LaterCard({
  card,
  timezone,
  onOpen,
  onSubmitted,
}: {
  card: Json<TodayToDoCard>;
  timezone: string;
  onOpen: () => void;
  onSubmitted: () => void;
}) {
  const progress = card.period ? `${card.period.sessions} of ${card.period.target} · ` : "";
  const due = card.tripAhead
    ? `do it by ${formatDate(card.tripAhead.doItBy)}`
    : `due ${formatDate(lastDayOf(card, timezone))}`;
  return (
    <article className="card tcard slim">
      <div className="spread">
        <span className="rt">
          <h3>
            <button className="tcard-open" onClick={onOpen}>
              {card.name}
            </button>
          </h3>
          <span className="meta">
            {progress}
            {due}
          </span>
        </span>
        <EvidenceForm pactId={card.pactId} period={card.period?.scheduleKind ?? null} onSubmitted={onSubmitted} />
      </div>
    </article>
  );
}

/**
 * Last night's bedtime, which Oura hasn't reported yet: syncing the ring
 * before 6pm still counts. Tonight's deadline rides on it, and File excuse
 * covers a night without the ring.
 */
function NoOuraDataCard({
  card,
  now,
  check: { checking, unreachable },
  ouraConnectionProblem,
  onOpen,
  onFileExcuse,
}: {
  card: Json<TodayNoOuraDataCard>;
  now: number;
  check: CheckState;
  ouraConnectionProblem: boolean;
  onOpen: () => void;
  onFileExcuse: () => void;
}) {
  const night = formatDate(card.occurrenceDate).split(" ")[0];
  const { tonight } = card;
  return (
    <PactCard
      name={card.name}
      penaltyCents={card.penaltyCents}
      chip={
        checking ? <span className="chip c-soon">Checking…</span> : <span className="chip c-due">No Oura data</span>
      }
      onOpen={onOpen}
    >
      <div className="meta">
        {checking
          ? "Checking Oura…"
          : `${night} night hasn't synced yet. ${ouraConnectionProblem ? "Reconnect Oura to count it." : "Open the Oura app to sync it."}`}
      </div>
      {unreachable && !checking && <div className="meta unreached">{UNREACHED_TEXT.oura}</div>}
      <div className="meta due">
        Missed at {NIGHT_CLOSES_TEXT} if it hasn't synced · {timeLeft(Date.parse(card.closesAt) - now)}
      </div>
      {tonight && (
        <div className="meta">
          Tonight, in bed by {clockText(tonight.inBedBy)} · {timeLeft(Date.parse(tonight.dueAt) - now)}
        </div>
      )}
      <CardActions className="row2">
        <button className="btn sm" onClick={onFileExcuse}>
          File excuse
        </button>
      </CardActions>
    </PactCard>
  );
}

/**
 * An Anki day open now: the cards left as of Pact's last check of the deck,
 * and when that was, then the due time. It leaves Today once Pact sees the
 * deck finished. File excuse covers a day without Anki.
 */
function AnkiCard({
  card,
  timezone,
  now,
  check: { checking, unreachable },
  onOpen,
  onFileExcuse,
}: {
  card: Json<TodayAnkiCard>;
  /** The profile's timezone, for when AnkiWeb was checked. */
  timezone: string;
  now: number;
  check: CheckState;
  onOpen: () => void;
  onFileExcuse: () => void;
}) {
  const { lastCheck } = card;
  return (
    <PactCard
      name={card.name}
      penaltyCents={card.penaltyCents}
      editWindowClosesAt={card.editWindowClosesAt}
      now={now}
      chip={<span className="chip c-todo">To do</span>}
      onOpen={onOpen}
    >
      {lastCheck ? (
        <>
          <div>
            <span className="leftbig">{lastCheck.cardsLeft}</span>{" "}
            <span className="muted">{lastCheck.cardsLeft === 1 ? "card" : "cards"} left</span>
          </div>
          <div className="meta">
            {checking ? <CheckingAnkiWeb /> : `Checked ${clockTime(lastCheck.checkedAt, timezone)}`}
          </div>
        </>
      ) : (
        <div className="meta">{checking ? <CheckingAnkiWeb /> : "Not checked yet today."}</div>
      )}
      {unreachable && !checking && <div className="meta unreached">{UNREACHED_TEXT.anki}</div>}
      <div className="meta due">
        Due at {card.dueBy === null ? "midnight" : clockText(card.dueBy)} · {timeLeft(Date.parse(card.dueAt) - now)}
      </div>
      {card.deckMissing ? (
        <AnkiDeckMissing deckName={card.deckName} />
      ) : (
        <div className="meta">Finish {card.deckName ?? "the deck"} in Anki and sync.</div>
      )}
      <CardActions className="row2">
        <button className="btn" onClick={onFileExcuse}>
          File excuse
        </button>
      </CardActions>
    </PactCard>
  );
}

function CheckingAnkiWeb() {
  return (
    <>
      <span className="spin" aria-hidden="true" />
      Checking AnkiWeb…
    </>
  );
}

/**
 * A Missed card's day, and for a bedtime night when Oura saw the owner get
 * into bed, or for an Anki day why. Today's day past its due-by time says when evidence was due. A
 * Weekly count week says how far it got.
 */
function missedLine({ detail, occurrenceDate }: Json<TodayMissedCard>, timezone: string): string {
  switch (detail?.kind) {
    case "closed":
      return `Your photo was due by ${clockText(detail.dueBy)}.`;
    case "period": {
      const { sessions, target, scheduleKind } = detail.progress;
      return scheduleKind === "weekly-count"
        ? `Week of ${formatDate(occurrenceDate)} · ${sessions} of ${target} days, ${target - sessions} short`
        : `${periodName(scheduleKind, occurrenceDate)} · no photo approved`;
    }
    case "anki":
      return `${formatDate(occurrenceDate)} · ${ankiMissText(detail.lastCheck, timezone)}`;
    case "night":
      return `${formatDate(occurrenceDate)} night · ${detail.inBedAt === null ? `no sleep data by ${NIGHT_CLOSES_TEXT}` : `in bed at ${clockText(detail.inBedAt)}`}`;
    case undefined:
      return formatDate(occurrenceDate);
  }
}

/**
 * A bill to pay, in To do: "Pay Sam", the amount in red, when it's due, and
 * Record payment. Tapping it opens the recipient's ledger.
 */
function BillCard({
  card,
  timezone,
  now,
  onOpenLedger,
  onPaid,
}: {
  card: Json<TodayBillCard>;
  timezone: string;
  now: number;
  onOpenLedger: (recipientId: string, name: string) => void;
  onPaid: () => void;
}) {
  return (
    <PactCard
      name={`Pay ${card.recipientName}`}
      penaltyCents={card.amountCents}
      chip={<span className="chip c-todo">To do</span>}
      onOpen={() => onOpenLedger(card.recipientId, card.recipientName)}
    >
      <div className="meta due">
        Due {formatDueAt(card.dueAt, timezone)} · {timeLeft(Date.parse(card.dueAt) - now)}
      </div>
      <div className="meta">Your bill from {formatDate(card.billedOn)}</div>
      <RecordPaymentAction recipientId={card.recipientId} primary onSent={onPaid} />
    </PactCard>
  );
}

/**
 * Record payment from Today: it loads the recipient's ledger, then opens the
 * Record a payment sheet on it, starting at the open bills' amount. Clicks
 * stay here rather than opening what's behind.
 */
function RecordPaymentAction({
  recipientId,
  primary = false,
  onSent,
}: {
  recipientId: string;
  /** The card's main action, full size; on an alert it's small. */
  primary?: boolean;
  /** After the payment was recorded: Today reloads. */
  onSent: () => void;
}) {
  const [ledger, setLedger] = useState<Json<LedgerSummary> | null>(null);
  const {
    busy,
    error,
    run: open,
  } = useSend(
    async () => {
      const result = await api.ledger(recipientId);
      if (!result.ok) return "This ledger wasn't found.";
      setLedger(result.ledger.summary);
    },
    (failure) => failureText(failure, "Couldn't open it. Check your connection and try again."),
  );
  return (
    <CardActions className="stack">
      <div className="row2">
        <button className={primary ? "btn primary" : "btn sm"} disabled={busy} onClick={() => open()}>
          {busy ? "Opening…" : "Record payment"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
      {ledger && (
        <RecordPaymentSheet
          ledger={ledger}
          onClose={() => setLedger(null)}
          onSent={() => {
            setLedger(null);
            onSent();
          }}
        />
      )}
    </CardActions>
  );
}

/**
 * Bills to a recipient past their due time and not covered: how much, the
 * oldest bill and when it was due, who has been told, and Record payment.
 */
function OverdueAlert({
  alert,
  timezone,
  onPaid,
}: {
  alert: Extract<Json<TodayAlert>, { kind: "bill-overdue" }>;
  timezone: string;
  onPaid: () => void;
}) {
  const { reviewerNames } = alert;
  return (
    <div className="alert bad" role="status">
      <b>
        {money(alert.overdueCents)} overdue to {alert.recipientName}.
      </b>
      <span className="small">
        Your bill from {formatDate(alert.billedOn)} was due {formatDay(alert.dueAt, timezone)}.
        {reviewerNames.length > 0 &&
          ` ${listNames(reviewerNames)} ${reviewerNames.length === 1 ? "has" : "have"} been told.`}
      </span>
      <RecordPaymentAction recipientId={alert.recipientId} onSent={onPaid} />
    </div>
  );
}

/** Something that needs the owner, first on Today. */
function Alert({
  alert,
  timezone,
  now,
  ouraError,
  onFileExcuse,
  onOpenItem,
  onChanged,
}: {
  alert: Json<TodayAlert>;
  timezone: string;
  now: number;
  /** Why the last reconnect didn't work, if it didn't. */
  ouraError: string | null;
  onFileExcuse: OnFileExcuse;
  onOpenItem: (item: Json<TodayWaitingItem>) => void;
  onChanged: () => void;
}) {
  switch (alert.kind) {
    case "reviewer-question":
      return <ReviewerQuestionAlert alert={alert} onReply={() => onOpenItem(alert.item)} />;
    case "evidence-rejected":
      return <RejectedEvidenceAlert alert={alert} now={now} onFileExcuse={onFileExcuse} onTaken={onChanged} />;
    case "excuse-rejected":
      return <RejectedExcuseAlert alert={alert} now={now} onFileExcuse={onFileExcuse} onTaken={onChanged} />;
    case "vacation-rejected":
      return <RejectedVacationAlert alert={alert} timezone={timezone} onTaken={onChanged} />;
    case "bill-overdue":
      return <OverdueAlert alert={alert} timezone={timezone} onPaid={onChanged} />;
    case "connection":
      return alert.service === "oura" ? (
        <OuraConnectionAlert status={alert.status} error={ouraError} />
      ) : (
        <AnkiConnectionAlert status={alert.status} onReconnected={onChanged} />
      );
  }
}

/**
 * A reviewer's question waiting on the owner's reply. Reply opens the item's
 * page, with what was asked about, the thread and the reply box.
 */
function ReviewerQuestionAlert({
  alert,
  onReply,
}: {
  alert: Extract<Json<TodayAlert>, { kind: "reviewer-question" }>;
  onReply: () => void;
}) {
  return (
    <div className="alert info" role="status">
      <b>
        {alert.reviewerName} asked about {questionSubject(alert.item)}
      </b>
      <span>“{alert.question}”</span>
      <span className="small muted">
        {alert.reviewerName} is waiting for your reply, but can still decide without it.
      </span>
      <div className="row2">
        <button className="btn sm primary" onClick={onReply}>
          Reply
        </button>
      </div>
    </div>
  );
}

/** What a question is about, after "asked about": "your evidence for Gym, Mon Nov 2". */
function questionSubject(item: Json<TodayWaitingItem>): string {
  switch (item.kind) {
    case "evidence":
      return `your evidence for ${item.name}, ${formatDate(item.occurrenceDate)}`;
    case "excuse":
      return `your excuse for ${item.name}, ${datesText(item.firstDate, item.lastDate)}`;
    case "payment":
      return `your ${money(item.amountCents)} payment to ${item.recipientName}`;
    case "change-request":
      return item.endsPact ? `your request to end ${item.name}` : `your change to ${item.name}`;
    case "vacation":
      return `your vacation, ${datesText(item.firstDate, item.lastDate)}`;
  }
}

/** Why Take the L was refused, on a Missed card or any rejection alert. */
type TakeTheLRefusal =
  AcceptMissRefusal | Refusal<AcceptExcuseRejectionResult> | Refusal<AcceptVacationRejectionResult>;

const TAKE_THE_L_REFUSAL_TEXT: Record<TakeTheLRefusal, string> = {
  "pact-not-found": "This pact wasn't found.",
  "excuse-not-found": "This excuse wasn't found.",
  "vacation-not-found": "This vacation wasn't found.",
  "nothing-to-accept": "There's nothing to accept now. Reopen Today to see the latest.",
};

/**
 * Take the L: it only takes a card or alert off Today and changes nothing
 * else, so it sends at once, with no confirmation.
 */
function useTakeTheL(send: () => Promise<{ ok: true } | { ok: false; reason: TakeTheLRefusal }>, onTaken: () => void) {
  const { busy, error, run } = useSend(
    async () => {
      const result = await send();
      if (!result.ok) return TAKE_THE_L_REFUSAL_TEXT[result.reason];
      onTaken();
    },
    (failure) => failureText(failure, "Couldn't send. Check your connection and try again."),
  );
  return { busy, error, take: run };
}

/** A Missed card's File excuse and Take the L. Clicks stay here rather than opening the pact. */
function MissedActions({
  pactId,
  occurrenceDate,
  excusableUntil,
  now,
  onFileExcuse,
  onTaken,
}: {
  pactId: string;
  occurrenceDate: string;
  excusableUntil: string;
  now: number;
  onFileExcuse: () => void;
  /** After Take the L: Today reloads. */
  onTaken: () => void;
}) {
  const { busy, error, take } = useTakeTheL(() => api.acceptMiss(pactId, occurrenceDate), onTaken);
  const fileLabel = fileExcuseLabel("File excuse", excusableUntil, now);
  return (
    <CardActions className="stack">
      <div className="row2">
        {fileLabel && (
          <button className="btn" onClick={onFileExcuse}>
            {fileLabel}
          </button>
        )}
        <button className="btn" disabled={busy} onClick={take}>
          {busy ? "Sending…" : "Take the L"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </CardActions>
  );
}

/**
 * Rejected evidence: the day is already Missed, with its penalty. File
 * excuse while the 48 hours from the rejection last, or Take the L, which
 * clears the alert.
 */
function RejectedEvidenceAlert({
  alert,
  now,
  onFileExcuse,
  onTaken,
}: {
  alert: Extract<Json<TodayAlert>, { kind: "evidence-rejected" }>;
  now: number;
  onFileExcuse: OnFileExcuse;
  /** After Take the L: Today reloads. */
  onTaken: () => void;
}) {
  const { busy, error, take } = useTakeTheL(() => api.acceptMiss(alert.pactId, alert.occurrenceDate), onTaken);
  const fileLabel =
    alert.excusableUntil === null ? "File excuse" : fileExcuseLabel("File excuse", alert.excusableUntil, now);

  return (
    <div className="alert bad" role="status">
      <b>
        {alert.reviewerName} rejected your evidence for {alert.name}
      </b>
      <span>“{alert.reason}”</span>
      {alert.period ? (
        <span className="small">This day doesn't count toward the week. Make it up on another day by Sunday.</span>
      ) : (
        <span className="small">
          {formatDate(alert.occurrenceDate)} is Missed ·{" "}
          <b className="pen">
            {money(alert.penaltyCents)} to {alert.recipientName}
          </b>
        </span>
      )}
      <div className="row2">
        {fileLabel && (
          <button className="btn sm" onClick={() => onFileExcuse(excuseTargetFor(alert))}>
            {fileLabel}
          </button>
        )}
        <button className="btn sm danger" disabled={busy} onClick={take}>
          {busy ? "Sending…" : "Take the L"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/**
 * A rejected excuse: its held penalties are owed again, and its days not
 * judged yet are judged as usual. File another excuse while a day is still
 * in its window, or Take the L, which clears the alert.
 */
function RejectedExcuseAlert({
  alert,
  now,
  onFileExcuse,
  onTaken,
}: {
  alert: Extract<Json<TodayAlert>, { kind: "excuse-rejected" }>;
  now: number;
  onFileExcuse: OnFileExcuse;
  /** After Take the L: Today reloads. */
  onTaken: () => void;
}) {
  const { busy, error, take } = useTakeTheL(() => api.acceptExcuseRejection(alert.excuseId), onTaken);
  const owedAgain = alert.owedAgainCents > 0;
  // One day opens the sheet on it; several open the pact-page form, which
  // offers only the days that can still be excused.
  const refile = () =>
    onFileExcuse({
      pactId: alert.pactId,
      pactName: alert.name,
      ...(alert.firstDate === alert.lastDate && { day: alert.firstDate }),
    });
  const refileLabel =
    alert.refile === null
      ? null
      : alert.refile.closesAt === null
        ? "File another excuse"
        : fileExcuseLabel("File another excuse", alert.refile.closesAt, now);

  return (
    <div className="alert bad" role="status">
      <b>
        {alert.reviewerName} rejected your excuse for {alert.name}
      </b>
      <span>“{alert.reason}”</span>
      <span className="small">
        {datesText(alert.firstDate, alert.lastDate)}
        {owedAgain && (
          <>
            {" · "}
            <b className="pen">{money(alert.owedAgainCents)} is owed again</b>
          </>
        )}
        {alert.hasDaysNotJudged &&
          (owedAgain
            ? ". Days that haven't been checked yet count as usual."
            : " · Days that haven't been checked yet count as usual.")}
      </span>
      <div className="row2">
        {refileLabel && (
          <button className="btn sm" onClick={refile}>
            {refileLabel}
          </button>
        )}
        <button className="btn sm danger" disabled={busy} onClick={take}>
          {busy ? "Sending…" : "Take the L"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/**
 * A rejected vacation: its held penalties are owed again, and its days are
 * judged as usual. The days it released can be excused for 48 hours from
 * the rejection, each from its Missed card; the alert says until when.
 * Take the L clears it, with no confirmation.
 */
function RejectedVacationAlert({
  alert,
  timezone,
  onTaken,
}: {
  alert: Extract<Json<TodayAlert>, { kind: "vacation-rejected" }>;
  /** The profile's timezone, for when the excuse window closes. */
  timezone: string;
  /** After Take the L: Today reloads. */
  onTaken: () => void;
}) {
  const { excusable } = alert;
  const { busy, error, take } = useTakeTheL(() => api.acceptVacationRejection(alert.vacationId), onTaken);
  return (
    <div className="alert bad" role="status">
      <b>{firstName(alert.reviewerName)} rejected your vacation</b>
      <span>“{alert.reason}”</span>
      <span className="small">
        {dateSpan(alert.firstDate, alert.lastDate)}
        {" · "}
        {alert.owedAgainCents > 0 ? (
          <b className="pen">{money(alert.owedAgainCents)} is owed again</b>
        ) : (
          "These days count as usual."
        )}
      </span>
      {excusable && (
        <span className="small">
          {excusableText(excusable.firstDate, excusable.lastDate, excusable.until, timezone)}
        </span>
      )}
      <div className="row2">
        <button className="btn sm danger" disabled={busy} onClick={take}>
          {busy ? "Sending…" : "Take the L"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** Waiting for approval, last on Today: every kind, each row opening its item's own page. */
function Waiting({
  items,
  onOpenItem,
}: {
  items: Json<TodayWaitingItem>[];
  onOpenItem: (item: Json<TodayWaitingItem>) => void;
}) {
  return (
    <section className="stack">
      <div className="label">Waiting for approval</div>
      <div className="cards">
        {items.map((item) => (
          <WaitingItemRow key={item.id} item={item} onOpen={onOpenItem} />
        ))}
      </div>
    </section>
  );
}

/**
 * Evidence on a To do card: live camera capture only (no photo library), one
 * photo at a time, each shrunk before it's shown. Beside Take photo, File
 * excuse for today, until a photo is taken. Clicks stay inside the form
 * rather than opening the pact.
 */
function EvidenceForm({
  pactId,
  period,
  onSubmitted,
  onFileExcuse,
}: {
  pactId: string;
  /** A period schedule's kind: a refused day can be made up on another. */
  period: PeriodKind | null;
  onSubmitted: () => void;
  /** File excuse beside Take photo; a later section card has neither, just a small Take photo. */
  onFileExcuse?: () => void;
}) {
  const {
    busy,
    error,
    setError,
    run: submit,
  } = useSend(
    async (photoBlobs: Blob[]) => {
      const result = await api.submitEvidence(pactId, photoBlobs);
      if (!result.ok) {
        return period && result.reason === "already-judged"
          ? `Today's photo was rejected. Make it up another day ${period === "every-2-weeks" ? "in these 2 weeks" : thisPeriod(period)}.`
          : REFUSAL_TEXT[result.reason];
      }
      onSubmitted();
    },
    (failure) =>
      uploadFailureText(
        failure,
        "A photo was too large to send. Remove it and take it again.",
        "Couldn't send. Check your connection and try again.",
      ),
  );
  const picks = usePhotoPicks({
    max: MAX_EVIDENCE_PHOTOS,
    unreadable: "That photo couldn't be read. Take it again.",
    setError,
  });
  const { photos } = picks;
  return (
    <CardActions className={photos.length === 0 ? "evidence stack" : "evidence stack full"}>
      <input ref={picks.input} type="file" accept="image/*" capture="environment" hidden onChange={picks.onChange} />
      {photos.length === 0 && !onFileExcuse ? (
        <button className="btn sm" onClick={picks.choose}>
          <CameraIcon />
          Take photo
        </button>
      ) : photos.length === 0 ? (
        <div className="row2">
          <button className="btn primary" onClick={picks.choose}>
            <CameraIcon />
            Take photo
          </button>
          <button className="btn" onClick={onFileExcuse}>
            File excuse
          </button>
        </div>
      ) : (
        <>
          <div className="photos">
            {photos.map((photo, i) => (
              <div key={photo.url} className="thumb">
                <img src={photo.url} alt={`Photo ${i + 1}`} />
                <button className="remove" aria-label={`Remove photo ${i + 1}`} onClick={() => picks.remove(photo)}>
                  ×
                </button>
              </div>
            ))}
            {photos.length < MAX_EVIDENCE_PHOTOS && (
              <button className="ph-add" aria-label="Take another photo" onClick={picks.choose}>
                +
              </button>
            )}
          </div>
          <button className="btn primary" disabled={busy} onClick={() => submit(photos.map((photo) => photo.blob))}>
            {busy ? "Sending…" : "Submit"}
          </button>
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </CardActions>
  );
}

const REFUSAL_TEXT: Record<SubmitEvidenceRefusal, string> = {
  "pact-not-found": "This pact wasn't found.",
  "no-photos": "Take a photo first.",
  "too-many-photos": `You can send at most ${MAX_EVIDENCE_PHOTOS} photos.`,
  "not-open": "This day has closed. Photos count only until the due time.",
  "evidence-waiting": "Today's photo is already waiting for approval.",
  "already-approved": "Today's photo is already approved.",
  "already-judged": "Today is already marked as missed, so new photos won't count.",
};

/**
 * A card's own buttons and forms, drawn above the card's opener (see
 * `PactCard`), so a tap on them stays theirs rather than opening the pact.
 */
function CardActions({ className, children }: { className: string; children: ReactNode }) {
  return <div className={`${className} card-actions`}>{children}</div>;
}

/**
 * A Today card: the pact's name (or for a bill, "Pay Sam"), a chip, its
 * penalty (or the bill's amount) in red, then whatever the section adds.
 * Tapping it opens the pact (or the ledger).
 *
 * The name is the button that opens it, stretched over the whole card, and
 * the card's actions sit beside it rather than inside it, as on Ledgers: a
 * screen reader reaches the opener and each action on its own.
 */
function PactCard({
  name,
  penaltyCents,
  editWindowClosesAt = null,
  now = 0,
  chip,
  onOpen,
  children,
}: {
  name: string;
  penaltyCents: number;
  /** For a pact that can still be in its edit window; `now` keeps its chip right. */
  editWindowClosesAt?: string | null;
  now?: number;
  chip: ReactNode;
  onOpen: () => void;
  children?: ReactNode;
}) {
  return (
    <article className={minutesLeft(editWindowClosesAt, now) === null ? "card tcard" : "card tcard fresh"}>
      <div className="spread">
        <span className="namerow">
          <h3>
            <button className="tcard-open" onClick={onOpen}>
              {name}
            </button>
          </h3>
          <EditWindowChip closesAt={editWindowClosesAt} now={now} />
        </span>
        {chip}
      </div>
      <div className="meta pen">{money(penaltyCents)}</div>
      {children}
    </article>
  );
}
