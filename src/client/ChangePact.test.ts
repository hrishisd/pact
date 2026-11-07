import { expect, test } from "vitest";
import type { AppliesNow } from "../shared/types.ts";
import { nowLine } from "./ChangePact.tsx";

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
