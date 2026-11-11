// The registry of review item kinds: one handler each (`RequestKindHandler`,
// requests.ts), kept beside its kind's own code. A new kind is one handler
// and one entry here.

import { changeRequestKind } from "./change-requests.ts";
import { evidenceKind } from "./evidence.ts";
import { excuseKind } from "./excuses.ts";
import { paymentKind } from "./money.ts";
import type { RequestKind, RequestKindHandler, RequestRow } from "./requests.ts";
import { vacationKind } from "./vacations.ts";

export const REQUEST_KINDS: { readonly [K in RequestKind]: RequestKindHandler<RequestRow & { kind: K }> } = {
  "change-request": changeRequestKind,
  evidence: evidenceKind,
  excuse: excuseKind,
  payment: paymentKind,
  vacation: vacationKind,
};

/**
 * Every kind's handler, in the order lists of several kinds keep for items
 * at the same time: change requests, evidence, excuses, payments, vacations.
 */
export const REQUEST_HANDLERS: readonly RequestKindHandler<RequestRow>[] = Object.values(REQUEST_KINDS);
