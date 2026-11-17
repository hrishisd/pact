import { screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ChangePreviewResponse, FriendsResponse, Json, RecipientsResponse } from "../shared/api.ts";
import type { AppliesNow, PactTerms } from "../shared/types.ts";
import { ChangePact, nowLine } from "./ChangePact.tsx";
import { answers, cameraPact, onOurSide, renderWithUser, stubApi } from "./testing/render.tsx";

const APPLIES_NOW: ChangePreviewResponse = { ok: true, preview: { changes: [], outcome: { kind: "at-once" } } };

function renderChangePact(onDone = vi.fn()) {
  return renderWithUser(<ChangePact pactId="gym" onDone={onDone} onInvite={vi.fn()} />);
}

test("friends and recipients that didn't load say so in the Reviewers sheet, rather than No friends yet", async () => {
  stubApi({
    pact: answers({ ok: true, pact: cameraPact() }),
    friends: answers<FriendsResponse>(onOurSide),
    recipients: answers<RecipientsResponse>(onOurSide),
    changePreview: answers(APPLIES_NOW),
  });
  const { user } = renderChangePact();
  const row = (await screen.findByText("Reviewers", { selector: "dt" })).closest("div")!;
  await user.click(within(row).getByRole("button", { name: "Change" }));

  const sheet = await screen.findByRole("dialog", { name: "Reviewers" });
  expect(
    within(sheet).getByText("Some of this couldn't load. Something went wrong on our side. Try again in a minute."),
  ).toBeTruthy();
  expect(within(sheet).queryByText("No friends yet")).toBeNull();
});

test("a change that goes through keeps its button disabled while the page goes Back", async () => {
  stubApi({
    pact: answers({ ok: true, pact: cameraPact() }),
    friends: answers([]),
    recipients: answers([]),
    changePreview: answers(APPLIES_NOW),
    changePact: answers({ ok: true, outcome: { kind: "at-once" } }),
  });
  const onDone = vi.fn();
  const { user } = renderChangePact(onDone);
  const apply = await screen.findByRole("button", { name: "Apply change" });
  await vi.waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false));
  await user.click(apply);

  expect(onDone).toHaveBeenCalledTimes(1);
  expect((apply as HTMLButtonElement).disabled).toBe(true);
});

test("a refused change offers its button again, with why", async () => {
  stubApi({
    pact: answers({ ok: true, pact: cameraPact() }),
    friends: answers([]),
    recipients: answers([]),
    changePreview: answers(APPLIES_NOW),
    changePact: answers({ ok: false, reason: "pact-ended" }),
  });
  const onDone = vi.fn();
  const { user } = renderChangePact(onDone);
  const apply = await screen.findByRole("button", { name: "Apply change" });
  await vi.waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false));
  await user.click(apply);

  expect(await screen.findByText("This pact has Ended.")).toBeTruthy();
  expect(onDone).not.toHaveBeenCalled();
  expect((apply as HTMLButtonElement).disabled).toBe(false);
});

test.each<[AppliesNow[], string]>([
  [[], ""],
  [["name"], " The name changes now."],
  [["reminders"], " The reminders change now."],
  [["new-reviewer"], " The new reviewer changes now."],
  [["new-reviewers"], " The new reviewers change now."],
  [["name", "new-reviewer"], " The name and the new reviewer change now."],
  [["name", "reminders", "new-reviewers"], " The name, the reminders and the new reviewers change now."],
])("what applies now inside %j reads %j", (appliesNow, text) => {
  expect(nowLine(appliesNow)).toBe(text);
});

test("an Anki pact with AnkiWeb disconnected loads and sends its own deck, without the deck list", async () => {
  const pact: Json<PactTerms> = {
    ...cameraPact(),
    evidenceKind: "anki",
    dueBy: null,
    schedule: { kind: "fixed-days", days: ["mon", "tue", "wed", "thu", "fri"] },
    anki: { deckId: "spanish", deckName: "Spanish", deckMissing: false, rolloverHour: 4 },
    connectionProblem: "not-connected",
  };
  const spies = stubApi({
    pact: answers({ ok: true, pact }),
    friends: answers([]),
    recipients: answers([]),
    changePreview: answers(APPLIES_NOW),
    changePact: answers({ ok: true, outcome: { kind: "at-once" } }),
  });
  const onDone = vi.fn();
  const { user } = renderChangePact(onDone);
  const apply = await screen.findByRole("button", { name: "Apply change" });
  await vi.waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false));
  await user.click(apply);

  expect(spies.changePact).toHaveBeenCalledWith("gym", expect.objectContaining({ ankiDeckId: "spanish" }));
  expect(onDone).toHaveBeenCalledTimes(1);
});
