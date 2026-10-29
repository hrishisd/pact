// The Pacts tab: the owner's Active pacts, each opening its page.

import { api } from "./api.ts";
import { money, scheduleText } from "./format.ts";
import { Empty, useLoad } from "./ui.tsx";

export function Pacts({ onOpenPact, onCreate }: { onOpenPact: (id: string, name: string) => void; onCreate: () => void }) {
  const { data: pacts, failed } = useLoad(api.pacts);

  return (
    <div className="stack">
      {failed && <Empty title="Pacts couldn't load" body="Check your connection and reopen Pact." />}
      {pacts?.length === 0 && <Empty title="No pacts yet" body="Pacts you create show up here." />}
      {pacts !== null && pacts.length > 0 && (
        <section className="stack">
          <div className="label">Active</div>
          <div className="cards">
            {pacts.map((pact) => (
              <button key={pact.id} className="rowbtn" onClick={() => onOpenPact(pact.id, pact.name)}>
                <span className="rt">
                  <b>{pact.name}</b>
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
