// What an evidence kind says about its pacts, for the core and the client alike.

import { BEDTIME_KINDS, type BedtimeKind, type EvidenceKind } from "./types.ts";

/**
 * Whether pacts of `kind` are bedtime pacts: Fixed days nights with an
 * in-bed-by time, judged from the owner's sleep rather than submitted
 * evidence. Not whether they need the Oura connection: that's the kind's
 * service (`SERVICE_OF_KIND`, pacts.ts).
 */
export function isBedtimeKind(kind: EvidenceKind): kind is BedtimeKind {
  return (BEDTIME_KINDS as readonly EvidenceKind[]).includes(kind);
}

/** `isBedtimeKind` for something carrying its evidence kind, such as a pact's terms: narrows it to its bedtime form. */
export function isBedtimePact<T extends { evidenceKind: EvidenceKind }>(
  pact: T,
): pact is Extract<T, { evidenceKind: BedtimeKind }> {
  return isBedtimeKind(pact.evidenceKind);
}
