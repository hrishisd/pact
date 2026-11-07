// Evidence's page, for its owner, pushed from a reviewer's question on Today
// or its push: where its review stands, the pact, the day and what counts,
// the photos, the questions so far, and the reply box while a question waits
// on the owner's reply.

import type { Json } from "../shared/api.ts";
import type { EvidenceDetail } from "../shared/types.ts";
import { api } from "./api.ts";
import { formatDate } from "./format.ts";
import { ItemKindHeader, ItemStateChip, OwnerThread, PhotoLinks, RejectionLine, SentTo } from "./item-page.tsx";
import { LoadedFound, useLoad } from "./ui.tsx";

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
  const { state, reload } = useLoad(() => api.evidence(evidenceId));

  return (
    <LoadedFound state={state} what="This evidence" notFound={{ title: "Evidence not found", body: "It isn't yours." }}>
      {({ evidence }) => (
        <EvidenceView evidence={evidence} timezone={timezone} onOpenPact={onOpenPact} onReplied={reload} />
      )}
    </LoadedFound>
  );
}

function EvidenceView({
  evidence,
  timezone,
  onOpenPact,
  onReplied,
}: {
  evidence: Json<EvidenceDetail>;
  timezone: string;
  onOpenPact: (pactId: string, name: string) => void;
  onReplied: () => void;
}) {
  return (
    <>
      <ItemKindHeader kind="evidence">
        <ItemStateChip state={evidence.state} thread={evidence.thread} />
      </ItemKindHeader>
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
        <RejectionLine state={evidence.state} />
        <PhotoLinks photoIds={evidence.photoIds} />
      </article>
      <OwnerThread itemId={evidence.id} thread={evidence.thread} timezone={timezone} onReplied={onReplied} />
      <SentTo reviewerNames={evidence.reviewerNames} sentAt={evidence.submittedAt} timezone={timezone} />
    </>
  );
}
