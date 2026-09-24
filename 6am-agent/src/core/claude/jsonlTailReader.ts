/**
 * Incremental JSONL reader: yields only complete (`\n`-terminated) lines in [start, end).
 * A partial trailing line is left for the next scan. Memory holds one block plus the
 * longest line in progress (real lines reach ~5 MB), never the whole file.
 *
 * With a `StringElision`, the line is lexed while it streams in and every string literal that
 * provably decodes to more than `maxUnits` UTF-16 units is replaced by `""`, unless `keep`
 * accepts its path. Such a string's bytes are never buffered, so a 5 MB tool result costs one block instead
 * of a 5 MB buffer, a 5 MB string and its parsed copy (H31). Offsets stay those of the file.
 * A line with a malformed string token (raw control character, bad escape, unterminated) is not
 * valid JSON with or without elision and is yielded as `''`.
 */
import type { FsLike } from './fs.js';

export const BLOCK_SIZE = 256 * 1024;

export interface TailLine {
  text: string;
  /** Absolute byte offset of the line's first byte. */
  start: number;
  /** Absolute byte offset just after its `\n`. */
  end: number;
}

/** Object key (null when it was elided or is too long to matter), or array index. */
export type JsonPathSegment = string | number | null;

export interface StringElision {
  /**
   * Strings provably longer than this many UTF-16 units (a lower bound counted from UTF-8 lead
   * bytes and escapes) become `""`. Keys over it are always elided, so it must exceed every key
   * a caller's `keep` looks for.
   */
  maxUnits: number;
  /** Asked once per such string value with its path from the line's root; true keeps it. */
  keep?: (path: readonly JsonPathSegment[]) => boolean;
}

const NEWLINE = 0x0a;
const CR = 0x0d;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;
const OPEN_ARRAY = 0x5b;
const CLOSE_ARRAY = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;
const LOWER_U = 0x75;
/** Keys longer than this (in bytes) are never ones a caller looks for: recorded as null. */
const MAX_KEY_BYTES = 256;
/** Initial line buffer; one that grew past 4× this for a long kept line is released after it. */
const OUT_BYTES = 64 * 1024;

/** `"` `\` `/` `b` `f` `n` `r` `t`: the one-character JSON escapes. */
function isSimpleEscape(b: number): boolean {
  return (
    b === 0x22 ||
    b === 0x5c ||
    b === 0x2f ||
    b === 0x62 ||
    b === 0x66 ||
    b === 0x6e ||
    b === 0x72 ||
    b === 0x74
  );
}

function isHex(b: number): boolean {
  return (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66);
}

type ReadBlock = (block: Buffer, position: number) => Promise<number>;

export async function* readCompleteLines(
  fs: FsLike,
  file: string,
  start: number,
  end: number,
  blockSize: number = BLOCK_SIZE,
  elision: StringElision | null = null,
): AsyncGenerator<TailLine> {
  for await (const lines of readLineBatches(fs, file, start, end, blockSize, elision)) {
    yield* lines;
  }
}

/**
 * `readCompleteLines`, one array per block read: the lines that block completed, in order
 * (possibly none). Callers iterate each array synchronously instead of awaiting every line.
 * The array is reused for the next block.
 */
export async function* readLineBatches(
  fs: FsLike,
  file: string,
  start: number,
  end: number,
  blockSize: number = BLOCK_SIZE,
  elision: StringElision | null = null,
): AsyncGenerator<readonly TailLine[]> {
  if (start >= end) return;
  const handle = await fs.open(file, 'r');
  const block = Buffer.allocUnsafe(blockSize);
  try {
    const read: ReadBlock = async (into, position) =>
      (await handle.read(into, 0, Math.min(into.length, end - position), position)).bytesRead;
    if (elision === null) {
      yield* plainLines(read, block, start, end);
    } else {
      const lexer = new ElidingLexer(elision, start);
      const lines: TailLine[] = [];
      let position = start;
      while (position < end) {
        const bytesRead = await read(block, position);
        if (bytesRead === 0) break;
        lines.length = 0;
        lexer.feed(block, bytesRead, position, lines);
        position += bytesRead;
        yield lines;
      }
    }
  } finally {
    await handle.close();
  }
}

