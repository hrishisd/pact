// The Pacts tab: the owner's Active pacts, those in their edit window first,
// then their Ended pacts folded away, each opening its page.

import { api, failureText } from "./api.ts";
import type { PactsResponse } from "../shared/api.ts";
import { minutesLeft, money, scheduleText } from "./format.ts";
import { EditWindowChip, Empty, useLoad, useNow } from "./ui.tsx";

export function Pacts({
  onOpenPact,
  onCreate,
}: {
  onOpenPact: (id: string, name: string) => void;
  onCreate: () => void;
}) {
  const { data: all, failed } = useLoad(api.pacts);
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
      {failed && (
        <Empty title="Pacts couldn't load" body={failureText(failed.error, "Check your connection and reopen Pact.")} />
      )}
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
