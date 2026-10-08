/**
 * A small, strict reader for the `.tar.gz` archives `darius snapshot` makes
 * (src/core/restore.ts). It reads ustar, GNU (`L`/`K` long names) and pax
 * (`x` headers) entries from a gzip stream, one block at a time, so an
 * archive never sits in memory.
 *
 * It exists so `darius restore` decides what lands on disk, not the system
 * `tar`: every entry path is checked before a byte is written. An absolute
 * path, a `..` segment, or an entry that is neither a file nor a directory
 * (a link, a device, a sparse file) is refused by the caller, and a header
 * with a bad checksum or an archive cut short is an error.
 */

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";

const BLOCK = 512;

export type TarEntryType = "file" | "dir" | "symlink" | "hardlink" | "other";

export interface TarEntry {
  /** The path as the archive spells it (a leading `./` included). */
  rawPath: string;
  type: TarEntryType;
  /** The tar type flag, for a message about an `other` entry. */
  flag: string;
  size: number;
  mode: number;
  /** Seconds since the epoch. */
  mtime: number;
  link: string;
}

/** What the caller does with an entry's bytes. Return null from `visit` to skip them. */
export interface TarSink {
  data(chunk: Buffer): void;
  end(): void;
}

function cString(block: Buffer, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const nul = field.indexOf(0);
  return field.subarray(0, nul === -1 ? field.length : nul).toString("utf8");
}

function numberField(block: Buffer, start: number, length: number, what: string): number {
  const field = block.subarray(start, start + length);
  const first = field[0] ?? 0;
  if ((first & 0x80) !== 0) {
    // GNU base-256: big-endian, the top bit of the first byte is the marker.
    let value = first & 0x7f;
    for (const byte of field.subarray(1)) value = value * 256 + byte;
    return value;
  }
  const text = cString(block, start, length).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/u.test(text)) throw new Error(`a tar header has a bad ${what} field`);
  return Number.parseInt(text, 8);
}

function checksumOk(block: Buffer): boolean {
  const stored = numberField(block, 148, 8, "checksum");
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) sum += index >= 148 && index < 156 ? 0x20 : (block[index] ?? 0);
  return sum === stored;
}

function typeOf(flag: string): TarEntryType {
  if (flag === "0" || flag === "" || flag === "7") return "file";
  if (flag === "5") return "dir";
  if (flag === "2") return "symlink";
  if (flag === "1") return "hardlink";
  return "other";
}

/** `<len> <key>=<value>\n` records of a pax header. */
function paxRecords(data: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space === -1) break;
    const length = Number.parseInt(data.subarray(at, space).toString("utf8"), 10);
    if (!Number.isInteger(length) || length <= 0) throw new Error("a pax header is damaged");
    const record = data.subarray(space + 1, at + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) records.set(record.slice(0, equals), record.slice(equals + 1));
    at += length;
  }
  return records;
}

interface Pending {
  path?: string;
  link?: string;
  size?: number;
}

/**
 * Reads the archive at `path` and calls `visit` once per file, directory or
 * other entry, in archive order. Rejects on a damaged or cut archive, and
 * with whatever `visit` or a sink throws.
 */
export async function readTarGz(path: string, visit: (entry: TarEntry) => TarSink | null): Promise<void> {
  let header = Buffer.alloc(0);
  let remaining = 0;
  let padding = 0;
  let ended = false;
  let sink: TarSink | null = null;
  let meta: Buffer[] | null = null;
  let metaFlag = "";
  let pending: Pending = {};

  const finishData = (): void => {
    if (meta !== null) {
      const data = Buffer.concat(meta);
      meta = null;
      if (metaFlag === "L") pending.path = cString(data, 0, data.length);
      else if (metaFlag === "K") pending.link = cString(data, 0, data.length);
      else if (metaFlag === "x") {
        const records = paxRecords(data);
        const recordPath = records.get("path");
        const recordLink = records.get("linkpath");
        const recordSize = records.get("size");
        if (recordPath !== undefined) pending.path = recordPath;
        if (recordLink !== undefined) pending.link = recordLink;
        if (recordSize !== undefined) pending.size = Number.parseInt(recordSize, 10);
      }
      return;
    }
    sink?.end();
    sink = null;
  };

  const onHeader = (block: Buffer): void => {
    if (block.every((byte) => byte === 0)) {
      ended = true;
      return;
    }
    if (!checksumOk(block)) throw new Error("a tar header has a bad checksum: the archive is damaged");
    const flag = String.fromCharCode(block[156] ?? 0).replace("\0", "");
    let size = numberField(block, 124, 12, "size");
    if (flag === "L" || flag === "K" || flag === "x" || flag === "g") {
      // The data of `g` (global pax) is read and dropped: it carries no path.
      meta = [];
      metaFlag = flag;
      remaining = size;
      padding = (BLOCK - (size % BLOCK)) % BLOCK;
      if (remaining === 0) finishData();
      return;
    }
    const magic = block.subarray(257, 263).toString("latin1");
    const name = cString(block, 0, 100);
    const prefix = magic === "ustar\0" ? cString(block, 345, 155) : "";
    if (pending.size !== undefined) size = pending.size;
    const entry: TarEntry = {
      rawPath: pending.path ?? (prefix === "" ? name : `${prefix}/${name}`),
      type: typeOf(flag),
      flag,
      size,
      mode: numberField(block, 100, 8, "mode"),
      mtime: numberField(block, 136, 12, "mtime"),
      link: pending.link ?? cString(block, 157, 100),
    };
    pending = {};
    // Links and directories carry no data, whatever their size field says.
    const dataSize = entry.type === "file" || entry.type === "other" ? size : 0;
    sink = visit(entry);
    remaining = dataSize;
    padding = (BLOCK - (dataSize % BLOCK)) % BLOCK;
    if (remaining === 0) finishData();
  };

  const feed = (chunk: Buffer): void => {
    let at = 0;
    while (at < chunk.length) {
      if (ended) return;
      if (remaining > 0) {
        const take = Math.min(remaining, chunk.length - at);
        const part = chunk.subarray(at, at + take);
        if (meta !== null) meta.push(Buffer.from(part));
        else sink?.data(part);
        remaining -= take;
        at += take;
        if (remaining === 0) finishData();
        continue;
      }
      if (padding > 0) {
        const take = Math.min(padding, chunk.length - at);
        padding -= take;
        at += take;
        continue;
      }
      const take = Math.min(BLOCK - header.length, chunk.length - at);
      header = Buffer.concat([header, chunk.subarray(at, at + take)]);
      at += take;
      if (header.length === BLOCK) {
        const block = header;
        header = Buffer.alloc(0);
        onHeader(block);
      }
    }
  };

  const stream = createReadStream(path).pipe(createGunzip());
  try {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) throw new Error("the archive did not read as bytes");
      feed(chunk);
      if (ended) break;
    }
  } catch (cause) {
    stream.destroy();
    throw cause instanceof Error && "code" in cause && String(cause.code).startsWith("Z_")
      ? new Error(`the archive is not a valid gzip file: ${cause.message}`, { cause })
      : cause;
  }
  stream.destroy();
  if (!ended) throw new Error("the archive ends in the middle: it is cut or damaged");
}