async function* plainLines(
  read: ReadBlock,
  block: Buffer,
  start: number,
  end: number,
): AsyncGenerator<readonly TailLine[]> {
  const lines: TailLine[] = [];
  let pending: Buffer[] = [];
  let pendingLength = 0;
  let lineStart = start;
  let position = start;
  while (position < end) {
    const bytesRead = await read(block, position);
    if (bytesRead === 0) break;
    lines.length = 0;
    const data = block.subarray(0, bytesRead);
    let from = 0;
    let nl = data.indexOf(NEWLINE, from);
    while (nl !== -1) {
      const piece = data.subarray(from, nl);
      const bytes = pendingLength === 0 ? piece : Buffer.concat([...pending, piece]);
      const lineEnd = position + nl + 1;
      const contentLength = bytes.length > 0 && bytes[bytes.length - 1] === CR ? -1 : undefined;
      lines.push({
        text: bytes.subarray(0, contentLength).toString('utf8'),
        start: lineStart,
        end: lineEnd,
      });
      pending = [];
      pendingLength = 0;
      lineStart = lineEnd;
      from = nl + 1;
      nl = data.indexOf(NEWLINE, from);
    }
    if (from < bytesRead) {
      // Copy: `block` is reused for the next read.
      pending.push(Buffer.from(data.subarray(from)));
      pendingLength += bytesRead - from;
    }
    position += bytesRead;
    yield lines;
  }
}

/**
 * One pass over the bytes: a JSON string lexer plus the container path. Only string tokens are
 * rewritten and each becomes another well-formed string token; every byte outside them is
 * copied. So the rewritten line is valid JSON exactly when the original is.
 */
class ElidingLexer {
  private readonly maxUnits: number;
  private readonly keep: StringElision['keep'];
  private lineStart: number;
  /** The line so far, without the bytes of elided strings. */
  private out = Buffer.allocUnsafe(OUT_BYTES);
  private outLength = 0;

  // Container stack, per depth: array or object, the array index, the object key's bytes in
  // `out` (start -1: none or elided; decoded only when `keep` is asked), and whether the next
  // string is a key.
  private readonly isArray: boolean[] = [];
  private readonly index: number[] = [];
  private readonly keyStart: number[] = [];
  private readonly keyEnd: number[] = [];
  private readonly keyEscaped: boolean[] = [];
  private readonly expectKey: boolean[] = [];
  private depth = 0;

  private inString = false;
  private isKey = false;
  /** 0: none, 1: after `\`, 2–5: inside `\uXXXX` (hex digits still expected + 1). */
  private escape = 0;
  private hasEscape = false;
  /** A lower bound of the current string's decoded UTF-16 length. */
  private units = 0;
  /** The string passed maxUnits: it is being dropped, or `keep` accepted it. */
  private decided = false;
  private dropping = false;
  /** A malformed string token: the line cannot be valid JSON. */
  private broken = false;
  /** Where the current string's content starts in `out`. */
  private stringOut = 0;

  constructor(elision: StringElision, start: number) {
    this.maxUnits = elision.maxUnits;
    this.keep = elision.keep;
    this.lineStart = start;
  }

  /** Lexes `block[0, length)`, read at file offset `position`; completed lines go to `lines`. */
  feed(block: Buffer, length: number, position: number, lines: TailLine[]): void {
    /** Start of the block bytes still to copy to `out`; -1 while dropping. */
    let copyFrom = this.dropping ? -1 : 0;
    let i = 0;
    while (i < length) {
      if (this.inString && this.escape === 0) {
        // Fast path over plain string bytes: stop at `"`, `\` or a control byte (incl. `\n`).
        if (this.decided) {
          while (i < length) {
            const b = block[i]!;
            if (b === QUOTE || b === BACKSLASH || b < 0x20) break;
            i += 1;
          }
        } else {
          const max = this.maxUnits;
          let units = this.units;
          while (i < length && units <= max) {
            const b = block[i]!;
            if (b === QUOTE || b === BACKSLASH || b < 0x20) break;
            // ASCII, or a UTF-8 lead byte: at least one UTF-16 unit each.
            if (b < 0x80 || b >= 0xc0) units += 1;
            i += 1;
          }
          this.units = units;
          if (units > max) {
            copyFrom = this.decide(copyFrom);
            continue;
          }
        }
        if (i >= length) break;
      }
      const b = block[i]!;
      if (b === NEWLINE) {
        if (copyFrom >= 0) this.append(block, copyFrom, i);
        this.endLine(position + i + 1, lines);
        i += 1;
        copyFrom = i;
        continue;
      }
      if (this.inString) {
        if (this.escape === 1) {
          if (b === LOWER_U) {
            this.escape = 5;
          } else {
            if (!isSimpleEscape(b)) this.broken = true;
            this.escape = 0;
            this.units += 1;
          }
        } else if (this.escape > 1) {
          if (!isHex(b)) this.broken = true;
          this.escape -= 1;
          if (this.escape === 1) {
            this.escape = 0;
            this.units += 1;
          }
        } else if (b === QUOTE) {
          copyFrom = this.closeString(block, i, copyFrom);
        } else if (b === BACKSLASH) {
          this.escape = 1;
          this.hasEscape = true;
        } else {
          this.broken = true; // a raw control byte
        }
        if (this.inString && !this.decided && this.units > this.maxUnits) {
          copyFrom = this.decide(copyFrom);
        }
        i += 1;
        continue;
      }
      switch (b) {
        case QUOTE:
          this.append(block, copyFrom, i + 1);
          copyFrom = i + 1;
          this.openString();
          break;
        case OPEN_OBJECT:
        case OPEN_ARRAY:
          this.isArray[this.depth] = b === OPEN_ARRAY;
          this.index[this.depth] = 0;
          this.keyStart[this.depth] = -1;
          this.expectKey[this.depth] = b === OPEN_OBJECT;
          this.depth += 1;
          break;
        case CLOSE_OBJECT:
        case CLOSE_ARRAY:
          if (this.depth > 0) this.depth -= 1;
          break;
        case COMMA:
          if (this.depth > 0) {
            const top = this.depth - 1;
            if (this.isArray[top]) {
              this.index[top]! += 1;
            } else {
              this.keyStart[top] = -1;
              this.expectKey[top] = true;
            }
          }
          break;
        case COLON:
          if (this.depth > 0 && !this.isArray[this.depth - 1])
            this.expectKey[this.depth - 1] = false;
          break;
      }
      i += 1;
    }
    if (copyFrom >= 0 && copyFrom < length) this.append(block, copyFrom, length);
  }

