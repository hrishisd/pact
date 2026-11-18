import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ExcuseResponse, Json } from "../shared/api.ts";
import { ExcusePage } from "./ExcusePage.tsx";
import { answers, renderWithUser, stubApi } from "./testing/render.tsx";

type ExcuseDetail = Extract<Json<ExcuseResponse>, { ok: true }>["excuse"];

const excuse: ExcuseDetail = {
  id: "away",
  pactId: "gym",
  pactName: "Gym",
  reason: "Away",
  photoIds: [],
  filedAt: "2026-01-06T17:00:00.000Z",
  days: [],
  state: { kind: "withdrawn", reason: "pact-ended", withdrawnAt: "2026-01-07T17:00:00.000Z", pactNames: ["Gym"] },
  reviewerNames: ["Sam"],
  thread: { comments: [], waitingOnReply: false },
};

test("an excuse withdrawn when its pact Ended, its days past the end, says why and lists no days", async () => {
  stubApi({ excuse: answers({ ok: true, excuse }) });

  renderWithUser(<ExcusePage excuseId="away" timezone="America/New_York" onOpenPact={vi.fn()} />);

  expect(await screen.findByText(/Withdrawn because the pact ended/)).toBeTruthy();
  expect(screen.queryByText("Days")).toBeNull();
});
