import { expect, test } from "vitest";
import { ok } from "./queries.ts";

test("ok() returns an ok result as it is", () => {
  const result = { ok: true, pactId: "pact-1" } as const;
  expect(ok(result)).toBe(result);
});

test("ok() throws a refusal with its reason, so a failing test says why", () => {
  const refused: { ok: true } | { ok: false; reason: string } = { ok: false, reason: "edit-window-open" };
  expect(() => ok(refused)).toThrow(new Error("edit-window-open"));
});
