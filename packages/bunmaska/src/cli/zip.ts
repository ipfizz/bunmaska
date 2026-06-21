/**
 * A minimal, dependency-free ZIP archive writer (DEFLATE) in pure TypeScript.
 *
 * Windows has no dependable `tar`-makes-a-zip tool: the modern system `bsdtar`
 * can, but a dev box's PATH routinely shadows it with Git's GNU tar, which
 * cannot. So — exactly as `build-linux.ts` hand-rolls the Debian `ar` container
 * rather than shell out — the Windows packager emits its `.zip` here using the
 * runtime's own `node:zlib` DEFLATE and `Bun.hash.crc32`, spawning no external
 * process. The output is a standard PKZIP 2.0 (method 8) archive that Explorer,
 * PowerShell `Expand-Archive`, and `unzip` all open.
 */

import { deflateRawSync } from 'node:zlib';

/** One file to place in the archive: an archive-relative path and its bytes. */
export type ZipEntry = {
  readonly name: string;
  readonly content: Uint8Array;
};

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;
const VERSION_NEEDED = 20; // 2.0 — the floor for DEFLATE.
/** General-purpose bit 11: the file name (and comment) are UTF-8 encoded. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
/** Fixed MS-DOS date 1980-01-01 / time 00:00:00 so builds are reproducible. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

const LOCAL_HEADER_FIXED = 30;
const CENTRAL_HEADER_FIXED = 46;
const EOCD_FIXED = 22;

/** Everything needed to emit both headers for one entry, computed once. */
type PreparedEntry = {
  readonly nameBytes: Uint8Array;
  readonly stored: Uint8Array;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
};

/** Compress (or store) one entry's payload and capture its CRC + sizes. */
const prepareEntry = (entry: ZipEntry, localOffset: number): PreparedEntry => {
  const nameBytes = new TextEncoder().encode(entry.name);
  const crc = Bun.hash.crc32(entry.content) >>> 0;
  // An empty payload stores verbatim (a DEFLATE stream for zero bytes is pure
  // overhead); everything else uses raw DEFLATE, which is what method 8 wants.
  if (entry.content.length === 0) {
    return {
      nameBytes,
      stored: entry.content,
      method: METHOD_STORE,
      crc,
      compressedSize: 0,
      uncompressedSize: 0,
      localOffset,
    };
  }
  const deflated = new Uint8Array(deflateRawSync(entry.content));
  return {
    nameBytes,
    stored: deflated,
    method: METHOD_DEFLATE,
    crc,
    compressedSize: deflated.length,
    uncompressedSize: entry.content.length,
    localOffset,
  };
};

/** The local file header (30 fixed bytes + name) that precedes an entry's data. */
const localHeader = (entry: PreparedEntry): Uint8Array => {
  const header = new Uint8Array(LOCAL_HEADER_FIXED + entry.nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, LOCAL_FILE_HEADER_SIG, true);
  view.setUint16(4, VERSION_NEEDED, true);
  view.setUint16(6, FLAG_UTF8, true);
  view.setUint16(8, entry.method, true);
  view.setUint16(10, DOS_TIME, true);
  view.setUint16(12, DOS_DATE, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.compressedSize, true);
  view.setUint32(22, entry.uncompressedSize, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true); // extra field length
  header.set(entry.nameBytes, LOCAL_HEADER_FIXED);
  return header;
};

/** One central-directory record (46 fixed bytes + name) describing an entry. */
const centralHeader = (entry: PreparedEntry): Uint8Array => {
  const header = new Uint8Array(CENTRAL_HEADER_FIXED + entry.nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, CENTRAL_DIR_HEADER_SIG, true);
  view.setUint16(4, VERSION_NEEDED, true); // version made by (host 0 = FAT/Windows)
  view.setUint16(6, VERSION_NEEDED, true); // version needed to extract
  view.setUint16(8, FLAG_UTF8, true);
  view.setUint16(10, entry.method, true);
  view.setUint16(12, DOS_TIME, true);
  view.setUint16(14, DOS_DATE, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.compressedSize, true);
  view.setUint32(24, entry.uncompressedSize, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true); // extra field length
  view.setUint16(32, 0, true); // file comment length
  view.setUint16(34, 0, true); // disk number start
  view.setUint16(36, 0, true); // internal attributes
  view.setUint32(38, 0, true); // external attributes
  view.setUint32(42, entry.localOffset, true);
  header.set(entry.nameBytes, CENTRAL_HEADER_FIXED);
  return header;
};

/** The end-of-central-directory record that closes the archive. */
const endOfCentralDir = (count: number, cdSize: number, cdOffset: number): Uint8Array => {
  const eocd = new Uint8Array(EOCD_FIXED);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, END_OF_CENTRAL_DIR_SIG, true);
  view.setUint16(4, 0, true); // this disk number
  view.setUint16(6, 0, true); // disk with the central directory
  view.setUint16(8, count, true); // central-directory entries on this disk
  view.setUint16(10, count, true); // total central-directory entries
  view.setUint32(12, cdSize, true);
  view.setUint32(16, cdOffset, true);
  view.setUint16(20, 0, true); // archive comment length
  return eocd;
};

/** Concatenate byte chunks into one contiguous archive buffer. */
const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/**
 * Build a complete ZIP archive from `entries` (paths use `/` separators). Each
 * payload is DEFLATE-compressed (empty files are stored), then the local headers
 * + data, the central directory, and the EOCD are assembled in spec order. Pure.
 */
export const buildZipArchive = (entries: readonly ZipEntry[]): Uint8Array => {
  const localChunks: Uint8Array[] = [];
  const prepared: PreparedEntry[] = [];
  let offset = 0;
  for (const entry of entries) {
    const item = prepareEntry(entry, offset);
    const header = localHeader(item);
    localChunks.push(header, item.stored);
    offset += header.length + item.stored.length;
    prepared.push(item);
  }

  const centralChunks = prepared.map(centralHeader);
  const cdSize = centralChunks.reduce((n, chunk) => n + chunk.length, 0);
  const eocd = endOfCentralDir(prepared.length, cdSize, offset);

  return concat([...localChunks, ...centralChunks, eocd]);
};
