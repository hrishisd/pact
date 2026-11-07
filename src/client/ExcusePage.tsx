// An excuse's page, pushed on the current tab: where its review stands, its
// pact and dates, the reason and photos, each day it covers as it stands now,
// who it was sent to, and any questions about it, with the reply box while
// one waits on the owner's reply. It opens from Today, a pact's page, an
// approved excuse's push and a reviewer's question.

import { API_PATHS, type Json } from "../shared/api.ts";
import type { ExcuseDetail } from "../shared/types.ts";
import { api } from "./api.ts";
import { listNames } from "./change-terms.tsx";
import { DayChip, excuseDatesText, excuseDayText } from "./excuse-days.tsx";
import { formatDayTime } from "./format.ts";
import { ExcuseIcon } from "./icons.tsx";
import { ReplyBox, Thread, WaitingChip } from "./questions.tsx";
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
  const { state } = excuse;
  return (
    <>
      <div className="row2">
        <span className="kind k-excuse">
          <ExcuseIcon />
          Excuse
        </span>
        <StateChip excuse={excuse} />
      </div>
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
        {state.kind === "rejected" && (
          <p className="small">
            {state.reviewerName} said “{state.reason}”
          </p>
        )}
        {excuse.photoIds.map((photoId, i) => {
          const src = API_PATHS.photo(encodeURIComponent(photoId));
          return (
            // Opens the photo full size in a new tab.
            <a key={photoId} href={src} target="_blank" rel="noreferrer">
              <img className="big-photo" src={src} alt={`Photo ${i + 1} of ${excuse.photoIds.length}`} />
            </a>
          );
        })}
      </article>
      <section className="stack">
        <div className="label">Days</div>
        <div className="list">
          {excuse.days.map((day) => (
            <div key={day.date} className="covrow">
              <span className="rt">
                <b>{excuseDayText(day)}</b>
              </span>
              <DayChip status={day.status} now={now} week={day.through !== undefined} />
            </div>
          ))}
        </div>
      </section>
      <Thread thread={excuse.thread} viewer="owner" timezone={timezone} />
      {excuse.thread.waitingOnReply && <ReplyBox itemId={excuse.id} onReplied={onReplied} />}
      <p className="meta">
        Sent to {listNames(excuse.reviewerNames)} · {formatDayTime(excuse.filedAt, timezone)}
      </p>
    </>
  );
}

function StateChip({ excuse }: { excuse: Json<ExcuseDetail> }) {
  const { state } = excuse;
  switch (state.kind) {
    case "waiting":
      return <WaitingChip thread={excuse.thread} />;
    case "approved":
      return <span className="chip c-excused">Approved by {state.reviewerName}</span>;
    case "rejected":
      return <span className="chip c-missed">Rejected by {state.reviewerName}</span>;
  }
}
