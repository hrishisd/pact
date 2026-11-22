import { expect, test } from "vitest";
import { listNames, pactNamesText } from "./format.ts";

test.each([
  [["Gym"], "Gym"],
  [["Gym", "Reading"], "Gym and Reading"],
  [["Gym", "Reading", "Piano"], "Gym, Reading, and 1 more"],
  [["Gym", "Reading", "Piano", "Spanish"], "Gym, Reading, and 2 more"],
])("pact names %j read %j", (names, text) => {
  expect(pactNamesText(names)).toBe(text);
});

test.each([
  [[], "and", ""],
  [["alice"], "and", "alice"],
  [["alice", "Bob"], "and", "alice and Bob"],
  [["alice", "Bob", "Cy"], "and", "alice, Bob, and Cy"],
  [["alice", "Bob", "Cy"], "or", "alice, Bob, or Cy"],
])("names %j with %s read %j", (names, last, text) => {
  expect(listNames(names, last)).toBe(text);
});
