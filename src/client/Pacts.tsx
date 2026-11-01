// The Pacts tab: the owner's Active pacts, those in their edit window first, each opening its page.

import { api, failureText } from "./api.ts";
import { minutesLeft, money, scheduleText } from "./format.ts";
import { EditWindowChip, Empty, useLoad, useNow } from "./ui.tsx";

export function Pacts({
  onOpenPact,
  onCreate,
}: {
  onOpenPact: (id: string, name: string) => void;
  onCreate: () => void;
}) {
  const { data: pacts, failed } = useLoad(api.pacts);
  const now = useNow();

  return (
    <div className="stack">
      {failed && (
        <Empty title="Pacts couldn't load" body={failureText(failed.error, "Check your connection and reopen Pact.")} />
      )}
      {pacts?.length === 0 && <Empty title="No pacts yet" body="Pacts you create show up here." />}
      {pacts !== null && pacts.length > 0 && (
        <section className="stack">
          <div className="label">Active</div>
          <div className="cards">
            {pacts.map((pact) => (
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
            ))}
          </div>
        </section>
      )}
      {/* Below the content (empty card or list); hidden while loading so it doesn't jump. */}
      {(pacts !== null || failed) && (
        <button className="btn primary" onClick={onCreate}>
          New pact
        </button>
      )}
    </div>
  );
}
