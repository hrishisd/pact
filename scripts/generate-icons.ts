// Draws Pact's app icons as PNGs, with no dependencies: a white check mark on
// the accent blue, full bleed (iOS rounds the corners itself, and the mark
// stays inside the maskable safe zone).
//
//   node --experimental-strip-types scripts/generate-icons.ts
//
// Writes src/client/public/icons/{icon-192,icon-512,apple-touch-icon}.png.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

const OUT = join(import.meta.dirname, "..", "src", "client", "public", "icons");
const BACKGROUND = [0x22, 0x45, 0x7a] as const; // --accent
const MARK = [0xff, 0xff, 0xff] as const;

/** The check mark as a polyline in unit coordinates, and its stroke width. */
const CHECK: Array<[number, number]> = [
  [0.29, 0.52],
  [0.435, 0.665],
  [0.715, 0.375],
];
const STROKE = 0.095;
const SUPERSAMPLE = 4;

function distanceToSegment(px: number, py: number, [ax, ay]: [number, number], [bx, by]: [number, number]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function coverage(x: number, y: number, size: number): number {
  let inside = 0;
  for (let sy = 0; sy < SUPERSAMPLE; sy++) {
    for (let sx = 0; sx < SUPERSAMPLE; sx++) {
      const u = (x + (sx + 0.5) / SUPERSAMPLE) / size;
      const v = (y + (sy + 0.5) / SUPERSAMPLE) / size;
      let d = Infinity;
      for (let i = 0; i < CHECK.length - 1; i++) d = Math.min(d, distanceToSegment(u, v, CHECK[i]!, CHECK[i + 1]!));
      if (d <= STROKE / 2) inside++;
    }
  }
  return inside / (SUPERSAMPLE * SUPERSAMPLE);
}

function png(size: number): Buffer {
  // RGB, 8 bits per channel, each row prefixed with filter type 0.
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y, size);
      for (let c = 0; c < 3; c++) {
        raw[row + 1 + x * 3 + c] = Math.round(BACKGROUND[c]! * (1 - a) + MARK[c]! * a);
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
] as const) {
  writeFileSync(join(OUT, name), png(size));
  console.log(`wrote ${join(OUT, name)} (${size}x${size})`);
}
