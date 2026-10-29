// Repo conventions a linter can't express, checked over src/:
//   - words GLOSSARY.md says to avoid (its `_Avoid_:` lines), in code and copy;
//   - the core reads time only from the Clock port.
// A line with a `conventions-ok` comment is skipped. Exits 1 on any finding.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Avoided words that are fine in their everyday sense, so checking them
// would mostly flag correct code ("every day", "integration test").
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
  .map((word) => word.replace(/\(.*\)/, "").trim().toLowerCase())
  .filter((word) => word !== "" && !EVERYDAY_WORDS.has(word));

const avoidedPattern = new RegExp(`\\b(${avoidedWords.map(escapeRegExp).join("|")})s?\\b`, "i");
// The system clock adapter is the one place the core may read real time.
const systemTimePattern = /\bDate\.now\(\)|\bnew Date\(\)/;

const findings: string[] = [];
for (const file of sourceFiles("src")) {
  const inCore = file.startsWith("src/core/") && !file.startsWith("src/core/testing/") && file !== "src/core/adapters.ts";
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (line.includes("conventions-ok")) return;
      const where = `${file}:${index + 1}`;
      const avoided = avoidedPattern.exec(line);
      if (avoided && !ALLOWED_PHRASES.some((phrase) => line.includes(phrase))) findings.push(`${where}: "${avoided[0]}" is a word GLOSSARY.md says to avoid`);
      if (inCore && systemTimePattern.test(line)) findings.push(`${where}: the core reads time only from the Clock port`);
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
