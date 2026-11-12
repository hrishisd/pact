// The Pacts tab: the owner's Active pacts, those in their edit window first,
// then their Ended pacts folded away, each opening its page.

import { api } from "./api.ts";
import { API_PATHS, type PactsResponse } from "../shared/api.ts";
import { minutesLeft, money, scheduleText } from "./format.ts";
import { EditWindowChip, Empty, LoadFailed, loadFailure, loadedData, useLoad, useNow } from "./ui.tsx";

export function Pacts({
  onOpenPact,
  onCreate,
}: {
  onOpenPact: (id: string, name: string) => void;
  onCreate: () => void;
}) {
  const { state } = useLoad(api.pacts, API_PATHS.pacts);
  const all = loadedData(state);
  // A failed reload keeps the pacts shown, under what failed.
  const failed = loadFailure(state);
  const now = useNow();
  const pacts = all?.filter((pact) => pact.stage === "active") ?? null;
  const ended = all?.filter((pact) => pact.stage === "ended") ?? [];
  const row = (pact: PactsResponse[number]) => (
    <button
      key={pact.id}
      className={minutesLeft(pact.editWindowClosesAt, now) === null ? "rowbtn" : "rowbtn fresh"}
      onClick={() => onOpenPact(pact.id, pact.name)}
    >
      <span className="rt">
        <span className="namerow">
          <b>{pact.name}</b>
          <EditWindowChip closesAt={pact.editWindowClosesAt} now={now} />
        </span>
        <small>
          {scheduleText(pact.schedule)} · <span className="pen">{money(pact.penaltyCents)}</span>
        </small>
      </span>
    </button>
  );

  return (
    <div className="stack">
      {failed && <LoadFailed what="Pacts" error={failed.error} />}
      {pacts?.length === 0 && <Empty title="No pacts yet" body="Pacts you create show up here." />}
      {pacts !== null && pacts.length > 0 && (
        <section className="stack">
          <div className="label">Active</div>
          <div className="cards">{pacts.map(row)}</div>
        </section>
      )}
      {/* Below the content (empty card or list); hidden while loading so it doesn't jump. */}
      {(pacts !== null || failed) && (
        <button className="btn primary" onClick={onCreate}>
          New pact
        </button>
      )}
      {ended.length > 0 && (
        <details className="ended">
          <summary>Ended ({ended.length})</summary>
          <div className="cards">{ended.map(row)}</div>
        </details>
      )}
    </div>
  );
}
