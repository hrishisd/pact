import { fireEvent, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { CreatePact } from "./CreatePact.tsx";
import { answers, renderWithUser, stubApi } from "./testing/render.tsx";

test("a typed Camera name stays after Back, Oura Ring and an in-bed-by time", async () => {
  stubApi({ friends: answers([]), recipients: answers([]) });
  const { user } = renderWithUser(
    <CreatePact
      connections={{ ouraConnected: true, ouraAvailable: true, ankiConnected: false, ankiAvailable: false }}
      onCancel={vi.fn()}
      onCreated={vi.fn()}
      onInvite={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: /^Camera/ }));
  await user.type(screen.getByLabelText(/^Name/), "Morning run");
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(screen.getByRole("button", { name: /^Oura Ring/ }));
  fireEvent.change(screen.getByLabelText(/^In bed by/), { target: { value: "23:00" } });

  expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Morning run");
});

test("with no name typed, an in-bed-by time names the pact", async () => {
  stubApi({ friends: answers([]), recipients: answers([]) });
  const { user } = renderWithUser(
    <CreatePact
      connections={{ ouraConnected: true, ouraAvailable: true, ankiConnected: false, ankiAvailable: false }}
      onCancel={vi.fn()}
      onCreated={vi.fn()}
      onInvite={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: /^Oura Ring/ }));
  fireEvent.change(screen.getByLabelText(/^In bed by/), { target: { value: "23:00" } });

  expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("In bed by 11pm");
});

test("a pact that's created keeps Create pact disabled while the page goes to it", async () => {
  stubApi({
    friends: answers([{ id: "ana", name: "Ana" }]),
    recipients: answers([{ id: "sam", name: "Sam" }]),
    firstOccurrence: answers({ ok: true, firstOccurrence: { date: "2026-01-05", dueAt: "2026-01-06T05:00:00Z" } }),
    createPact: answers({ ok: true, pactId: "gym" }),
  });
  const onCreated = vi.fn();
  const { user } = renderWithUser(
    <CreatePact
      connections={{ ouraConnected: false, ouraAvailable: false, ankiConnected: false, ankiAvailable: false }}
      onCancel={vi.fn()}
      onCreated={onCreated}
      onInvite={vi.fn()}
    />,
  );
  const next = () => user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: /^Camera/ }));
  await user.type(screen.getByLabelText(/^Name/), "Gym");
  await user.type(screen.getByLabelText(/^What will your photo show/), "Me at the gym");
  await next();
  await user.click(screen.getByRole("button", { name: "Every day" }));
  await next();
  await user.type(screen.getByLabelText(/^Penalty per miss/), "5");
  await next();
  await user.click(await screen.findByRole("checkbox", { name: "Ana" }));
  await next();
  await next();
  const create = screen.getByRole("button", { name: "Create pact" });
  await user.click(create);

  expect(onCreated).toHaveBeenCalledWith("gym", "Gym");
  expect((create as HTMLButtonElement).disabled).toBe(true);
});

/** The weeks the core offers a 3× pact made Thu Nov 26, 2026: this week has 4 days left. */
function weekStartsFromThursday(offered: boolean) {
  const mondays = ["2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28", "2027-01-04"];
  return {
    ok: true as const,
    weekStarts: {
      thisWeek: offered
        ? { monday: "2026-11-23", daysLeft: 4, offered: true as const }
        : { monday: "2026-11-23", daysLeft: 2, offered: false as const, reason: "too-few-days" as const },
      mondays,
      defaultMonday: "2026-11-30",
      lastWeek: null,
    },
  };
}

async function toWeeklySchedule(user: ReturnType<typeof renderWithUser>["user"]) {
  await user.click(screen.getByRole("button", { name: /^Camera/ }));
  await user.type(screen.getByLabelText(/^Name/), "Gym");
  await user.type(screen.getByLabelText(/^What will your photo show/), "Me at the gym");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Weekly count" }));
}

const noConnections = { ouraConnected: false, ouraAvailable: false, ankiConnected: false, ankiAvailable: false };

test("a Weekly count pact offers this week, next week or a later Monday, next week picked, and sends the Monday chosen", async () => {
  const spies = stubApi({
    friends: answers([{ id: "ana", name: "Ana" }]),
    recipients: answers([{ id: "sam", name: "Sam" }]),
    weekStarts: answers(weekStartsFromThursday(true)),
    firstOccurrence: answers({
      ok: true,
      firstOccurrence: { date: "2026-11-23", dueAt: "2026-11-30T05:00:00Z" },
      daysLeft: 4,
    }),
    createPact: answers({ ok: true, pactId: "gym" }),
  });
  const { user } = renderWithUser(
    <CreatePact connections={noConnections} onCancel={vi.fn()} onCreated={vi.fn()} onInvite={vi.fn()} />,
  );
  await toWeeklySchedule(user);

  const thisWeek = await screen.findByRole("radio", { name: /^This week · Nov 23 – 29/ });
  expect(thisWeek.closest("label")?.textContent).toContain("3× by Sunday, with 4 days left (Thu–Sun)");
  expect((screen.getByRole("radio", { name: /^Next week · Nov 30 – Dec 6/ }) as HTMLInputElement).checked).toBe(true);
  await user.click(screen.getByRole("radio", { name: /^A later week/ }));
  expect(screen.getByRole("combobox", { name: "Monday it starts" })).toBeTruthy();
  await user.click(thisWeek);
  expect(screen.queryByRole("combobox", { name: "Monday it starts" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByLabelText(/^Penalty per miss/), "5");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(await screen.findByRole("checkbox", { name: "Ana" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Next" }));

  const words =
    "Your first week is this week, with 4 days left (Thu–Sun). You need 3× by the end of Sun Nov 29, the same as a full week.";
  expect(
    await screen.findByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").includes(words)),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Create pact" }));
  expect(spies.createPact).toHaveBeenCalledWith(expect.objectContaining({ startDate: "2026-11-23" }));
  expect(spies.weekStarts).toHaveBeenCalledWith({ target: 3 });
});

test("this week too short to reach the target is greyed out with why", async () => {
  stubApi({
    friends: answers([]),
    recipients: answers([]),
    weekStarts: answers(weekStartsFromThursday(false)),
  });
  const { user } = renderWithUser(
    <CreatePact connections={noConnections} onCancel={vi.fn()} onCreated={vi.fn()} onInvite={vi.fn()} />,
  );
  await toWeeklySchedule(user);

  const thisWeek = (await screen.findByRole("radio", { name: /^This week/ })) as HTMLInputElement;
  expect(thisWeek.disabled).toBe(true);
  expect(thisWeek.closest("label")?.textContent).toContain("Only 2 days left, fewer than 3×.");
});
