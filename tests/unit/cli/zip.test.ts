import { describe, expect, test } from 'bun:test';
import { inflateRawSync } from 'node:zlib';
import { buildZipArchive, type ZipEntry } from '../../../src/cli/zip';

/** Little-endian readers for poking at the raw archive bytes in assertions. */
const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u16 = (bytes: Uint8Array, offset: number): number => view(bytes).getUint16(offset, true);
const u32 = (bytes: Uint8Array, offset: number): number => view(bytes).getUint32(offset, true);

const EOCD_SIG = 0x06054b50;
const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;

/** Find the End Of Central Directory record (last 22 bytes, no zip comment). */
const eocd = (bytes: Uint8Array): number => bytes.length - 22;

/**
 * Decompress one entry by name by walking the central directory to its local
 * header offset, then inflating the stored DEFLATE stream. A self-contained ZIP
 * reader so the round-trip test needs no external unzip tool.
 */
const readEntry = (bytes: Uint8Array, name: string): Uint8Array => {
  const target = new TextEncoder().encode(name);
  const cdOffset = u32(bytes, eocd(bytes) + 16);
  const count = u16(bytes, eocd(bytes) + 10);
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    expect(u32(bytes, p)).toBe(CENTRAL_SIG);
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOffset = u32(bytes, p + 42);
    const entryName = bytes.subarray(p + 46, p + 46 + nameLen);
    if (entryName.length === target.length && entryName.every((b, j) => b === target[j])) {
      // Local header: 30 fixed bytes + name + extra, then the compressed data.
      expect(u32(bytes, localOffset)).toBe(LOCAL_SIG);
      const localNameLen = u16(bytes, localOffset + 26);
      const localExtraLen = u16(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const data = bytes.subarray(dataStart, dataStart + compSize);
      return method === 0 ? new Uint8Array(data) : new Uint8Array(inflateRawSync(data));
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`entry not found: ${name}`);
};

describe('buildZipArchive', () => {
  test('an empty archive is a lone 22-byte EOCD with zero entries', () => {
    const zip = buildZipArchive([]);
    expect(zip.length).toBe(22);
    expect(u32(zip, 0)).toBe(EOCD_SIG);
    expect(u16(zip, 10)).toBe(0); // total entries
  });

  test('starts with a local file header and ends with an EOCD', () => {
    const zip = buildZipArchive([{ name: 'a.txt', content: new TextEncoder().encode('hello') }]);
    expect(u32(zip, 0)).toBe(LOCAL_SIG);
    expect(u32(zip, eocd(zip))).toBe(EOCD_SIG);
  });

  test('records every entry in the central directory count', () => {
    const entries: ZipEntry[] = [
      { name: 'one', content: new Uint8Array([1, 2, 3]) },
      { name: 'dir/two', content: new Uint8Array([4, 5]) },
      { name: 'three', content: new Uint8Array([]) },
    ];
    const zip = buildZipArchive(entries);
    expect(u16(zip, eocd(zip) + 8)).toBe(3); // entries on this disk
    expect(u16(zip, eocd(zip) + 10)).toBe(3); // total entries
  });

  test('round-trips entry bytes through real DEFLATE (compressible payload)', () => {
    const content = new TextEncoder().encode('bunmaska '.repeat(500));
    const zip = buildZipArchive([{ name: 'big.txt', content }]);
    expect(readEntry(zip, 'big.txt')).toEqual(content);
  });

  test('round-trips a nested path and an empty file', () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]); // 'MZ' + bytes
    const zip = buildZipArchive([
      { name: 'My App/My App.exe', content: exe },
      { name: 'My App/engine.id', content: new Uint8Array([]) },
    ]);
    expect(readEntry(zip, 'My App/My App.exe')).toEqual(exe);
    expect(readEntry(zip, 'My App/engine.id')).toEqual(new Uint8Array([]));
  });

  test('marks names UTF-8 (general-purpose bit 11) so non-ASCII paths survive', () => {
    const zip = buildZipArchive([{ name: 'café/x', content: new Uint8Array([1]) }]);
    // Local header general-purpose flags at offset 6.
    expect(u16(zip, 6) & 0x0800).toBe(0x0800);
  });
});
