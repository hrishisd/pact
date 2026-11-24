import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
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

describe("Once a month on the Schedule step", () => {
  const offered = {
    current: { date: "2026-11-01", dueAt: "2026-12-01T05:00:00Z", daysLeft: 7 },
    next: { date: "2026-12-01", dueAt: "2027-01-01T05:00:00Z" },
  };
  /** Create pact at the Schedule step on `now`, with the core offering `periods` for the `preset`. */
  async function atSchedule(
    now: string,
    periods: { current: typeof offered.current | null; next: typeof offered.next },
    preset = /^Once a month/,
  ) {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(now) });
    const spies = stubApi({
      friends: answers([{ id: "ana", name: "Ana" }]),
      recipients: answers([{ id: "sam", name: "Sam" }]),
      firstOccurrence: async (request) => ({
        ok: true,
        firstOccurrence: request.startDate ? periods.next : (periods.current ?? periods.next),
        offered: periods,
      }),
    });
    const rendered = renderWithUser(
      <CreatePact
        connections={{ ouraConnected: false, ouraAvailable: false, ankiConnected: false, ankiAvailable: false }}
        onCancel={vi.fn()}
        onCreated={vi.fn()}
        onInvite={vi.fn()}
      />,
    );
    const { user } = rendered;
    await user.click(screen.getByRole("button", { name: /^Camera/ }));
    await user.type(screen.getByLabelText(/^Name/), "Call Grandma");
    await user.type(screen.getByLabelText(/^What will your photo show/), "The call log");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("radio", { name: preset }));
    return { ...rendered, spies };
  }
  const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;

  afterEach(() => {
    vi.useRealTimers();
  });

  test("offers this month or next, this month picked with 7 or more days left, and no start date", async () => {
    await atSchedule("2026-11-24T15:00:00Z", offered);
    await waitFor(() => expect(radio(/^November/).checked).toBe(true));
    expect(screen.getByText("Due by Mon Nov 30 · 7 days, counting today")).toBeTruthy();
    expect(screen.getByText("Dec 1 to Thu Dec 31")).toBeTruthy();
    expect(screen.queryByLabelText(/^Start/)).toBeNull();
    expect(screen.getByLabelText(/^End/)).toBeTruthy();
  });

  test("picks next month with fewer than 7 days left, and the Check step names it", async () => {
    const sixLeft = { ...offered, current: { ...offered.current, daysLeft: 6 } };
    const { user, spies } = await atSchedule("2026-11-25T15:00:00Z", sixLeft);
    await waitFor(() => expect(radio(/^December/).checked).toBe(true));
    const next = () => user.click(screen.getByRole("button", { name: "Next" }));
    await next();
    await user.type(screen.getByLabelText(/^Penalty per miss/), "20");
    await next();
    await user.click(await screen.findByRole("checkbox", { name: "Ana" }));
    await next();
    await next();

    expect(await screen.findByText(/Your first month is/)).toBeTruthy();
    expect(screen.getByText(/Your first month is/).textContent).toContain(
      "Your first month is December. It's due by midnight on Thu Dec 31.",
    );
    expect(spies.firstOccurrence).toHaveBeenLastCalledWith(expect.objectContaining({ startDate: "2026-12-01" }));
  });

  test("picking another preset and coming back picks the first month afresh", async () => {
    const { user } = await atSchedule("2026-11-24T15:00:00Z", offered);
    await waitFor(() => expect(radio(/^November/).checked).toBe(true));
    await user.click(radio(/^December/));
    await user.click(screen.getByRole("radio", { name: /^Set days of the week/ }));
    await user.click(screen.getByRole("radio", { name: /^Once a month/ }));

    await waitFor(() => expect(radio(/^November/).checked).toBe(true));
  });

  test("Next waits for the dates to load", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-24T15:00:00Z") });
    stubApi({
      friends: answers([]),
      recipients: answers([]),
      firstOccurrence: () => new Promise(() => {}),
    });
    const { user } = renderWithUser(
      <CreatePact
        connections={{ ouraConnected: false, ouraAvailable: false, ankiConnected: false, ankiAvailable: false }}
        onCancel={vi.fn()}
        onCreated={vi.fn()}
        onInvite={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Camera/ }));
    await user.type(screen.getByLabelText(/^Name/), "Call Grandma");
    await user.type(screen.getByLabelText(/^What will your photo show/), "The call log");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("radio", { name: /^Once a month/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Pick when to start. If the dates didn't load, go Back and try again.")).toBeTruthy();
    expect(screen.queryByLabelText(/^Penalty per miss/)).toBeNull();
  });

  test("Every 2 weeks offers this week's 2 or next week's, and the Check step says when they start", async () => {
    const twoWeeks = {
      current: { date: "2026-11-23", dueAt: "2026-12-07T05:00:00Z", daysLeft: 13 },
      next: { date: "2026-11-30", dueAt: "2026-12-14T05:00:00Z" },
    };
    const { user, spies } = await atSchedule("2026-11-24T15:00:00Z", twoWeeks, /^Every 2 weeks/);
    await waitFor(() => expect(radio(/^This week/).checked).toBe(true));
    expect(screen.getByText("Due by Sun Dec 6 · 13 days, counting today")).toBeTruthy();
    expect(screen.getByText("Nov 30 to Sun Dec 13")).toBeTruthy();
    expect(screen.getByText("Only whole 2 weeks up to the end date count.")).toBeTruthy();

    await user.click(radio(/^Next week/));
    const next = () => user.click(screen.getByRole("button", { name: "Next" }));
    await next();
    await user.type(screen.getByLabelText(/^Penalty per miss/), "20");
    await next();
    await user.click(await screen.findByRole("checkbox", { name: "Ana" }));
    await next();
    await next();

    expect((await screen.findByText(/Your first 2 weeks start/)).textContent).toContain(
      "Your first 2 weeks start Mon Nov 30. They're due by midnight on Sun Dec 13.",
    );
    expect(spies.firstOccurrence).toHaveBeenLastCalledWith(expect.objectContaining({ startDate: "2026-11-30" }));
  });

  test("doesn't offer this month when it's due within the hour", async () => {
    await atSchedule("2026-11-30T15:00:00Z", { current: null, next: offered.next });
    await waitFor(() => expect(radio(/^December/).checked).toBe(true));
    expect(screen.queryByRole("radio", { name: /^November/ })).toBeNull();
  });
});
