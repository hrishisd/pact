// Evidence's page, for its owner, pushed from a reviewer's question on Today
// or its push: where its review stands, the pact, the day and what counts,
// the photos, the questions so far, and the reply box while a question waits
// on the owner's reply.

import { API_PATHS, type Json } from "../shared/api.ts";
import type { EvidenceDetail } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { listNames } from "./change-terms.tsx";
import { formatDate, formatDayTime } from "./format.ts";
import { CameraIcon } from "./icons.tsx";
import { ReplyBox, Thread, WaitingChip } from "./questions.tsx";
import { Empty, useLoad } from "./ui.tsx";

export function EvidencePage({
  evidenceId,
  timezone,
  onOpenPact,
}: {
  evidenceId: string;
  /** The profile's timezone, for when it was sent and asked about. */
  timezone: string;
  onOpenPact: (pactId: string, name: string) => void;
}) {
  const { data: result, failed, reload } = useLoad(() => api.evidence(evidenceId));

  if (result === null) {
    return failed ? (
      <Empty
        title="This evidence couldn't load"
        body={failureText(failed.error, "Check your connection and reopen Pact.")}
      />
    ) : null;
  }
  if (!result.ok) return <Empty title="Evidence not found" body="It isn't yours." />;
  const { evidence } = result;
  const { state } = evidence;
  return (
    <>
      <div className="row2">
        <span className="kind k-evidence">
          <CameraIcon />
          Evidence
        </span>
        <StateChip evidence={evidence} />
      </div>
      <article className="card">
        <div className="spread">
          <h3>
            <button className="link" onClick={() => onOpenPact(evidence.pactId, evidence.pactName)}>
              {evidence.pactName}
            </button>
          </h3>
          <span className="meta">{formatDate(evidence.occurrenceDate)}</span>
        </div>
        <div className="stack-sm">
          <span className="label">What counts</span>
          <span>{evidence.description}</span>
        </div>
        {state.kind === "rejected" && (
          <p className="small">
            {state.reviewerName} said “{state.reason}”
          </p>
        )}
        {evidence.photoIds.map((photoId, i) => {
          const src = API_PATHS.photo(encodeURIComponent(photoId));
          return (
            // Opens the photo full size in a new tab.
            <a key={photoId} href={src} target="_blank" rel="noreferrer">
              <img className="big-photo" src={src} alt={`Photo ${i + 1} of ${evidence.photoIds.length}`} />
            </a>
          );
        })}
      </article>
      <Thread thread={evidence.thread} viewer="owner" timezone={timezone} />
      {evidence.thread.waitingOnReply && <ReplyBox itemId={evidence.id} onReplied={reload} />}
      <p className="meta">
        Sent to {listNames(evidence.reviewerNames)} · {formatDayTime(evidence.submittedAt, timezone)}
      </p>
    </>
  );
}

function StateChip({ evidence }: { evidence: Json<EvidenceDetail> }) {
  const { state } = evidence;
  switch (state.kind) {
    case "waiting":
      return <WaitingChip thread={evidence.thread} />;
    case "approved":
      return <span className="chip c-satisfied">Approved by {state.reviewerName}</span>;
    case "rejected":
      return <span className="chip c-missed">Rejected by {state.reviewerName}</span>;
  }
}
