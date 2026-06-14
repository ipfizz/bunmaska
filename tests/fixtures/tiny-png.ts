import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

/**
 * A deterministic tiny-PNG fixture for the `nativeImage` integration tests.
 *
 * The bytes are GENERATED in code (a minimal 8-bit RGBA PNG encoder) rather than
 * embedded, so the asserted width/height are guaranteed to match the file the
 * native decoder reads — proving the scalar `getSize` path returns the EXACT
 * known dimensions, not a coincidence of some opaque blob.
 */

/** The fixture's known dimensions, asserted exactly by the integration tests. */
export const TINY_PNG_WIDTH = 3;
export const TINY_PNG_HEIGHT = 2;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i] ?? 0;
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};

/** Build the fixture's PNG bytes (a {@link TINY_PNG_WIDTH}×{@link TINY_PNG_HEIGHT} opaque-red image). */
export const makeTinyPng = (): Uint8Array => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(TINY_PNG_WIDTH, 0);
  ihdr.writeUInt32BE(TINY_PNG_HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = 1 + TINY_PNG_WIDTH * 4;
  const raw = Buffer.alloc(TINY_PNG_HEIGHT * stride);
  for (let y = 0; y < TINY_PNG_HEIGHT; y += 1) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    for (let x = 0; x < TINY_PNG_WIDTH; x += 1) {
      const p = row + 1 + x * 4;
      raw[p] = 255; // R
      raw[p + 3] = 255; // A
    }
  }
  return new Uint8Array(
    Buffer.concat([
      signature,
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
};

/** Write the fixture PNG to a unique temp file and return its absolute path. */
export const writeTinyPngFile = (): string => {
  const path = join(tmpdir(), `bunmaska-native-image-${process.pid}-${Date.now()}.png`);
  writeFileSync(path, makeTinyPng());
  return path;
};

/** Delete a fixture file written by {@link writeTinyPngFile} (best-effort). */
export const removeTinyPngFile = (path: string): void => {
  rmSync(path, { force: true });
};
