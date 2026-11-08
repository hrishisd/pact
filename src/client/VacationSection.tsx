// The Profile sheet's Vacation section: the owner's vacations waiting for
// approval, each with Withdraw, and Plan a vacation below them.

import { useState } from "react";
import type { Json } from "../shared/api.ts";
import type { VacationCard } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { listNames } from "./change-terms.tsx";
import { loadedData, loadFailure, useLoad, useSend } from "./ui.tsx";
import { dateSpan, pactsText, plural } from "./vacation-text.ts";

const WITHDRAWN = "Vacation withdrawn. Your pacts keep all their days.";

export function VacationSection({ message, onPlan }: { message: string | null; onPlan: () => void }) {
  const { state, reload } = useLoad(api.vacations);
  const vacations = loadedData(state);
  const [said, setSaid] = useState(message);

  return (
    <section className="stack">
      {said && (
        <div className="alert ok" role="status">
          <b>{said}</b>
        </div>
      )}
      <div className="label">Vacation</div>
      {loadFailure(state) && <p className="muted small">Vacations couldn't load.</p>}
      {vacations?.map((vacation) => (
        <WaitingCard
          key={vacation.id}
          vacation={vacation}
          onWithdrawn={() => {
            setSaid(WITHDRAWN);
            reload();
          }}
        />
      ))}
      <div className="spread">
        {vacations?.length === 0 ? <span className="muted">None planned</span> : <span />}
        <button className="link" onClick={onPlan}>
          Plan a vacation
        </button>
      </div>
    </section>
  );
}

/** "Sent to Sam Rivera and Alex Chen. …", or with one reviewer "Sam Rivera reviews it. …". */
function sentTo(names: string[]): string {
  return names.length === 1
    ? `${names[0]} reviews it. Nothing changes until it's approved.`
    : `Sent to ${listNames(names)}. Nothing changes until one of them approves it.`;
}

function WaitingCard({ vacation, onWithdrawn }: { vacation: Json<VacationCard>; onWithdrawn: () => void }) {
  const [asking, setAsking] = useState(false);
  const { busy, error, run } = useSend(
    async () => {
      const result = await api.withdrawVacation(vacation.id);
      if (!result.ok) return "It's no longer waiting for approval. Reopen Profile to see where it stands.";
      onWithdrawn();
    },
    (failure) => `Couldn't withdraw. ${failureText(failure, "Check your connection and try again.")}`,
  );

  return (
    <div className="card vaccard">
      <div className="spread">
        <b>Vacation {dateSpan(vacation.from, vacation.to)}</b>
        <span className="chip c-wait">Waiting for approval</span>
      </div>
      {vacation.note && <div className="vacnote">{vacation.note}</div>}
      <small className="muted">
        {pactsText(vacation.pacts)} · {plural(vacation.days, "day", "days")}
      </small>
      <small>{sentTo(vacation.reviewerNames)}</small>
      {asking ? (
        <div className="alert amber" role="status">
          <span>Withdraw this vacation? Your pacts keep all their days.</span>
          <div className="row2">
            <button className="btn sm danger" disabled={busy} onClick={() => run()}>
              {busy ? "Withdrawing…" : "Withdraw"}
            </button>
            <button className="btn sm" disabled={busy} onClick={() => setAsking(false)}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="row2">
          <button className="btn sm danger" onClick={() => setAsking(true)}>
            Withdraw
          </button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
