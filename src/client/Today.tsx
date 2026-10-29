// The Today tab: what's open now, then what's coming up.

import { useEffect, useState, type ReactNode } from "react";
import type { Json } from "../shared/api.ts";
import type { TodaySection } from "../shared/types.ts";
import { api } from "./api.ts";
import { formatDate, money, timeLeft } from "./format.ts";
import { Empty, useLoad } from "./ui.tsx";

export function Today({
  onOpenPact,
  onCreate,
  onInvite,
}: {
  onOpenPact: (id: string, name: string) => void;
  onCreate: () => void;
  onInvite: () => void;
}) {
  const { data: today, failed } = useLoad(api.today);
  const now = useNow();

  if (failed) return <Empty title="Today couldn't load" body="Check your connection and reopen Pact." />;
  if (today === null) return null;

  // Story 4: a new user's first screen says what to do next.
  if (!today.hasPacts) {
    return (
      <Empty title="Nothing to do right now" body="Invite a friend to review your pacts, then create your first pact.">
        <div className="row2">
          <button className="btn primary" onClick={onInvite}>
            Invite a friend
          </button>
          <button className="btn" onClick={onCreate}>
            Create a pact
          </button>
        </div>
      </Empty>
    );
  }
  if (today.alerts.length === 0 && today.sections.length === 0) {
    return <Empty title="Nothing to do right now" body="When one of your pacts needs something from you, it shows up here." />;
  }
  return (
    <>
      {today.sections.map((section) => (
        <Section key={section.kind} section={section} now={now} onOpenPact={onOpenPact} />
      ))}
    </>
  );
}

function Section({
  section,
  now,
  onOpenPact,
}: {
  section: Json<TodaySection>;
  now: number;
  onOpenPact: (id: string, name: string) => void;
}) {
  switch (section.kind) {
    case "to-do":
      return section.cards.map((card) => (
        <PactCard key={card.pactId} name={card.name} penaltyCents={card.penaltyCents} chip={<span className="chip c-todo">To do</span>} onOpen={() => onOpenPact(card.pactId, card.name)}>
          <div className="meta due">Due at midnight · {timeLeft(Date.parse(card.dueAt) - now)}</div>
        </PactCard>
      ));
    case "coming-up":
      return (
        <section className="stack">
          <div className="label">Coming up</div>
          {section.cards.map((card) => (
            <PactCard
              key={card.pactId}
              name={card.name}
              penaltyCents={card.penaltyCents}
              chip={<span className="chip c-soon">Opens {formatDate(card.opensOn)}</span>}
              onOpen={() => onOpenPact(card.pactId, card.name)}
            />
          ))}
        </section>
      );
  }
}

/** A Today card: the pact's name, a chip, its penalty in red, then whatever the section adds. Tapping it opens the pact. */
function PactCard({
  name,
  penaltyCents,
  chip,
  onOpen,
  children,
}: {
  name: string;
  penaltyCents: number;
  chip: ReactNode;
  onOpen: () => void;
  children?: ReactNode;
}) {
  return (
    <article
      className="card tcard"
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
    >
      <div className="spread">
        <h3>{name}</h3>
        {chip}
      </div>
      <div className="meta pen">{money(penaltyCents)}</div>
      {children}
    </article>
  );
}

/** The current time, updated each minute so countdowns stay right. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
