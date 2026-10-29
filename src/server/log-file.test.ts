// The log file, against a temporary directory and stand-in streams: what the
// streams are given still reaches them, and the file gets a timestamped copy.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { expect, onTestFinished, test } from "vitest";
import { startLogFile } from "./log-file.ts";

const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z /;

/** A stdout and stderr that record what they're given, and a log path in a fresh directory. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pact-log-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const recording = () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    return { stream, chunks };
  };
  const stdout = recording();
  const stderr = recording();
  return { dir, path: join(dir, "logs", "pact.log"), stdout, stderr };
}

const lines = (path: string) => readFileSync(path, "utf8").split("\n").filter((line) => line !== "");

test("every line either stream writes is copied to the file with a timestamp, and still reaches the stream", () => {
  const { path, stdout, stderr } = setup();
  startLogFile({ path, maxBytes: 1024 * 1024, stdout: stdout.stream, stderr: stderr.stream });

  stdout.stream.write("listening\n");
  stderr.stream.write("first half of a line, ");
  stderr.stream.write("second half\nand another\n");
  stdout.stream.write(Buffer.from("bytes too\n"));

  expect(stdout.chunks).toEqual(["listening\n", "bytes too\n"]);
  expect(stderr.chunks).toEqual(["first half of a line, ", "second half\nand another\n"]);
  const logged = lines(path);
  expect(logged.map((line) => line.replace(TIMESTAMP, ""))).toEqual([
    "listening",
    "first half of a line, second half",
    "and another",
    "bytes too",
  ]);
  for (const line of logged) expect(line).toMatch(TIMESTAMP);
});

test("past the cap the file becomes <name>.1, replacing the old one, and a new file starts", () => {
  const { path, stdout, stderr } = setup();
  startLogFile({ path, maxBytes: 100, stdout: stdout.stream, stderr: stderr.stream });

  for (let i = 1; i <= 12; i++) stdout.stream.write(`line ${i}\n`);

  // Each line is 32 or 33 bytes with its timestamp, so the file passes 100
  // bytes at every fourth line: it rotates after lines 4, 8 and 12.
  expect(lines(`${path}.1`).map((line) => line.replace(TIMESTAMP, ""))).toEqual([
    "line 9",
    "line 10",
    "line 11",
    "line 12",
  ]);
  expect(readFileSync(path, "utf8")).toBe("");
  stdout.stream.write("line 13\n");
  expect(lines(path).map((line) => line.replace(TIMESTAMP, ""))).toEqual(["line 13"]);
});

test("appends to the file a previous boot left", () => {
  const { dir, path, stdout, stderr } = setup();
  mkdirSync(join(dir, "logs"));
  writeFileSync(path, "2026-01-05T14:00:00.000Z last boot\n");
  startLogFile({ path, maxBytes: 1024 * 1024, stdout: stdout.stream, stderr: stderr.stream });

  stdout.stream.write("this boot\n");

  expect(lines(path).map((line) => line.replace(TIMESTAMP, ""))).toEqual(["last boot", "this boot"]);
});

test("a file that can't be written is reported once on stderr, and the streams carry on", () => {
  const { dir, path, stdout, stderr } = setup();
  // A directory where the rotated file should go makes the first rotation fail.
  mkdirSync(join(dir, "logs", "pact.log.1", "in-the-way"), { recursive: true });
  startLogFile({ path, maxBytes: 10, stdout: stdout.stream, stderr: stderr.stream });

  expect(() => {
    for (let i = 1; i <= 3; i++) stdout.stream.write(`line ${i}\n`);
    stderr.stream.write("an error\n");
  }).not.toThrow();

  expect(stdout.chunks).toEqual(["line 1\n", "line 2\n", "line 3\n"]);
  const reports = stderr.chunks.filter((chunk) => chunk.includes(path));
  expect(reports).toHaveLength(1);
  expect(stderr.chunks.at(-1)).toBe("an error\n");
  // Nothing after the failure reaches the file.
  expect(lines(path).map((line) => line.replace(TIMESTAMP, ""))).toEqual(["line 1"]);
});

test("a log directory that can't be made is reported, and the streams carry on", () => {
  const { dir, stdout, stderr } = setup();
  writeFileSync(join(dir, "not-a-directory"), "");
  const path = join(dir, "not-a-directory", "pact.log");

  expect(() => startLogFile({ path, maxBytes: 1024, stdout: stdout.stream, stderr: stderr.stream })).not.toThrow();
  stdout.stream.write("still here\n");

  expect(stdout.chunks).toEqual(["still here\n"]);
  expect(stderr.chunks.filter((chunk) => chunk.includes(path))).toHaveLength(1);
  expect(existsSync(path)).toBe(false);
});
