// Reading an upload from the Pact Health Shortcut, and what the upload route
// answers it. The Shortcut posts plain text, one sample a line
// ("type|start|end|value|source"), or JSON ({ samples: [...] }). The core
// judges what the samples say; this only reads their shape.

import { APPLE_HEALTH_MAX_LINES, type AppleHealthSamplesRequest } from "../shared/api.ts";
import type { AppleHealthSampleFields, AppleHealthUpload, AppleHealthUploadResult } from "../shared/types.ts";
import { arrayOf, object, optional, string } from "./parse.ts";

/** What reading an upload's body came to: the upload, or why it's refused. */
export type ReadUpload =
  { ok: true; upload: AppleHealthUpload } | { ok: false; reason: "too-many-lines" | "malformed" };

/**
 * Reads an upload's body. A body starting with "{" is JSON, whatever its
 * Content-Type (Shortcuts sets it as the action's options say), and one of
 * another shape is malformed. Any other is lines: a blank line is ignored,
 * and one with fewer than three "|"-separated fields (type, start, end) is
 * counted unreadable. A missing value or source is empty, and a source with
 * "|" in it keeps it. More than APPLE_HEALTH_MAX_LINES samples or lines is too many.
 */
export function readUpload(body: string): ReadUpload {
  if (body.trimStart().startsWith("{")) return readJsonUpload(body);
  const lines = body.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length > APPLE_HEALTH_MAX_LINES) return { ok: false, reason: "too-many-lines" };
  const samples: AppleHealthSampleFields[] = [];
  let unreadableLines = 0;
  for (const line of lines) {
    const [type, start, end, value = "", ...source] = line.split("|");
    if (start === undefined || end === undefined) unreadableLines++;
    else samples.push({ type: type!, start, end, value, source: source.join("|") });
  }
  return { ok: true, upload: { samples, unreadableLines } };
}

const parseSamples = object<AppleHealthSamplesRequest>({
  samples: arrayOf(
    object({ type: string, start: string, end: string, value: optional(string), source: optional(string) }),
  ),
});

function readJsonUpload(body: string): ReadUpload {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const request = parseSamples(value);
  if (request === null) return { ok: false, reason: "malformed" };
  if (request.samples.length > APPLE_HEALTH_MAX_LINES) return { ok: false, reason: "too-many-lines" };
  const samples = request.samples.map((sample) => ({
    ...sample,
    value: sample.value ?? "",
    source: sample.source ?? "",
  }));
  return { ok: true, upload: { samples, unreadableLines: 0 } };
}

/**
 * The upload route's answer, which the Shortcut shows: "Pact got 14 sleep
 * samples and 2 mindful sessions." or "…, and skipped 2 lines it couldn't read."
 */
export function uploadText(result: AppleHealthUploadResult): string {
  const got = `Pact got ${count(result.sleepSamples, "sleep sample")} and ${count(result.mindfulSessions, "mindful session")}`;
  if (result.skippedLines === 0) return `${got}.`;
  return `${got}, and skipped ${count(result.skippedLines, "line")} it couldn't read.`;
}

/** The upload route's answer to a key it doesn't know, or none. */
export const UNKNOWN_KEY_TEXT =
  "Pact doesn't know this key. Set up Apple Health in Pact again, then use the new Shortcut.";

/** The upload route's answer to a body it won't read. */
export const REFUSED_TEXT = {
  "too-big": "Too much at once: Pact takes up to 1 MB and 5,000 samples.",
  "too-many-lines": "Too much at once: Pact takes up to 1 MB and 5,000 samples.",
  malformed: "Pact couldn't read that. Send samples as JSON ({ samples: [...] }) or as lines.",
} as const;

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
