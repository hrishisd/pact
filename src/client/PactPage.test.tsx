import { screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { PactPage } from "./PactPage.tsx";
import { answers, cameraPact, renderWithUser, stubApi } from "./testing/render.tsx";

// Five minutes into Gym's edit window.
const NOW = "2026-01-05T15:00:00Z";
const IN_EDIT_WINDOW = cameraPact("2026-01-05T15:05:00Z");

function renderPactPage(onDeleted = vi.fn()) {
  return renderWithUser(
    <PactPage
      pactId="gym"
      timezone="America/New_York"
      onLoaded={vi.fn()}
      onEdit={vi.fn()}
      onDeleted={onDeleted}
      onRequestChange={vi.fn()}
      onOpenExcuse={vi.fn()}
      onOpenChangeRequest={vi.fn()}
      onInvite={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
});

test("a delete that goes through stays Deleting… while the page goes Back", async () => {
  stubApi({ pact: answers({ ok: true, pact: IN_EDIT_WINDOW }), deletePact: answers({ ok: true }) });
  const onDeleted = vi.fn();
  const { user } = renderPactPage(onDeleted);
  await user.click(await screen.findByRole("button", { name: "Delete" }));
  await user.click(screen.getByRole("button", { name: "Delete pact" }));

  expect(onDeleted).toHaveBeenCalledTimes(1);
  const deleting = screen.getByRole("button", { name: "Deleting…" });
  expect((deleting as HTMLButtonElement).disabled).toBe(true);
});

test("a refused delete offers Delete pact again, with why", async () => {
  stubApi({
    pact: answers({ ok: true, pact: IN_EDIT_WINDOW }),
    deletePact: answers({ ok: false, reason: "edit-window-closed" }),
  });
  const onDeleted = vi.fn();
  const { user } = renderPactPage(onDeleted);
  await user.click(await screen.findByRole("button", { name: "Delete" }));
  await user.click(screen.getByRole("button", { name: "Delete pact" }));

  expect(await screen.findByText("The 10 minutes are up.")).toBeTruthy();
  expect(onDeleted).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Delete pact" }) as HTMLButtonElement).disabled).toBe(false);
});
