// How each bedtime evidence kind's sleep reaches Pact, as the screens word
// it: Oura Ring from the ring, Apple Health from the Pact Health Shortcut.
// Everything else about a night is worded alike.

import { isBedtimeKind } from "../shared/evidence-kinds.ts";
import type { BedtimeKind, EvidenceKind } from "../shared/types.ts";

/** `kind` when it's a bedtime kind; undefined for Camera and Anki. */
export function bedtimeKindOf(kind: EvidenceKind): BedtimeKind | undefined {
  return isBedtimeKind(kind) ? kind : undefined;
}

interface BedtimeText {
  /** A night past its in-bed-by time whose sleep hasn't arrived: its chip and Today's card. */
  noData: string;
  /** After "In bed by 12:30am, " on the pact's page. */
  judgedFrom: string;
  /** Under the in-bed-by time on the Goal step. */
  goalHint: string;
  /** Before "If there's no sleep data by 6pm…" on the Schedule step. */
  checks: string;
  /** Why reminders go off even when the owner is in bed. */
  remindersHint: string;
  /** What decides each night, before "so there are no photos to review" on the Reviewers step. */
  decides: string;
}

export const BEDTIME_TEXT: Record<BedtimeKind, BedtimeText> = {
  oura: {
    noData: "No Oura data",
    judgedFrom: "judged from your ring",
    goalHint: "If your ring shows you got into bed after this time, the night is missed.",
    checks: "Pact checks each night when your ring syncs.",
    remindersHint: "Pact can't tell you're in bed until your ring syncs.",
    decides: "Your ring decides each night",
  },
  apple_health: {
    noData: "No Apple Health data",
    judgedFrom: "judged from Apple Health",
    goalHint: "If Apple Health shows you got into bed after this time, the night is missed.",
    checks: "Pact judges each night when your Pact Health Shortcut sends your sleep.",
    remindersHint: "Pact can't tell you're in bed until your Pact Health Shortcut sends your sleep.",
    decides: "Apple Health decides each night",
  },
};

/** When the owner got into bed, and for an Apple Health night the app its sleep came from: "1:59am · Oura". */
export function inBedText(inBedAt: string, source: string | undefined): string {
  return source ? `${inBedAt} · ${source}` : inBedAt;
}
