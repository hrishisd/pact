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
//     there, in migrations, and by the module that files and decides that kind;
//   - judging writes (a penalty inserted or deleted, an occurrence's outcome or
//     judging time updated, a pact's stage updated) happen only in settle.ts,
//     ending.ts and migrations;
//   - the layers import only what they may: src/client/ imports only src/client/
//     and src/shared/, and src/core/ never imports src/server/ or src/client/;
//   - no folder holds an x.test.ts beside an x.test.tsx: TypeScript reads them as one
//     module and type-checks only the .ts one;
//   - every table the migrations leave keyed by an occurrence (`pact_id` with `date` or
//     `occurrence_date`) is handled where a One-time occurrence moves and where a change's
//     removed days lose their cover, or the allow list below says why it needn't be.
// And over .scratch/: every `Status:` line uses a value docs/agents/triage-labels.md lists.
// A line with a `conventions-ok` comment is skipped. Exits 1 on any finding.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

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

// Writes that judge an occurrence or End a pact, and the modules that may make them: a
// penalty inserted (OR IGNORE, OR REPLACE and REPLACE INTO too) or deleted, an occurrence's
// outcome or judged_at set by UPDATE, an upsert's DO UPDATE or REPLACE, and a pact's stage
// set by UPDATE. Matched over the whole file, so a statement split across lines is caught;
// `[^;`"]` keeps a match inside one statement, and a SET clause ends at its WHERE.
const judgingWritePatterns = [
  /\b(?:INSERT(?:\s+OR\s+\w+)?|REPLACE)\s+INTO\s+penalty\b/gi,
  /\bDELETE\s+FROM\s+penalty\b/gi,
  /\bUPDATE(?:\s+OR\s+\w+)?\s+occurrence\b[^;`"]*?\bSET\b(?:(?!\bWHERE\b)[^;`"])*?\b(?:outcome|judged_at)\s*=/gi,
  /\bINTO\s+occurrence\b[^;`"]*?\bDO\s+UPDATE\s+SET\b[^;`"]*?\b(?:outcome|judged_at)\b/gi,
  /\b(?:INSERT\s+OR\s+REPLACE|REPLACE)\s+INTO\s+occurrence\b[^;`"]*?\b(?:outcome|judged_at)\b/gi,
  /\bUPDATE(?:\s+OR\s+\w+)?\s+pact\b[^;`"]*?\bSET\b(?:(?!\bWHERE\b)[^;`"])*?\bstage\s*=/gi,
];
const JUDGING_WRITERS = new Set(["src/core/settle.ts", "src/core/ending.ts", MIGRATIONS]);

// A relative import or export's path: `from "../x.ts"`, `import "./x.css"` or `import("./x.ts")`.
const importPattern = /\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;
// The src/ folders each layer may import from, by the folder its file is in.
const LAYER_IMPORTS: Record<string, (folder: string) => boolean> = {
  client: (folder) => folder === "client" || folder === "shared",
  core: (folder) => folder !== "server" && folder !== "client",
};

const findings: string[] = [];
for (const file of [...sourceFiles("src"), ...testFiles("scripts")]) {
  const isTest = /\.test\.tsx?$/.test(file) || file.startsWith("src/core/testing/");
  const inCore = file.startsWith("src/core/") && !isTest && file !== SYSTEM_CLOCK_ADAPTER;
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  if (file.startsWith("src/") && !isTest && !JUDGING_WRITERS.has(file))
    for (const pattern of judgingWritePatterns)
      for (const match of text.matchAll(pattern)) {
        const index = text.slice(0, match.index).split("\n").length - 1;
        if (lines[index]?.includes("conventions-ok")) continue;
        findings.push(
          `${file}:${index + 1}: outcomes, penalties and a pact's stage are written only by settle.ts and ending.ts`,
        );
      }
  lines.forEach((line, index) => {
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
    if ((isTest || inCore) && randomPattern.test(line)) findings.push(`${where}: no Math.random in tests or the core`);
    if (!COVER_READERS.has(file) && oldCoverPredicatePattern.test(line))
      findings.push(
        `${where}: read an occurrence's cover with coverOn or occurrenceView (covers.ts, occurrence-state.ts)`,
      );
    for (const [table, owner] of COVER_TABLES)
      if (file.startsWith("src/") && !COVER_READERS.has(file) && file !== owner && table.test(line))
        findings.push(`${where}: read an occurrence's cover through covers.ts (coverOn, coveredSql, cover_day_v)`);
    const layer = file.split("/")[1] ?? "";
    const mayImport = file.startsWith("src/") ? LAYER_IMPORTS[layer] : undefined;
    if (mayImport)
      for (const [, path] of line.matchAll(importPattern)) {
        const folder = relative("src", join(dirname(file), path ?? "")).split("/")[0] ?? "";
        if (!mayImport(folder)) findings.push(`${where}: src/${layer}/ doesn't import src/${folder}/`);
      }
    if (file.startsWith("src/") && localeComparePattern.test(line))
      findings.push(`${where}: give localeCompare a locale ("en-US"), or the machine's decides the order`);
  });
}

// x.test.ts and x.test.tsx resolve to the same module, so tsc keeps only the .ts one
// and never type-checks the other; Vitest still runs both.
const testNames = new Set<string>();
for (const file of testFiles("src")) {
  const name = file.replace(/\.tsx?$/, "");
  if (testNames.has(name))
    findings.push(`${name}.ts and ${name}.tsx: merge them, tsc type-checks only one of a same-name pair`);
  testNames.add(name);
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

// An occurrence is `(pact_id, date)`, with no foreign key that follows it (covers.ts). Each
// table of facts about one is named in these functions, which move or drop those facts.
const OCCURRENCE_HANDLERS = {
  move: [
    ["src/core/pacts.ts", "moveOneTimeOccurrence"],
    ["src/core/covers.ts", "moveCovers"],
  ],
  cleanup: [["src/core/covers.ts", "uncoverRemovedDays"]],
} as const;
type OccurrenceHandler = keyof typeof OCCURRENCE_HANDLERS;
// Occurrence tables a handler leaves alone, and why.
const OCCURRENCE_TABLES_ALLOWED: Record<string, Partial<Record<OccurrenceHandler, string>>> = {
  occurrence: {
    cleanup: "a day not open has no row yet: evidence, bedtime and judging make it, and only once the day opens",
  },
  evidence: { cleanup: "evidence is submitted only for an open occurrence, never for a day not open" },
  penalty: {
    move: "only a judged occurrence has a penalty, and a judged One-time occurrence never moves",
    cleanup: "only a judged occurrence has a penalty, and the cleanup leaves judged days alone",
  },
  reminder_sent: {
    move: "a record of pushes already sent; the moved occurrence's own reminders are dated afresh",
    cleanup: "no reminder is sent for a day not open yet",
  },
};
for (const table of occurrenceTables(readFileSync(MIGRATIONS, "utf8")))
  for (const [handler, functions] of Object.entries(OCCURRENCE_HANDLERS) as [
    OccurrenceHandler,
    readonly (readonly [string, string])[],
  ][]) {
    if (OCCURRENCE_TABLES_ALLOWED[table]?.[handler]) continue;
    const named = functions.some(([file, name]) => new RegExp(`\\b${table}\\b`).test(functionBody(file, name)));
    if (!named)
      findings.push(
        `${MIGRATIONS}: table ${table} is keyed by an occurrence; name it in ${functions.map(([, name]) => name).join(" or ")}, ` +
          `or give the reason it needn't be in OCCURRENCE_TABLES_ALLOWED (scripts/check-conventions.ts)`,
      );
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

/** The tables the migrations leave, in the end, with a `pact_id` column and a `date` or `occurrence_date` one. */
function occurrenceTables(migrations: string): string[] {
  const tables = new Map<string, string[]>();
  // SQL comments may hold any words, commas and brackets; a column is the first word of a definition.
  const sql = migrations.replace(/--.*$/gm, "");
  const statement =
    /\bCREATE TABLE (?:IF NOT EXISTS )?(\w+) \(([\s\S]*?)\);|\bDROP TABLE (?:IF EXISTS )?(\w+)|\bALTER TABLE (\w+) (?:RENAME TO (\w+)|ADD COLUMN (\w+)|DROP COLUMN (\w+))/g;
  for (const [, created, body, dropped, altered, to, added, removed] of sql.matchAll(statement)) {
    if (created && body !== undefined)
      tables.set(
        created,
        [...body.matchAll(/(?:^|,)\s*(\w+)\s+[A-Za-z]/gm)].map(([, column]) => column ?? ""),
      );
    if (dropped) tables.delete(dropped);
    const columns = altered ? tables.get(altered) : undefined;
    if (!altered || !columns) continue;
    if (to) {
      tables.delete(altered);
      tables.set(to, columns);
    }
    if (added) columns.push(added);
    if (removed)
      tables.set(
        altered,
        columns.filter((column) => column !== removed),
      );
  }
  return [...tables]
    .filter(
      ([, columns]) => columns.includes("pact_id") && (columns.includes("date") || columns.includes("occurrence_date")),
    )
    .map(([table]) => table);
}

/** The text of the function `name` in `file`, from its signature to its closing brace. */
function functionBody(file: string, name: string): string {
  const text = readFileSync(file, "utf8");
  const start = text.search(new RegExp(`\\bfunction ${name}\\(`));
  if (start === -1) throw new Error(`${file} has no function ${name}`);
  const end = text.indexOf("\n}\n", start);
  return text.slice(start, end === -1 ? undefined : end);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
