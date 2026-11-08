// Reads the scenarios share: a command's or query's answer unwrapped, and
// the parts of a pact, Today and the ledgers that tests assert on.

import { termsOf } from "../../shared/terms.ts";
import type { PactChange, TodaySection } from "../../shared/types.ts";
import type { AccountHandle } from "./scenario.ts";

/** `result` when it's `{ ok: true }`; throws its refusal's reason otherwise. */
export function ok<T extends { ok: true } | { ok: false; reason: string }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(result.reason);
  return result as Extract<T, { ok: true }>;
}

/** The pact page for `pactId`, as `owner` sees it; throws if it's not found. */
export function pactOf(owner: AccountHandle, pactId: string) {
  return ok(owner.pact(pactId)).pact;
}

/**
 * The pact's terms as they stand, with `change` made, as the Request change
 * form sends them. A key set to undefined in `change` removes that term.
 */
export function changed(owner: AccountHandle, pactId: string, change: Partial<PactChange>): PactChange {
  const terms: Record<string, unknown> = { ...termsOf(pactOf(owner, pactId)), ...change };
  for (const key of Object.keys(terms)) if (terms[key] === undefined) delete terms[key];
  return terms as unknown as PactChange;
}

/** A Fixed days pact's heat map, a square per day; throws for another schedule's. */
export function heatMapDays(owner: AccountHandle, pactId: string) {
  const { history } = pactOf(owner, pactId);
  if (history.kind !== "fixed-days") throw new Error(`a ${history.kind} heat map`);
  return history.days;
}

/** The occurrence on `date` as a Fixed days pact's heat map shows it, or undefined if that day has none. */
export function dayOn(owner: AccountHandle, pactId: string, date: string) {
  return heatMapDays(owner, pactId).find((day) => day.date === date)?.occurrence;
}

/** How the occurrence on `date` stands on a Fixed days pact's heat map, or undefined if that day has none. */
export function statusOn(owner: AccountHandle, pactId: string, date: string) {
  return dayOn(owner, pactId, date)?.status.kind;
}

/** The cards in the owner's Today section `kind`; none if Today has no such section. */
export function cards<K extends TodaySection["kind"]>(owner: AccountHandle, kind: K): CardsIn[K] {
  const section = owner.today().sections.find((s) => s.kind === kind);
  return (section?.cards ?? []) as CardsIn[K];
}

type CardsIn = { [S in TodaySection as S["kind"]]: S["cards"] };

/** The kinds of the owner's Today sections, in order. */
export function sectionKinds(owner: AccountHandle): TodaySection["kind"][] {
  return owner.today().sections.map((section) => section.kind);
}

/** What the owner owes on their first ledger (by recipient name), or 0 with no ledger. */
export function owed(owner: AccountHandle): number {
  return owner.ledgers()[0]?.owedCents ?? 0;
}

/** Each penalty on the owner's ledgers, oldest first: its day, amount, recipient and pact. */
export function penalties(owner: AccountHandle) {
  return owner
    .ledgers()
    .flatMap((summary) =>
      ok(owner.ledger(summary.recipientId)).ledger.history.flatMap((entry) =>
        entry.kind === "penalty"
          ? [
              {
                date: entry.occurrenceDate,
                cents: entry.amountCents,
                recipient: summary.name,
                pactName: entry.pactName,
              },
            ]
          : [],
      ),
    )
    .sort((a, b) => a.date.localeCompare(b.date, "en-US"));
}

/** The days with a penalty on the owner's ledgers, oldest first: only the pact `pactName`'s, if given. */
export function penaltyDays(owner: AccountHandle, pactName?: string): string[] {
  return penalties(owner)
    .filter((penalty) => pactName === undefined || penalty.pactName === pactName)
    .map((penalty) => penalty.date);
}

/** The history of the owner's first ledger (by recipient name), newest first; throws if they have none. */
export function ledgerHistory(owner: AccountHandle) {
  const [summary] = owner.ledgers();
  if (!summary) throw new Error("no ledger");
  return ok(owner.ledger(summary.recipientId)).ledger.history;
}
