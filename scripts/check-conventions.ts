// Repo conventions a linter can't express, checked over src/:
//   - words GLOSSARY.md says to avoid (its `_Avoid_:` lines), in code and copy;
//   - the core reads time only from the Clock port;
//   - tests never read the real clock, so none passes or fails by the day, the
//     hour, the year or the machine's timezone.
// A line with a `conventions-ok` comment is skipped. Exits 1 on any finding.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Avoided words that are fine in their everyday sense, so checking them
// would mostly flag correct code ("every day", "integration test").
// prettier-ignore
const EVERYDAY_WORDS = new Set([
  "task", "goal", "user", "pending", "live", "day", "session", "passed", "failed",
  "success", "failure", "source", "link", "pass", "contact", "connection", "edit",
  "charge", "balance", "tab", "statement", "late", "outstanding", "instance",
  "judge", "integration", "connector", "data source", "submission", "proof", "fine",
  "transaction",
]);

// Copy that uses an avoided word on purpose. The tagline explains what a pact
// is to someone who hasn't met the word yet.
const ALLOWED_PHRASES = ["Commitments with money on the line"];

const avoidedWords = readFileSync("GLOSSARY.md", "utf8")
  .split("\n")
  .filter((line) => line.startsWith("_Avoid_:"))
  .flatMap((line) => line.slice("_Avoid_:".length).split(","))
  .map((word) =>
    word
      .replace(/\(.*\)/, "")
      .trim()
      .toLowerCase(),
  )
  .filter((word) => word !== "" && !EVERYDAY_WORDS.has(word));

const avoidedPattern = new RegExp(`\\b(${avoidedWords.map(escapeRegExp).join("|")})s?\\b`, "i");

// Reading the real clock: Date.now, or a Date made with no arguments.
const systemTimePattern = /\bDate\.now\b|\bnew Date\s*(\(\s*\)|(?!\s*\())/;
// The production clock, which tests replace with FakeClock.
const systemClockPattern = /\bsystemClock\b/;
// The system clock adapter is the one place the core may read real time, and
// the core's index exports it for the server to wire in.
const SYSTEM_CLOCK_ADAPTER = "src/core/adapters.ts";
const SYSTEM_CLOCK_EXPORT = "src/core/index.ts";
// Tests that read the real clock on purpose, to bracket an applied
// migration's SQLite 'now', which no Clock reaches.
const REAL_TIME_TESTS = new Set(["src/core/migrations.test.ts"]);

const findings: string[] = [];
for (const file of [...sourceFiles("src"), ...testFiles("scripts")]) {
  const isTest = /\.test\.tsx?$/.test(file) || file.startsWith("src/core/testing/");
  const inCore = file.startsWith("src/core/") && !isTest && file !== SYSTEM_CLOCK_ADAPTER;
  const realTimeAllowed = REAL_TIME_TESTS.has(file);
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (line.includes("conventions-ok")) return;
      const where = `${file}:${index + 1}`;
      if (file.startsWith("src/")) {
        const avoided = avoidedPattern.exec(line);
        if (avoided && !ALLOWED_PHRASES.some((phrase) => line.includes(phrase)))
          findings.push(`${where}: "${avoided[0]}" is a word GLOSSARY.md says to avoid`);
      }
      const systemTime = systemTimePattern.test(line);
      const systemClock = systemClockPattern.test(line);
      if (inCore && (systemTime || (systemClock && file !== SYSTEM_CLOCK_EXPORT)))
        findings.push(`${where}: the core reads time only from the Clock port`);
      if (isTest && !realTimeAllowed && (systemTime || systemClock))
        findings.push(`${where}: tests read time from a FakeClock or a fixed Date, never the real clock`);
    });
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx|html|css|webmanifest)$/.test(entry.name)) yield path;
  }
}

function* testFiles(dir: string): Generator<string> {
  for (const file of sourceFiles(dir)) if (/\.test\.tsx?$/.test(file)) yield file;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
