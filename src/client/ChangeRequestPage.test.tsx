import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ChangeRequestResponse, Json } from "../shared/api.ts";
import { ChangeRequestPage } from "./ChangeRequestPage.tsx";
import { answers, renderWithUser, stubApi } from "./testing/render.tsx";

type ChangeRequestDetail = Extract<Json<ChangeRequestResponse>, { ok: true }>["changeRequest"];

function endRequest(state: ChangeRequestDetail["state"]): ChangeRequestDetail {
  return {
    id: "c1",
    pactId: "gym",
    pactName: "Gym",
    note: null,
    requestedAt: "2026-01-17T17:00:00.000Z",
    current: {
      name: "Gym",
      description: "Me at the gym",
      evidenceKind: "camera",
      schedule: { kind: "weekly-count", target: 3 },
      dueBy: null,
      startDate: null,
      endDate: null,
      penaltyCents: 500,
      recipient: { id: "sam", name: "Sam" },
      reviewers: [{ id: "ana", name: "Ana" }],
    },
    endsPact: true,
    ending: null,
    state,
    reviewerNames: ["Ana"],
    thread: { comments: [], waitingOnReply: false },
  };
}

test("a withdraw refused because it was decided meanwhile says so after the page reloads", async () => {
  stubApi({
    changeRequest: answers<Json<ChangeRequestResponse>>(
      { ok: true, changeRequest: endRequest({ kind: "waiting" }) },
      {
        ok: true,
        changeRequest: endRequest({ kind: "approved", reviewerName: "Ana", decidedAt: "2026-01-17T18:00:00.000Z" }),
      },
    ),
    withdrawChangeRequest: async () => ({ ok: false, reason: "not-waiting" }),
  });
  const { user } = renderWithUser(
    <ChangeRequestPage changeRequestId="c1" timezone="America/New_York" onOpenPact={vi.fn()} />,
  );

  await user.click(await screen.findByRole("button", { name: "Withdraw change" }));

  expect(await screen.findByText("Approved by Ana")).toBeTruthy();
  expect(screen.getByText("It isn't waiting any more, so it wasn't withdrawn.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Withdraw change" })).toBeNull();
});
