// The browser smoke test: one flow across screens, as two people in two
// browsers. The owner invites a reviewer, creates a Camera pact and submits
// evidence; the reviewer approves it; a day is Missed; the owner files an
// excuse from the Missed card, sees it waiting and opens it; the reviewer
// rejects it; the owner records a payment.
//
// The server runs in development with PACT_DEV_CLOCK=1 (playwright.config.ts),
// so `advance` moves its clock and runs the scheduler's tick; each browser's
// clock is moved with it, so the screens and the server agree on the time.
// The dates on screen depend on the day the test runs, so they aren't asserted.

import { expect, test, type Page } from "@playwright/test";
import { DEV_ADVANCE_PATH, DEV_SIGN_IN_PATH, type DevAdvanceRequest } from "../src/shared/api.ts";

const TIMEZONE = "America/New_York";

/** A 1×1 PNG: the evidence photo and the payment's screenshot. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("an owner and a reviewer go from friends to a recorded payment", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  const reviewer = await (await browser.newContext()).newPage();

  /** Moves the server's clock `minutes` forward, and both browsers' clocks with it. */
  /** The owner's Today card for Gym showing `chip`: its name opens the pact, its buttons sit beside it. */
  const gymCard = (chip: string) =>
    owner
      .getByRole("article")
      .filter({ has: owner.getByRole("heading", { name: "Gym" }) })
      .filter({ hasText: chip });

  async function advance(minutes: number): Promise<Date> {
    const response = await owner.request.post(DEV_ADVANCE_PATH, { data: { minutes } satisfies DevAdvanceRequest });
    expect(response.ok()).toBe(true);
    const now = new Date(((await response.json()) as { now: string }).now);
    for (const page of [owner, reviewer]) await page.clock.setSystemTime(now);
    return now;
  }

  await test.step("start at 9am in the accounts' timezone, so the pact's first day is today", async () => {
    const now = await advance(1);
    for (const page of [owner, reviewer]) await page.clock.install({ time: now });
    // At least a day ahead, so it is never the minute the test started in.
    await advance(minutesUntil9am(now) + 24 * 60);
  });

  await test.step("the owner invites the reviewer and they become friends", async () => {
    await owner.goto(`${DEV_SIGN_IN_PATH}?as=operator&timezone=${TIMEZONE}`);
    await owner.getByRole("button", { name: "Invite a friend" }).click();
    const profile = owner.getByRole("dialog", { name: "Profile" });
    await profile.getByRole("button", { name: "Invite a friend" }).click();
    const link = await profile.getByText(/\/invite\//).textContent();
    const token = link!.split("/invite/")[1]!;
    await profile.getByRole("button", { name: "Done" }).click();

    await reviewer.goto(
      `${DEV_SIGN_IN_PATH}?email=friend@example.test&name=Friend&invite=${token}&timezone=${TIMEZONE}`,
    );
    await reviewer.getByRole("button", { name: "Accept" }).click();
    await expect(reviewer.getByRole("heading", { name: "You and operator are friends" })).toBeVisible();
    await reviewer.getByRole("button", { name: "Open Pact" }).click();
  });

  await test.step("the owner creates a Camera pact", async () => {
    await owner.getByRole("button", { name: "Create a pact" }).click();
    await owner.getByRole("button", { name: /^Camera/ }).click();
    await owner.getByRole("textbox", { name: /^Name/ }).fill("Gym");
    await owner.getByRole("textbox", { name: /^What will your photo show/ }).fill("Me at the gym");
    await owner.getByRole("button", { name: "Next" }).click();
    await owner.getByRole("button", { name: "Every day" }).click();
    await owner.getByRole("button", { name: "Next" }).click();
    await owner.getByRole("textbox", { name: /^Penalty per miss/ }).fill("5");
    await owner.getByRole("button", { name: "Pick a recipient" }).click();
    await owner.getByRole("textbox", { name: "Name" }).fill("Sam");
    await owner.getByRole("button", { name: "Save" }).click();
    await owner.getByRole("button", { name: "Next" }).click();
    await owner.getByRole("checkbox", { name: "Friend" }).check();
    await owner.getByRole("button", { name: "Next" }).click();
    await owner.getByRole("button", { name: "Next" }).click();
    await expect(owner.getByRole("heading", { name: "Check it over" })).toBeVisible();
    await owner.getByRole("button", { name: "Create pact" }).click();
    await expect(owner.getByRole("heading", { name: "Gym", level: 1 })).toBeVisible();
  });

  await test.step("the owner submits evidence from the To do card", async () => {
    await owner.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Today" }).click();
    const toDo = gymCard("To do");
    const chooser = owner.waitForEvent("filechooser");
    await toDo.getByRole("button", { name: "Take photo" }).click();
    await (await chooser).setFiles({ name: "gym.png", mimeType: "image/png", buffer: PNG });
    await toDo.getByRole("button", { name: "Submit" }).click();
    await expect(owner.getByText("Waiting for approval", { exact: true })).toBeVisible();
    await expect(owner.getByRole("button", { name: /^Gym Photo/ })).toBeVisible();
  });

  await test.step("after the edit window, the reviewer approves it", async () => {
    await advance(11);
    await reviewer.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Review" }).click();
    await expect(reviewer.getByRole("article")).toContainText("Me at the gym");
    await reviewer.getByRole("button", { name: "Approve" }).click();
    await expect(reviewer.getByRole("heading", { name: "Nothing to review" })).toBeVisible();
  });

  await test.step("two days on, yesterday is Missed", async () => {
    await advance(2 * 24 * 60);
    await owner.reload();
    await expect(gymCard("Missed")).toContainText("$5");
  });

  await test.step("the owner files an excuse from the Missed card, sees it waiting and opens it", async () => {
    await gymCard("Missed")
      .getByRole("button", { name: /^File excuse/ })
      .click();
    const sheet = owner.getByRole("dialog", { name: /^Excuse Gym, / });
    await expect(sheet.getByText("$5 held while Friend decides")).toBeVisible();
    await sheet.getByRole("textbox", { name: "Reason" }).fill("Sick with the flu");
    await sheet.getByRole("button", { name: "Send to Friend" }).click();
    await expect(gymCard("Missed")).toBeHidden();
    await owner.getByRole("button", { name: /^Gym Excuse/ }).click();
    await expect(owner.getByRole("heading", { name: "Excuse", level: 1 })).toBeVisible();
    await expect(owner.getByText("Waiting for approval", { exact: true })).toBeVisible();
    await expect(owner.getByText("“Sick with the flu”")).toBeVisible();
  });

  await test.step("the reviewer rejects the excuse", async () => {
    await reviewer.reload();
    await expect(reviewer.getByRole("article")).toContainText("“Sick with the flu”");
    await reviewer.getByRole("button", { name: "Reject" }).click();
    await reviewer.getByRole("textbox", { name: /^Why are you rejecting it/ }).fill("You were at the party");
    await reviewer.getByRole("button", { name: "Reject" }).click();
    await expect(reviewer.getByRole("heading", { name: "Nothing to review" })).toBeVisible();

    await owner.reload();
    await expect(owner.getByText("Rejected by Friend")).toBeVisible();
    await expect(owner.getByText("Friend said “You were at the party”")).toBeVisible();
  });

  await test.step("the owner records a payment from the ledger", async () => {
    await owner.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Ledgers" }).click();
    await expect(owner.getByRole("button", { name: /^Sam \$5 owed/ })).toBeVisible();
    await owner.getByRole("button", { name: "Record payment" }).click();
    const sheet = owner.getByRole("dialog", { name: "Record a payment" });
    const chooser = owner.waitForEvent("filechooser");
    await sheet.getByRole("button", { name: "Choose screenshot" }).click();
    await (await chooser).setFiles({ name: "venmo.png", mimeType: "image/png", buffer: PNG });
    await sheet.getByRole("button", { name: "Send for approval" }).click();
    await expect(owner.getByRole("button", { name: /^Sam \$5 owed \$5 payment waiting for approval/ })).toBeVisible();
  });
});

/** Minutes from `now` to the next 9:00am in TIMEZONE, at least 1. */
function minutesUntil9am(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const minutesIntoDay = part("hour") * 60 + part("minute");
  return ((9 * 60 - minutesIntoDay + 24 * 60 - 1) % (24 * 60)) + 1;
}
