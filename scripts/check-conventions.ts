// Repo conventions a linter can't express, checked over src/:
//   - words GLOSSARY.md says to avoid (its `_Avoid_:` lines), in code and copy;
//   - the old outcome Kept as a value, class or label (it's Satisfied now);
//   - the core reads time only from the Clock port;
//   - tests never read the real clock, so none passes or fails by the day, the
//     hour, the year or the machine's timezone;
//   - tests and the core don't use the machine's timezone or locale, real
//     timers, or Math.random, so a run doesn't depend on the machine or on luck;
//   - every localeCompare names its locale, so an order is the same on every machine;
//   - what covers an occurrence is read only through covers.ts and occurrence-state.ts:
//     the old cover predicates are gone, and a cover table's rows are touched only
//     there, in migrations, and by the module that files and decides that kind.
// And over .scratch/: every `Status:` line uses a value docs/agents/triage-labels.md lists.
// A line with a `conventions-ok` comment is skipped. Exits 1 on any finding.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Avoided words that are fine in their everyday sense, so checking them
// would mostly flag correct code ("every day", "integration test"). Kept,
// Done and Approved are avoided only as an occurrence's outcome: "an offset
// is kept", the Done button and approved evidence are right. Break and pause
// are avoided only as names for a vacation: the break statement and "pauses
// the Overdue spell" are right.
// prettier-ignore
const EVERYDAY_WORDS = new Set([
  "task", "goal", "user", "pending", "live", "day", "session", "passed", "failed",
  "success", "failure", "source", "link", "pass", "contact", "connection", "edit",
  "charge", "balance", "tab", "statement", "late", "outstanding", "instance",
  "judge", "integration", "connector", "data source", "submission", "proof", "fine",
  "transaction", "kept", "done", "approved", "break", "pause",
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

// Kept is in EVERYDAY_WORDS, so this catches it only as the outcome: a "kept"
// string, the c-kept class, or a Kept label. Shipped migrations name the old
// value and can't change.
const keptOutcomePattern = /["'`]kept["'`]|\bc-kept\b|["'`>]\s*Kept\b/;
const MIGRATIONS = "src/core/migrations.ts";

const avoidedPattern = new RegExp(`\\b(${avoidedWords.map(escapeRegExp).join("|")})s?\\b`, "i");

// Reading the real clock: Date.now, a Date made with no arguments, Date() as a
// function (today as a string), or the other clocks.
const systemTimePattern =
  /\bDate\.now\b|\bnew Date\s*(\(\s*\)|(?!\s*\())|(?<!\bnew\s+)\bDate\s*\(|\bperformance\.now\b|\bprocess\.hrtime\b|\bTemporal\.Now\b/;
// Date methods that read or write in the machine's timezone or locale. The UTC
// ones, and Intl with a named timeZone and locale, don't.
const machineTimezonePattern =
  /\.(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)\(|\.toLocale\w*\(|\.to(Date|Time)String\(/;
// Real timers and unseeded randomness.
const timerPattern = /\b(setTimeout|setInterval|setImmediate)\b/;
const randomPattern = /\bMath\.random\b/;
// A localeCompare given one argument (nested calls allowed), so the machine's locale decides.
const localeComparePattern = /\.localeCompare\((?:[^(),]|\((?:[^()]|\([^()]*\))*\))*\)/;
// The production clock, which tests replace with FakeClock.
const systemClockPattern = /\bsystemClock\b/;
// The system clock adapter is the one place the core may read real time, and
// the core's index exports it for the server to wire in.
const SYSTEM_CLOCK_ADAPTER = "src/core/adapters.ts";
const SYSTEM_CLOCK_EXPORT = "src/core/index.ts";
// The cover predicates that each picked their own subset of an occurrence's
// cover, before `coverOn` and the occurrence view replaced them (R7).
const oldCoverPredicatePattern = /\b(excuseOn|vacationOn|stillToDo|excuseCoversSql|vacationCoversSql)\b/;
const COVER_READERS = new Set(["src/core/covers.ts", "src/core/occurrence-state.ts", MIGRATIONS]);
// Each cover kind's own module files and decides its days; everyone else reads covers through COVER_READERS.
const COVER_TABLES: [RegExp, string][] = [
  [/\bexcuse_day\b/, "src/core/excuses.ts"],
  [/\bvacation_day\b/, "src/core/vacations.ts"],
];

const findings: string[] = [];
for (const file of [...sourceFiles("src"), ...testFiles("scripts")]) {
  const isTest = /\.test\.tsx?$/.test(file) || file.startsWith("src/core/testing/");
  const inCore = file.startsWith("src/core/") && !isTest && file !== SYSTEM_CLOCK_ADAPTER;
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
      if (file.startsWith("src/") && !isTest && file !== MIGRATIONS && keptOutcomePattern.test(line))
        findings.push(`${where}: the outcome is Satisfied, not Kept`);
      const systemTime = systemTimePattern.test(line);
      const systemClock = systemClockPattern.test(line);
      if (inCore && (systemTime || (systemClock && file !== SYSTEM_CLOCK_EXPORT)))
        findings.push(`${where}: the core reads time only from the Clock port`);
      if (isTest && (systemTime || systemClock))
        findings.push(`${where}: tests read time from a FakeClock or a fixed Date, never the real clock`);
      if ((isTest || inCore) && machineTimezonePattern.test(line))
        findings.push(`${where}: use the UTC Date methods, or Intl with a named timeZone and locale`);
      if ((isTest || inCore) && timerPattern.test(line))
        findings.push(`${where}: no real timers in tests or the core; move a FakeClock, or hold a fake`);
      if ((isTest || inCore) && randomPattern.test(line))
        findings.push(`${where}: no Math.random in tests or the core`);
      if (!COVER_READERS.has(file) && oldCoverPredicatePattern.test(line))
        findings.push(
          `${where}: read an occurrence's cover with coverOn or occurrenceView (covers.ts, occurrence-state.ts)`,
        );
      for (const [table, owner] of COVER_TABLES)
        if (file.startsWith("src/") && !COVER_READERS.has(file) && file !== owner && table.test(line))
          findings.push(`${where}: read an occurrence's cover through covers.ts (coverOn, coveredSql, cover_day_v)`);
      if (file.startsWith("src/") && localeComparePattern.test(line))
        findings.push(`${where}: give localeCompare a locale ("en-US"), or the machine's decides the order`);
    });
}

// The values docs/agents/triage-labels.md lists for a ticket's or spec's `Status:` line.
const STATUS_VALUES = new Set(["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "done", "wontfix"]);
for (const file of markdownFiles(".scratch")) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (!line.startsWith("Status:")) return;
      const status = line.slice("Status:".length).trim();
      if (!STATUS_VALUES.has(status))
        findings.push(`${file}:${index + 1}: "${status}" is not a Status value docs/agents/triage-labels.md lists`);
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

function* markdownFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(path);
    else if (entry.name.endsWith(".md")) yield path;
  }
}

function* testFiles(dir: string): Generator<string> {
  for (const file of sourceFiles(dir)) if (/\.test\.tsx?$/.test(file)) yield file;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
