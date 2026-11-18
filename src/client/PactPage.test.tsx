import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FriendsResponse } from "../shared/api.ts";
import { PactPage } from "./PactPage.tsx";
import { answers, cameraPact, onOurSide, renderWithUser, stubApi } from "./testing/render.tsx";

// Five minutes into Gym's edit window.
const NOW = "2026-01-05T15:00:00Z";
const IN_EDIT_WINDOW = cameraPact("2026-01-05T15:05:00Z");

const openers = {
  evidence: vi.fn<(id: string) => void>(),
  excuse: vi.fn<(id: string) => void>(),
  payment: vi.fn<(id: string) => void>(),
  "change-request": vi.fn<(id: string) => void>(),
  vacation: vi.fn<(id: string) => void>(),
};

function renderPactPage(onDeleted = vi.fn()) {
  return renderWithUser(
    <PactPage
      pactId="gym"
      timezone="America/New_York"
      onLoaded={vi.fn()}
      onEdit={vi.fn()}
      onDeleted={onDeleted}
      onRequestChange={vi.fn()}
      openers={openers}
      onInvite={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
  for (const open of Object.values(openers)) open.mockReset();
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

  expect(await screen.findByText("The 10 minutes for editing are over. To stop the pact, use End pact.")).toBeTruthy();
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
      "Ending approved. The pact ends after Thu Jan 8, once that day has been judged. You still owe penalties for days already missed.",
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

describe("Waiting on", () => {
  beforeEach(() =>
    stubApi({
      pact: answers({
        ok: true,
        pact: {
          ...cameraPact(),
          waiting: [
            { kind: "vacation", id: "trip", firstDate: "2026-01-12", lastDate: "2026-01-18", filedAt: NOW },
            {
              kind: "evidence",
              id: "photo-1",
              pactId: "gym",
              name: "Gym",
              occurrenceDate: "2026-01-05",
              submittedAt: "2026-01-05T14:00:00Z",
            },
          ],
        },
      }),
    }),
  );

  test("a waiting evidence row opens its evidence page", async () => {
    const { user } = renderPactPage();
    await user.click(await screen.findByRole("button", { name: /Gym\s*Evidence · Mon Jan 5/ }));
    expect(openers.evidence).toHaveBeenCalledWith("photo-1");
  });

  test("a waiting vacation row opens the vacation", async () => {
    const { user } = renderPactPage();
    await user.click(await screen.findByRole("button", { name: /Mon Jan 12 – Sun Jan 18\s*Vacation/ }));
    expect(openers.vacation).toHaveBeenCalledWith("trip");
  });
});

test("a pact page opened again shows the pact as last loaded while it loads afresh", async () => {
  stubApi({ pact: answers({ ok: true, pact: cameraPact() }) });
  const { unmount } = renderPactPage();
  await screen.findByRole("button", { name: "Request change" });
  unmount();
  const loading = vi.fn(() => new Promise<never>(() => undefined));
  stubApi({ pact: loading });
  renderPactPage();
  expect(screen.getByRole("button", { name: "Request change" })).toBeTruthy();
  expect(loading).toHaveBeenCalledTimes(1);
});

// Each sends only its own term, so terms changed since the page loaded stay as they are.
describe("the sheets that change a term at once", () => {
  test("Name sends only the name", async () => {
    const { renamePact } = stubApi({
      pact: answers({ ok: true, pact: cameraPact() }),
      renamePact: answers({ ok: true }),
    });
    const { user } = renderPactPage();
    await user.click(await screen.findByRole("button", { name: "Change name" }));
    await user.clear(screen.getByDisplayValue("Gym"));
    await user.type(screen.getByPlaceholderText("e.g. Gym"), "Morning gym");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(renamePact).toHaveBeenCalledWith("gym", "Morning gym");
    expect(await screen.findByRole("button", { name: "Change name" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save name" })).toBeNull();
  });

  test("Name says why a refused name was refused", async () => {
    stubApi({
      pact: answers({ ok: true, pact: cameraPact() }),
      renamePact: answers({ ok: false, reason: "pact-ended" }),
    });
    const { user } = renderPactPage();
    await user.click(await screen.findByRole("button", { name: "Change name" }));
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByText("This pact has ended.")).toBeTruthy();
  });

  test("Add a reviewer sends only the friends picked", async () => {
    const { addReviewers } = stubApi({
      pact: answers({ ok: true, pact: cameraPact() }),
      friends: answers([
        { id: "ana", name: "Ana" },
        { id: "bo", name: "Bo" },
      ]),
      addReviewers: answers({ ok: true }),
    });
    const { user } = renderPactPage();
    await user.click(await screen.findByRole("button", { name: "Add a reviewer" }));
    await user.click(await screen.findByRole("checkbox", { name: "Bo" }));
    await user.click(screen.getByRole("button", { name: "Add Bo" }));

    expect(addReviewers).toHaveBeenCalledWith("gym", ["bo"]);
  });

  test("Add a reviewer says why it was refused", async () => {
    stubApi({
      pact: answers({ ok: true, pact: cameraPact() }),
      friends: answers([{ id: "bo", name: "Bo" }]),
      addReviewers: answers({ ok: false, reason: "not-a-friend" }),
    });
    const { user } = renderPactPage();
    await user.click(await screen.findByRole("button", { name: "Add a reviewer" }));
    await user.click(await screen.findByRole("checkbox", { name: "Bo" }));
    await user.click(screen.getByRole("button", { name: "Add Bo" }));

    expect(await screen.findByText("Only friends can be reviewers.")).toBeTruthy();
  });

  test("Reminders sends only the reminders", async () => {
    const { setReminders } = stubApi({
      pact: answers({ ok: true, pact: { ...cameraPact(), reminders: ["18:00"] } }),
      setReminders: answers({ ok: true }),
    });
    const { user } = renderPactPage();
    await user.click(await screen.findByRole("button", { name: "Change reminders" }));
    await user.click(screen.getByRole("button", { name: "+ Add reminder" }));
    await user.click(screen.getByRole("button", { name: "Save reminders" }));

    expect(setReminders).toHaveBeenCalledWith("gym", ["18:00", "20:00"]);
  });

  test("Reminders says why they were refused", async () => {
    stubApi({
      pact: answers({ ok: true, pact: cameraPact() }),
      setReminders: answers({ ok: false, reason: "reminder-after-due-time" }),
    });
    const { user } = renderPactPage();
    await user.click(await screen.findByRole("button", { name: "Change reminders" }));
    await user.click(screen.getByRole("button", { name: "Save reminders" }));

    expect(await screen.findByText(/A reminder is set for the due time or later/)).toBeTruthy();
  });
});
