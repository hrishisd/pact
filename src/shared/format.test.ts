import { expect, test } from "vitest";
import { pactNamesText } from "./format.ts";

test.each([
  [["Gym"], "Gym"],
  [["Gym", "Reading"], "Gym and Reading"],
  [["Gym", "Reading", "Piano"], "Gym, Reading and 1 more"],
  [["Gym", "Reading", "Piano", "Spanish"], "Gym, Reading and 2 more"],
])("pact names %j read %j", (names, text) => {
  expect(pactNamesText(names)).toBe(text);
});
