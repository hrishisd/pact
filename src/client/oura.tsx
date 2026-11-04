// Oura pieces more than one screen uses: the alert when Pact can't read the
// owner's Oura (Today and a bedtime pact's page), and how a trip through
// Oura's connect page went.

import { OURA_RECONNECT_PATH, OURA_RESULT_PARAM, type OuraResult } from "../shared/api.ts";
import type { ConnectionProblem } from "../shared/types.ts";

/**
 * How connecting Oura went, when Oura's callback just brought the browser
 * back: read once, then taken off the URL so a reload doesn't repeat it.
 */
export function takeOuraResult(): OuraResult | null {
  const params = new URLSearchParams(window.location.search);
  const result = params.get(OURA_RESULT_PARAM);
  if (result === null) return null;
  params.delete(OURA_RESULT_PARAM);
  const search = params.toString();
  window.history.replaceState(window.history.state, "", window.location.pathname + (search ? `?${search}` : ""));
  return result === "connected" || result === "cancelled" || result === "unavailable" ? result : "failed";
}

/** What to say when a trip to Oura's page didn't connect; nothing when it did, or the owner said no there. */
export function ouraResultText(result: OuraResult | null): string | null {
  if (result === "failed") return "Oura didn't connect. Try again.";
  if (result === "unavailable") return "Oura isn't set up yet.";
  return null;
}

/**
 * Pact can't read the owner's Oura while a bedtime pact needs it. Reconnect
 * is a full page load: Oura's page, then back to Today.
 */
export function OuraConnectionAlert({ status, error }: { status: ConnectionProblem; error?: string | null }) {
  return (
    <div className="alert bad" role="status">
      <span>
        <b>{status === "needs-reconnecting" ? "Oura needs reconnecting." : "Oura is disconnected."}</b> A night with no
        data by 6pm counts as Missed. Reconnect before then.
      </span>
      <div className="row2">
        <a className="btn sm primary" href={OURA_RECONNECT_PATH}>
          Reconnect Oura
        </a>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
