// Today's banner during an approved vacation, from its first to its last day:
// until when, the note, which pacts are Excused, and See what's excused, which
// lists what each covered pact gives up, worded as Plan a vacation's check step.

import { useState } from "react";
import type { Json } from "../shared/api.ts";
import type { TodayVacation } from "../shared/types.ts";
import { listNames } from "./change-terms.tsx";
import { formatDate } from "./format.ts";
import { coveredText } from "./vacation-text.ts";

export function VacationBanner({ vacation }: { vacation: Json<TodayVacation> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="alert info vacban" role="status">
      <b>On vacation until {formatDate(vacation.to)}</b>
      {vacation.note && <span>{vacation.note}</span>}
      <span className="small">{excusedText(vacation)}</span>
      <div className="row2">
        <button className="btn sm" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "See what's excused"}
        </button>
      </div>
      {open && (
        <div className="list">
          {vacation.covers.map((pact) => {
            const { head, lines } = coveredText(pact, pact.covered, vacation.from, vacation.to);
            return (
              <div key={pact.pactId} className="covrow">
                <span className="rt">
                  <b>{pact.name}</b>
                  <small>{head}</small>
                  {lines.map((line) => (
                    <small key={line}>{line}</small>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "Bed by midnight and Gym are Excused on these days, …", or "Your pacts are …" when it covers every pact. */
function excusedText({ pacts, covers }: Json<TodayVacation>): string {
  const names = covers.map((pact) => pact.name);
  const which = pacts.kind === "all" ? "Your pacts are" : `${listNames(names)} ${names.length === 1 ? "is" : "are"}`;
  return `${which} excused on these days. You won't get reminders or penalties.`;
}
