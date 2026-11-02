// An excuse's page, pushed on the current tab: where its review stands, its
// pact and dates, the reason and photos, each day it covers as it stands now,
// and who it was sent to. It opens from Today, a pact's page and an approved
// excuse's push.

import { API_PATHS, type Json } from "../shared/api.ts";
import type { ExcuseState } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { DayChip, excuseDatesText } from "./excuse-days.tsx";
import { formatDate, formatDayTime } from "./format.ts";
import { ExcuseIcon } from "./icons.tsx";
import { Empty, useLoad, useNow } from "./ui.tsx";

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
  const { data: result, failed } = useLoad(() => api.excuse(excuseId));
  const now = useNow();

  if (result === null) {
    return failed ? (
      <Empty
        title="This excuse couldn't load"
        body={failureText(failed.error, "Check your connection and reopen Pact.")}
      />
    ) : null;
  }
  if (!result.ok) return <Empty title="Excuse not found" body="It isn't one of yours." />;
  const { excuse } = result;
  const { state } = excuse;
  return (
    <>
      <div className="row2">
        <span className="kind k-excuse">
          <ExcuseIcon />
          Excuse
        </span>
        <StateChip state={state} />
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
                <b>{formatDate(day.date)}</b>
              </span>
              <DayChip status={day.status} now={now} />
            </div>
          ))}
        </div>
      </section>
      <p className="meta">
        Sent to {excuse.reviewerNames.join(" and ")} · {formatDayTime(excuse.filedAt, timezone)}
      </p>
    </>
  );
}

function StateChip({ state }: { state: Json<ExcuseState> }) {
  switch (state.kind) {
    case "waiting":
      return <span className="chip c-wait">Waiting for approval</span>;
    case "approved":
      return <span className="chip c-excused">Approved by {state.reviewerName}</span>;
    case "rejected":
      return <span className="chip c-missed">Rejected by {state.reviewerName}</span>;
  }
}
