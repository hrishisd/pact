import { describe, expect, test } from "vitest";
import { listNames } from "./change-terms.tsx";

describe("listNames", () => {
  test.each([
    [[], "and", ""],
    [["alice"], "and", "alice"],
    [["alice", "Bob"], "and", "alice and Bob"],
    [["alice", "Bob", "Cy"], "and", "alice, Bob and Cy"],
    [["alice", "Bob", "Cy"], "or", "alice, Bob or Cy"],
  ])("%j with %s reads %j", (names, last, text) => {
    expect(listNames(names, last)).toBe(text);
  });
});
