// Reading an upload from the Pact Health Shortcut, and what the upload route
// answers it. The Shortcut posts plain text, one sample a line
// ("type|start|end|value|source"), or JSON ({ samples: [...] }). The core
// judges what the samples say; this only reads their shape.

import { APPLE_HEALTH_MAX_LINES } from "../shared/api.ts";
import type { AppleHealthSampleFields, AppleHealthUpload, AppleHealthUploadResult } from "../shared/types.ts";
import { object, string, type Parser } from "./parse.ts";

/** What reading an upload's body came to: the upload, or why it's refused. */
export type ReadUpload =
  { ok: true; upload: AppleHealthUpload } | { ok: false; reason: "too-many-lines" | "malformed" };

/**
 * Reads an upload's body. A body starting with "{" is JSON, whatever its
 * Content-Type (Shortcuts sets it as the action's options say). Any other is
 * lines: a blank line is ignored, and a missing field is empty, so the core
 * skips a line of another type ("steps|1234") silently and counts a sleep or
 * mindful line without its dates as unreadable. A source with "|" in it
 * keeps it. More than APPLE_HEALTH_MAX_LINES samples or lines is too many.
 */
export function readUpload(body: string): ReadUpload {
  if (body.trimStart().startsWith("{")) return readJsonUpload(body);
  const lines = body.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length > APPLE_HEALTH_MAX_LINES) return { ok: false, reason: "too-many-lines" };
  const samples = lines.map((line): AppleHealthSampleFields => {
    const [type = "", start = "", end = "", value = "", ...source] = line.split("|");
    return { type, start, end, value, source: source.join("|") };
  });
  return { ok: true, upload: { samples, unreadableLines: 0 } };
}

/** A sample's field as the Shortcut may write it: text, a number as its text, or null or left out as "". */
const field: Parser<string> = (value) =>
  value === undefined || value === null ? "" : typeof value === "number" ? String(value) : string(value);

const parseSample = object<AppleHealthSampleFields>({
  type: field,
  start: field,
  end: field,
  value: field,
  source: field,
});

/**
 * The JSON body `{ samples: [...] }`; another shape is malformed. Each sample
 * is read on its own (`field`), so one of another shape, such as a string or
 * a date written as an object, is counted unreadable as a bad line is.
 */
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
  const samples: AppleHealthSampleFields[] = [];
  for (const sample of request.samples) {
    const parsed = parseSample(sample);
    if (parsed !== null) samples.push(parsed);
  }
  return { ok: true, upload: { samples, unreadableLines: request.samples.length - samples.length } };
}

/** `{ samples: [...] }`, its samples not read yet. */
const parseSamples = object<{ samples: unknown[] }>({ samples: (value) => (Array.isArray(value) ? value : null) });

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

const TOO_MUCH_TEXT = "Too much at once: Pact takes up to 1 MB and 5,000 samples.";

/** The upload route's answer to a body it won't read. */
export const REFUSED_TEXT = {
  "too-big": TOO_MUCH_TEXT,
  "too-many-lines": TOO_MUCH_TEXT,
  malformed: "Pact couldn't read that. Send samples as JSON ({ samples: [...] }) or as lines.",
} as const;

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
