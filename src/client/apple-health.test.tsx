import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { RUN_PACT_HEALTH_URL, type AppleHealthResponse } from "../shared/api.ts";
import { AppleHealthPage } from "./apple-health.tsx";
import { answers, leaveAndComeBack, renderWithUser, stubApi } from "./testing/render.tsx";

const NOW = "2026-11-26T15:00:00Z";
const UPLOAD_URL = "https://pact.example/api/apple-health/samples?key=abc123";
const NOT_CONNECTED: AppleHealthResponse = { connected: false, lastUpload: null };
const CONNECTED: AppleHealthResponse = { connected: true, lastUpload: null };
/** 9:02am in New York today, then yesterday. */
const UPLOADED: AppleHealthResponse = {
  connected: true,
  lastUpload: { at: "2026-11-26T14:02:00Z", sleepSamples: 14, mindfulSessions: 2 },
};

function renderPage(onKeyMade = vi.fn()) {
  return renderWithUser(<AppleHealthPage timezone="America/New_York" onKeyMade={onKeyMade} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
});

describe("before a key", () => {
  test("offers Make upload key, the Shortcut's steps, the automations and Run Pact Health, with no upload yet", async () => {
    stubApi({ appleHealth: answers(NOT_CONNECTED) });
    renderPage();

    expect(await screen.findByRole("button", { name: "Make upload key" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("No upload yet");
    const steps = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(steps[0]).toBe("New Shortcut, named exactly Pact Health.");
    expect(steps.some((step) => step.startsWith("Repeat with Each item in those Health Samples"))).toBe(true);
    expect(steps.some((step) => step.includes("the Text starts mindful|."))).toBe(true);
    expect(screen.getByText("When the Oura or Google Health app is closed.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Run Pact Health" }).getAttribute("href")).toBe(RUN_PACT_HEALTH_URL);
    expect(screen.queryByRole("button", { name: "Make a new key" })).toBeNull();
  });
});

describe("after a key", () => {
  test("shows the upload URL once, with Copy, and says the key was made", async () => {
    const spies = stubApi({
      appleHealth: answers(NOT_CONNECTED, CONNECTED),
      makeAppleHealthKey: answers({ uploadUrl: UPLOAD_URL }),
    });
    const onKeyMade = vi.fn();
    const { user } = renderPage(onKeyMade);

    await user.click(await screen.findByRole("button", { name: "Make upload key" }));

    expect(await screen.findByText(UPLOAD_URL)).toBeTruthy();
    expect(screen.getByText(/Pact shows it only once/)).toBeTruthy();
    expect(onKeyMade).toHaveBeenCalledTimes(1);
    expect(spies.makeAppleHealthKey).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    // user-event stands in for the clipboard.
    expect(await navigator.clipboard.readText()).toBe(UPLOAD_URL);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  test("opened again, it can't show the URL: Make a new key warns that the old one stops working", async () => {
    const spies = stubApi({
      appleHealth: answers(CONNECTED),
      makeAppleHealthKey: answers({ uploadUrl: UPLOAD_URL }),
    });
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Make a new key" }));
    expect(screen.getByText("Your old upload URL stops working at once.")).toBeTruthy();
    expect(spies.makeAppleHealthKey).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Make a new key" }));

    expect(await screen.findByText(UPLOAD_URL)).toBeTruthy();
    expect(spies.makeAppleHealthKey).toHaveBeenCalledTimes(1);
  });
});

describe("the last upload", () => {
  test("says when it came and what it held", async () => {
    stubApi({ appleHealth: answers(UPLOADED) });
    renderPage();

    expect(await screen.findByText("Last upload 9:02am · 14 sleep samples, 2 mindful sessions")).toBeTruthy();
  });

  test("names its day when it wasn't today, and counts one of each in the singular", async () => {
    stubApi({
      appleHealth: answers<AppleHealthResponse>({
        connected: true,
        lastUpload: { at: "2026-11-25T14:02:00Z", sleepSamples: 1, mindfulSessions: 1 },
      }),
    });
    renderPage();

    expect(await screen.findByText("Last upload Wed Nov 25, 9:02am · 1 sleep sample, 1 mindful session")).toBeTruthy();
  });

  test("loads again when Pact comes back to the front, after running Pact Health", async () => {
    const spies = stubApi({ appleHealth: answers(CONNECTED, UPLOADED) });
    renderPage();
    await screen.findByText("No upload yet");

    leaveAndComeBack();

    expect(await screen.findByText("Last upload 9:02am · 14 sleep samples, 2 mindful sessions")).toBeTruthy();
    await waitFor(() => expect(spies.appleHealth).toHaveBeenCalledTimes(2));
  });
});
