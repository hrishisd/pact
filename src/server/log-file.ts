// A copy of the server's output in a capped file on the volume (ADR 0003).
// Everything written to stdout and stderr still goes there unchanged; the file
// gets the same text with an ISO timestamp on each line. Past `maxBytes` the
// file is renamed to `<path>.1`, replacing the previous one, and a new file
// starts. Writes are synchronous: output is low-volume, and a line written
// just before a crash must reach the file.
//
// The log never takes the app down: the first failure to write it is reported
// once on the real stderr, and the file is not written again.

import { closeSync, fstatSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { Writable } from "node:stream";

export interface LogFileOptions {
  path: string;
  /** Past this size the file is rotated. Production: 10 MB. */
  maxBytes: number;
  /** The streams to copy. Tests pass their own. */
  stdout?: Writable;
  stderr?: Writable;
}

export interface LogFile {
  /** Writes to the file only, for output that doesn't go through the streams. */
  append(text: string): void;
}

export function startLogFile({
  path,
  maxBytes,
  stdout = process.stdout,
  stderr = process.stderr,
}: LogFileOptions): LogFile {
  const writeStderr = stderr.write.bind(stderr);
  let fd: number | null = null;
  let size = 0;
  let atLineStart = true;

  const fail = (error: unknown) => {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Already failing; the report below is what matters.
      }
    }
    fd = null;
    writeStderr(`log file ${path} stopped: ${error instanceof Error ? error.message : String(error)}\n`);
  };

  const open = () => {
    fd = openSync(path, "a");
    size = fstatSync(fd).size;
  };

  try {
    mkdirSync(dirname(path), { recursive: true });
    open();
  } catch (error) {
    fail(error);
  }

  /** Puts the current time in front of each line that starts in `text`. */
  const stamp = (text: string): string => {
    const time = new Date().toISOString();
    let stamped = "";
    for (const piece of text.split(/(?<=\n)/)) {
      if (atLineStart) stamped += `${time} `;
      stamped += piece;
      atLineStart = piece.endsWith("\n");
    }
    return stamped;
  };

  const append = (text: string) => {
    if (fd === null || text === "") return;
    try {
      const bytes = Buffer.from(stamp(text));
      writeSync(fd, bytes);
      size += bytes.length;
      if (size > maxBytes) {
        closeSync(fd);
        fd = null;
        renameSync(path, `${path}.1`);
        open();
      }
    } catch (error) {
      fail(error);
    }
  };

  for (const stream of [stdout, stderr]) {
    const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      const written = write(chunk, ...rest);
      if (typeof chunk === "string") append(chunk);
      else if (chunk instanceof Uint8Array) append(Buffer.from(chunk).toString("utf8"));
      return written;
    }) as Writable["write"];
  }

  return { append };
}
