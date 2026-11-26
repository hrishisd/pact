import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CreatePact } from "./CreatePact.tsx";
import { answers, renderWithUser, stubApi } from "./testing/render.tsx";

/** No Apple Health connection; the timezone is for its setup step. */
const appleHealth = { appleHealthConnected: false, timezone: "America/New_York" };

test("a typed Camera name stays after Back, Oura Ring and an in-bed-by time", async () => {
  stubApi({ friends: answers([]), recipients: answers([]) });
  const { user } = renderWithUser(
    <CreatePact
      connections={{
        ouraConnected: true,
        ouraAvailable: true,
        ankiConnected: false,
        ankiAvailable: false,
        ...appleHealth,
      }}
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
      connections={{
        ouraConnected: true,
        ouraAvailable: true,
        ankiConnected: false,
        ankiAvailable: false,
        ...appleHealth,
      }}
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
      connections={{
        ouraConnected: false,
        ouraAvailable: false,
        ankiConnected: false,
        ankiAvailable: false,
        ...appleHealth,
      }}
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
        connections={{
          ouraConnected: false,
          ouraAvailable: false,
          ankiConnected: false,
          ankiAvailable: false,
          ...appleHealth,
        }}
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
        connections={{
          ouraConnected: false,
          ouraAvailable: false,
          ankiConnected: false,
          ankiAvailable: false,
          ...appleHealth,
        }}
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
  await user.click(screen.getByRole("radio", { name: /^Some days each week/ }));
}

const noConnections = {
  ouraConnected: false,
  ouraAvailable: false,
  ankiConnected: false,
  ankiAvailable: false,
  ...appleHealth,
};

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

describe("Apple Health", () => {
  const UPLOAD_URL = "https://pact.example/api/apple-health/samples?key=abc123";

  function renderForm(appleHealthConnected: boolean) {
    const onAppleHealthConnected = vi.fn();
    const rendered = renderWithUser(
      <CreatePact
        connections={{ ...noConnections, appleHealthConnected }}
        onCancel={vi.fn()}
        onCreated={vi.fn()}
        onInvite={vi.fn()}
        onAppleHealthConnected={onAppleHealthConnected}
      />,
    );
    return { ...rendered, onAppleHealthConnected };
  }

  test("with no connection, the tile leads to Set up Apple Health, which goes on to Goal once a key is made", async () => {
    const spies = stubApi({
      friends: answers([]),
      recipients: answers([]),
      appleHealth: answers({ connected: false, lastUpload: null }, { connected: true, lastUpload: null }),
      makeAppleHealthKey: answers({ uploadUrl: UPLOAD_URL }),
    });
    const { user, onAppleHealthConnected } = renderForm(false);

    const tile = screen.getByRole("button", { name: /^Apple Health/ });
    expect(tile.textContent).toContain("Bedtime, from the Health app on your iPhone.");
    await user.click(tile);
    expect(screen.getByRole("heading", { name: "Set up Apple Health" })).toBeTruthy();
    expect(screen.getByText("Step 2 of 8")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Set up Apple Health first.")).toBeTruthy();

    await user.click(await screen.findByRole("button", { name: "Make upload key" }));
    expect(await screen.findByText(UPLOAD_URL)).toBeTruthy();
    expect(screen.queryByText("Set up Apple Health first.")).toBeNull();
    expect(onAppleHealthConnected).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByLabelText(/^In bed by/)).toBeTruthy();
    expect(
      screen.getByText("If Apple Health shows you got into bed after this time, the night is missed."),
    ).toBeTruthy();
    // Pact can't show the URL again, so Back keeps it on screen.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText(UPLOAD_URL)).toBeTruthy();
    expect(spies.makeAppleHealthKey).toHaveBeenCalledTimes(1);
  });

  test("with a connection, the tile goes straight to Goal", async () => {
    stubApi({ friends: answers([]), recipients: answers([]) });
    const { user } = renderForm(true);

    await user.click(screen.getByRole("button", { name: /^Apple Health/ }));

    expect(screen.getByLabelText(/^In bed by/)).toBeTruthy();
    expect(screen.getByText("Step 2 of 7")).toBeTruthy();
  });
});
