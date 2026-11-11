import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FriendsResponse } from "../shared/api.ts";
import { PactPage } from "./PactPage.tsx";
import { answers, cameraPact, onOurSide, renderWithUser, stubApi } from "./testing/render.tsx";

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

describe("the Add a reviewer sheet", () => {
  const openSheet = async (user: Awaited<ReturnType<typeof renderPactPage>>["user"]) =>
    user.click(await screen.findByRole("button", { name: "Add a reviewer" }));

  test("with no other friends, says only friends can review", async () => {
    stubApi({ pact: answers({ ok: true, pact: cameraPact() }), friends: answers([{ id: "ana", name: "Ana" }]) });
    const { user } = renderPactPage();
    await openSheet(user);
    expect(await screen.findByText(/Only friends can review your pacts/)).toBeTruthy();
  });

  test("a failed friends load says so, and not that there are no friends", async () => {
    stubApi({ pact: answers({ ok: true, pact: cameraPact() }), friends: answers<FriendsResponse>(onOurSide) });
    const { user } = renderPactPage();
    await openSheet(user);
    expect(await screen.findByText(/Your friends couldn't load\./)).toBeTruthy();
    expect(screen.getByText(/Something went wrong on our side\. Try again in a minute\./)).toBeTruthy();
    expect(screen.queryByText(/Only friends can review your pacts/)).toBeNull();
  });

  test("Try again after a failed load shows the friends who loaded", async () => {
    stubApi({
      pact: answers({ ok: true, pact: cameraPact() }),
      friends: answers<FriendsResponse>(onOurSide, [
        { id: "ana", name: "Ana" },
        { id: "bo", name: "Bo" },
      ]),
    });
    const { user } = renderPactPage();
    await openSheet(user);
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Bo")).toBeTruthy();
    expect(screen.queryByText(/Your friends couldn't load/)).toBeNull();
  });
});

test("a pact whose end was approved says when it ends, and offers neither End pact nor Request change", async () => {
  stubApi({ pact: answers({ ok: true, pact: { ...cameraPact(), ending: { lastDay: "2026-01-08" } } }) });
  renderPactPage();

  expect(
    await screen.findByText(
      "Ending approved: Gym ends after Thu Jan 8, once that day is judged. Penalties already judged stay on the ledger.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "End pact" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Request change" })).toBeNull();
});

test("an Active pact past its edit window offers End pact and Request change", async () => {
  stubApi({ pact: answers({ ok: true, pact: cameraPact() }) });
  renderPactPage();

  expect(await screen.findByRole("button", { name: "End pact" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Request change" })).toBeTruthy();
});
