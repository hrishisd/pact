import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { NotificationsResponse } from "../shared/api.ts";
import { NotificationsSection } from "./Notifications.tsx";
import { answers, onOurSide, renderWithUser, stubApi } from "./testing/render.tsx";

/** Every push setting on, and the daily summary as `enabled` says. */
function settings(enabled: boolean): NotificationsResponse {
  return {
    settings: [
      { setting: "review-item", enabled: true },
      { setting: "comment", enabled: true },
    ],
    dailySummary: { enabled, to: "priya@gmail.com" },
    vapidPublicKey: "key",
  };
}

function showSection() {
  return renderWithUser(<NotificationsSection push={{ state: "on", turnOn: vi.fn() }} onSetUp={vi.fn()} />);
}

describe("the Email section", () => {
  test("below the push list: one Daily summary switch, off to start with, and the address it goes to", async () => {
    stubApi({ notifications: async () => settings(false) });
    showSection();

    const daily = await screen.findByRole("switch", { name: /Daily summary/ });

    expect(screen.getByText("Email")).toBeTruthy();
    expect(daily).toHaveProperty("checked", false);
    expect(
      screen.getByText(
        "An email at 09:00 when items in your Review Queue, or reviewers' questions to you, have waited more than a day",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Sent to priya@gmail.com, your Google address.")).toBeTruthy();
    const switches = screen.getAllByRole("switch");
    expect(switches.at(-1)).toBe(daily);
  });

  test("turning it on saves it, apart from the push settings", async () => {
    const { setDailySummary, setNotificationSetting } = stubApi({
      notifications: async () => settings(false),
      setDailySummary: async () => ({ enabled: true, to: "priya@gmail.com" }),
      setNotificationSetting: vi.fn(),
    });
    const { user } = showSection();

    await user.click(await screen.findByRole("switch", { name: /Daily summary/ }));

    expect(setDailySummary).toHaveBeenCalledWith({ enabled: true });
    expect(setNotificationSetting).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: /Daily summary/ })).toHaveProperty("checked", true);
  });

  test("a failed save turns it back off and says it's on our side", async () => {
    stubApi({
      notifications: async () => settings(false),
      setDailySummary: answers<{ enabled: boolean; to: string }>(onOurSide),
    });
    const { user } = showSection();

    await user.click(await screen.findByRole("switch", { name: /Daily summary/ }));

    expect(
      await screen.findByText("Couldn't save. Something went wrong on our side. Try again in a minute."),
    ).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Daily summary/ })).toHaveProperty("checked", false);
  });
});