  private append(block: Buffer, from: number, to: number): void {
    const needed = this.outLength + (to - from);
    if (needed > this.out.length) {
      const grown = Buffer.allocUnsafe(Math.max(needed, this.out.length * 2));
      this.out.copy(grown, 0, 0, this.outLength);
      this.out = grown;
    }
    block.copy(this.out, this.outLength, from, to);
    this.outLength = needed;
  }

  private openString(): void {
    const top = this.depth - 1;
    this.inString = true;
    this.isKey = top >= 0 && !this.isArray[top]! && this.expectKey[top]!;
    this.escape = 0;
    this.hasEscape = false;
    this.units = 0;
    this.decided = false;
    this.stringOut = this.outLength;
  }

  /** Past maxUnits: drop the string (keys always) unless `keep` accepts its path. */
  private decide(copyFrom: number): number {
    this.decided = true;
    if (!this.isKey && this.keep !== undefined && this.keep(this.path())) return copyFrom;
    this.dropping = true;
    this.outLength = this.stringOut;
    return -1;
  }

  /** At the closing quote `block[i]`; returns the new copy start. */
  private closeString(block: Buffer, i: number, copyFrom: number): number {
    this.inString = false;
    let from = copyFrom;
    if (this.dropping) {
      this.dropping = false;
      from = i; // resume with the closing quote
    }
    if (this.isKey) {
      if (from < i) {
        this.append(block, from, i);
        from = i;
      }
      const top = this.depth - 1;
      this.keyStart[top] = this.decided ? -1 : this.stringOut;
      this.keyEnd[top] = this.outLength;
      this.keyEscaped[top] = this.hasEscape;
      this.expectKey[top] = false;
    }
    return from;
  }

  /** The current string's path; object keys are decoded from `out`, where they stay intact. */
  private path(): JsonPathSegment[] {
    const path: JsonPathSegment[] = [];
    for (let d = 0; d < this.depth; d++) {
      if (this.isArray[d]) path.push(this.index[d]!);
      else if (this.keyStart[d]! < 0) path.push(null);
      else path.push(keyText(this.out, this.keyStart[d]!, this.keyEnd[d]!, this.keyEscaped[d]!));
    }
    return path;
  }

  private endLine(lineEnd: number, lines: TailLine[]): void {
    let text = '';
    if (!this.broken && !this.inString) {
      const n = this.outLength;
      text = this.out.toString('utf8', 0, n > 0 && this.out[n - 1] === CR ? n - 1 : n);
    }
    lines.push({ text, start: this.lineStart, end: lineEnd });
    this.lineStart = lineEnd;
    this.outLength = 0;
    if (this.out.length > OUT_BYTES * 4) this.out = Buffer.allocUnsafe(OUT_BYTES);
    this.depth = 0;
    this.inString = false;
    this.escape = 0;
    this.dropping = false;
    this.broken = false;
  }
}

/** A key's decoded text, or null when it is too long to be one a caller looks for. */
function keyText(out: Buffer, from: number, to: number, escaped: boolean): string | null {
  if (to - from > MAX_KEY_BYTES) return null;
  const raw = out.toString('utf8', from, to);
  if (!escaped) return raw;
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return null;
  }
}
