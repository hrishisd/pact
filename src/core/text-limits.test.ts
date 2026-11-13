// Text limits: every command that takes free text refuses text longer than
// its cap with `text-too-long`, counted after trimming. Names (pacts and
// recipients) have MAX_NAME_CHARS; everything else has MAX_TEXT_CHARS.

import { describe, expect, test } from "vitest";
import { MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../shared/types.ts";
import { cameraPact, gymEvidenceWaiting, MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import { changed, ok, pactOf } from "./testing/queries.ts";
import { scenario } from "./testing/scenario.ts";

const atCap = "x".repeat(MAX_TEXT_CHARS);
const overCap = "x".repeat(MAX_TEXT_CHARS + 1);
const nameAtCap = "n".repeat(MAX_NAME_CHARS);
const nameOverCap = "n".repeat(MAX_NAME_CHARS + 1);
const TOO_LONG = { ok: false, reason: "text-too-long" };

describe("review text", () => {
  test("a reject reason one character over the cap is refused; at the cap, with spaces around it, it's accepted", async () => {
    const s = scenario();
    const { reviewer, evidenceId } = await gymEvidenceWaiting(s);

    expect(await reviewer.decide(evidenceId, { kind: "reject", reason: overCap })).toEqual(TOO_LONG);
    expect(reviewer.reviewQueue().map((item) => item.id)).toEqual([evidenceId]);
    expect(await reviewer.decide(evidenceId, { kind: "reject", reason: `  ${atCap}  ` })).toEqual({ ok: true });
  });

  test("a question and a reply one character over the cap are refused; at the cap they're accepted", async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await gymEvidenceWaiting(s);

    expect(await reviewer.askOwner(evidenceId, overCap)).toEqual(TOO_LONG);
    expect(reviewer.waitingOnReply()).toEqual([]);
    expect(await reviewer.askOwner(evidenceId, atCap)).toEqual({ ok: true });

    expect(await owner.reply(evidenceId, overCap)).toEqual(TOO_LONG);
    expect(await owner.reply(evidenceId, atCap)).toEqual({ ok: true });
  });
});

describe("the owner's text", () => {
  test("an excuse reason one character over the cap is refused; at the cap it's accepted", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Tue 08:00");
    const excuse = (reason: string) => ({ from: s.date("Wed"), to: s.date("Wed"), reason });

    expect(await owner.fileExcuse(gym, excuse(overCap), [photo()])).toEqual(TOO_LONG);
    expect(await owner.fileExcuse(gym, excuse(atCap), [photo()])).toMatchObject({ ok: true });
  });

  test("a pact's name over MAX_NAME_CHARS or description over MAX_TEXT_CHARS is refused, made or edited", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithReviewers(s);
    const pact = (name: string) => cameraPact(name, MON_WED_FRI, { recipientId: sam.id, reviewers: [reviewer] });

    expect(await owner.createPact(pact(nameOverCap))).toEqual(TOO_LONG);
    expect(await owner.createPact({ ...pact("Gym"), description: overCap })).toEqual(TOO_LONG);
    const gym = ok(await owner.createPact({ ...pact(nameAtCap), description: atCap })).pactId;

    expect(await owner.editPact(gym, pact(nameOverCap))).toEqual(TOO_LONG);
    expect(await owner.editPact(gym, { ...pact("Gym"), description: overCap })).toEqual(TOO_LONG);
  });

  test("a recipient's name over MAX_NAME_CHARS is refused", async () => {
    const s = scenario();
    const { owner } = await ownerWithReviewers(s);

    expect(await owner.addRecipient({ name: nameOverCap })).toEqual(TOO_LONG);
    expect(await owner.addRecipient({ name: nameAtCap })).toMatchObject({ ok: true });
  });

  test("a change request's note, a new name or an end request's note over its cap is refused, previewed or sent", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Tue 08:00");
    const relaxed = (note: string) => changed(owner, gym, { penaltyCents: 100, note });

    expect(owner.changePreview(gym, relaxed(overCap))).toEqual(TOO_LONG);
    expect(await owner.changePact(gym, relaxed(overCap))).toEqual(TOO_LONG);
    expect(await owner.renamePact(gym, nameOverCap)).toEqual(TOO_LONG);
    expect(pactOf(owner, gym).name).toBe("Gym");
    // Counted once trimmed.
    expect(await owner.renamePact(gym, ` ${nameAtCap} `)).toEqual({ ok: true });
    expect(pactOf(owner, gym).name).toBe(nameAtCap);
    expect(await owner.requestEnd(gym, overCap)).toEqual(TOO_LONG);
    expect(await owner.requestEnd(gym, atCap)).toMatchObject({ ok: true });
  });

  test("a payment's note over the cap is refused", async () => {
    const s = scenario();
    const { owner, sam, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", MON_WED_FRI);
    await s.advanceTo("Tue 00:00");

    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 500, note: overCap }, photo())).toEqual(
      TOO_LONG,
    );
    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 500, note: atCap }, photo())).toMatchObject({
      ok: true,
    });
  });

  test("a vacation's note over the cap is refused", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Tue 08:00");
    const vacation = (note: string) => ({
      from: s.date("Mon+1"),
      to: s.date("Fri+1"),
      pactIds: [gym],
      reviewerIds: [reviewer.id],
      note,
    });

    expect(await owner.fileVacation(vacation(overCap))).toEqual(TOO_LONG);
    expect(await owner.fileVacation(vacation(atCap))).toMatchObject({ ok: true });
  });
});
