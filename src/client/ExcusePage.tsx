// An excuse's page, pushed on the current tab: where its review stands, its
// pact and dates, the reason and photos, each day it covers as it stands now,
// who it was sent to, and any questions about it, with the reply box while
// one waits on the owner's reply. It opens from Today, a pact's page, an
// approved excuse's push and a reviewer's question.

import type { Json } from "../shared/api.ts";
import type { ExcuseDetail } from "../shared/types.ts";
import { api } from "./api.ts";
import { DayChip, excuseDatesText, excuseDayText } from "./excuse-days.tsx";
import { ItemKindHeader, ItemStateChip, OwnerThread, PhotoLinks, StateLine, SentTo } from "./item-page.tsx";
import { LoadedFound, useLoad, useNow } from "./ui.tsx";

export function ExcusePage({
  excuseId,
  timezone,
  onOpenPact,
}: {
  excuseId: string;
  /** The profile's timezone, for when it was sent. */
  timezone: string;
  onOpenPact: (pactId: string, name: string) => void;
}) {
  const { state, reload } = useLoad(() => api.excuse(excuseId));

  return (
    <LoadedFound
      state={state}
      what="This excuse"
      notFound={{ title: "Excuse not found", body: "It isn't one of yours." }}
    >
      {({ excuse }) => <ExcuseView excuse={excuse} timezone={timezone} onOpenPact={onOpenPact} onReplied={reload} />}
    </LoadedFound>
  );
}

function ExcuseView({
  excuse,
  timezone,
  onOpenPact,
  onReplied,
}: {
  excuse: Json<ExcuseDetail>;
  timezone: string;
  onOpenPact: (pactId: string, name: string) => void;
  onReplied: () => void;
}) {
  const now = useNow();
  return (
    <>
      <ItemKindHeader kind="excuse">
        <ItemStateChip state={excuse.state} thread={excuse.thread} approvedClass="c-excused" />
      </ItemKindHeader>
      <article className="card">
        <div className="stack-sm">
          <h3>
            <button className="link" onClick={() => onOpenPact(excuse.pactId, excuse.pactName)}>
              {excuse.pactName}
            </button>
          </h3>
          <span className="meta">{excuseDatesText(excuse.days)}</span>
        </div>
        <span className="excuse-reason">“{excuse.reason}”</span>
        <StateLine state={excuse.state} timezone={timezone} />
        <PhotoLinks photoIds={excuse.photoIds} />
      </article>
      <section className="stack">
        <div className="label">Days</div>
        <div className="list">
          {excuse.days.map((day) => (
            <div key={day.date} className="covrow">
              <span className="rt">
                <b>{excuseDayText(day)}</b>
              </span>
              <DayChip status={day.status} now={now} timezone={timezone} week={day.through !== undefined} />
            </div>
          ))}
        </div>
      </section>
      <OwnerThread itemId={excuse.id} thread={excuse.thread} timezone={timezone} onReplied={onReplied} />
      <SentTo reviewerNames={excuse.reviewerNames} sentAt={excuse.filedAt} timezone={timezone} />
    </>
  );
}
