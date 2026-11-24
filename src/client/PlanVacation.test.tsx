import { fireEvent, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { VacationOptionsResponse, VacationPreviewRequest, VacationPreviewResponse } from "../shared/api.ts";
import type { VacationPactOption } from "../shared/types.ts";
import { PlanVacation } from "./PlanVacation.tsx";
import { answers, renderWithUser, stubApi } from "./testing/render.tsx";

const SAM = { id: "sam", name: "Sam Rivera" };
const ALEX = { id: "alex", name: "Alex Chen" };

function pact(id: string, name: string, reviewers: { id: string; name: string }[]): VacationPactOption {
  return {
    id,
    name,
    evidenceKind: "camera" as const,
    schedule: { kind: "fixed-days" as const, days: ["mon" as const, "wed" as const, "fri" as const] },
    penaltyCents: 500,
    reviewers,
    alreadyOpen: false,
  };
}

function options(recurring: VacationPactOption[], oneTime: VacationPactOption[] = []): VacationOptionsResponse {
  return { today: "2026-12-09", recurring, oneTime, inEditWindow: false };
}

/** A preview that covers one Monday of every ticked pact; "All pacts" when `all` are ticked. */
function previewOf(all: string[]) {
  return async ({ pactIds }: VacationPreviewRequest): Promise<VacationPreviewResponse> => ({
    ok: true,
    preview: {
      days: 14,
      pacts: all.map((pactId) => ({
        pactId,
        ticked: pactIds.includes(pactId),
        covered: [{ date: "2026-12-21" }],
        skipped: [],
        notCovered: [],
      })),
      summary: all.every((id) => pactIds.includes(id)) ? { kind: "all" } : { kind: "some", names: ["Gym"] },
      coversNothing: pactIds.length === 0,
    },
  });
}

function render() {
  return renderWithUser(<PlanVacation onCancel={vi.fn()} onSent={vi.fn()} />);
}

/** Fills in the Dates step and goes on to Pacts. */
async function pastDates(user: ReturnType<typeof render>["user"]) {
  fireEvent.change(await screen.findByLabelText("First day"), { target: { value: "2026-12-20" } });
  fireEvent.change(screen.getByLabelText("Last day"), { target: { value: "2027-01-02" } });
  await screen.findByText("14 days, Sun Dec 20 – Sat Jan 2.");
  await user.click(screen.getByRole("button", { name: "Next" }));
}

test("the Reviewers step shows with one possible reviewer, and Next waits until they're ticked", async () => {
  stubApi({ vacationOptions: answers(options([pact("gym", "Gym", [SAM])])), vacationPreview: previewOf(["gym"]) });
  const { user } = render();
  await pastDates(user);
  await user.click(screen.getByRole("button", { name: "Next" }));

  expect(screen.getByRole("heading", { name: "Reviewers" })).toBeTruthy();
  expect(screen.getByText("Tick at least one reviewer.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true);

  await user.click(screen.getByRole("checkbox", { name: /Sam Rivera/ }));

  expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", false);
});

test("unticking a pact drops a ticked reviewer who reviews no ticked pact", async () => {
  stubApi({
    vacationOptions: answers(options([pact("gym", "Gym", [ALEX]), pact("bed", "Bed", [SAM])])),
    vacationPreview: previewOf(["gym", "bed"]),
  });
  const { user } = render();
  await pastDates(user);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("checkbox", { name: /Alex Chen/ }));
  await user.click(screen.getByRole("button", { name: "Back" }));

  await user.click(screen.getByRole("checkbox", { name: /^Gym/ }));
  await user.click(screen.getByRole("checkbox", { name: /^Gym/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));

  expect(screen.getByRole("checkbox", { name: /Alex Chen/ })).toHaveProperty("checked", false);
  expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true);
});

test("ticking every offered pact by hand says All pacts on the confirm step", async () => {
  const visa = {
    ...pact("visa", "Visa", [SAM]),
    schedule: { kind: "one-time" as const, deadline: "2026-12-23", submitAnytime: false },
  };
  const spies = stubApi({
    vacationOptions: answers(options([pact("gym", "Gym", [SAM])], [visa])),
    vacationPreview: previewOf(["gym", "visa"]),
  });
  const { user } = render();
  await pastDates(user);

  expect(screen.getByRole("checkbox", { name: /^Visa/ })).toHaveProperty("checked", false);
  await user.click(screen.getByRole("checkbox", { name: /^Visa/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("checkbox", { name: /Sam Rivera/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));

  expect(await screen.findByText("All pacts")).toBeTruthy();
  expect(spies.vacationPreview).toHaveBeenLastCalledWith({
    from: "2026-12-20",
    to: "2027-01-02",
    pactIds: ["gym", "visa"],
  });
});

test("a month the vacation doesn't cover says why, and to do it before the trip", async () => {
  const call = { ...pact("call", "Call Grandma", [SAM]), schedule: { kind: "once-a-month" as const } };
  stubApi({
    vacationOptions: answers(options([call])),
    vacationPreview: async ({ pactIds }: VacationPreviewRequest): Promise<VacationPreviewResponse> => ({
      ok: true,
      preview: {
        days: 14,
        pacts: [
          {
            pactId: "call",
            ticked: pactIds.includes("call"),
            covered: [],
            skipped: [],
            notCovered: [{ date: "2026-12-01", through: "2026-12-31", doItBy: "2026-12-19" }],
          },
        ],
        summary: { kind: "all" },
        coversNothing: true,
      },
    }),
  });
  const { user } = render();
  await pastDates(user);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("checkbox", { name: /Sam Rivera/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));

  expect(await screen.findByText("No whole months off")).toBeTruthy();
  expect(screen.getByText("December isn't off. A vacation covers a month only from the 15th to its end.")).toBeTruthy();
  expect(screen.getByText("Do it by Sat Dec 19. Reminders move to the 7 days before your trip.")).toBeTruthy();
});
