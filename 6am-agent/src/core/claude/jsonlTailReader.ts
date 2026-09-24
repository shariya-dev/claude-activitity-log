/**
 * Incremental JSONL reader: yields only complete (`\n`-terminated) lines in [start, end).
 * A partial trailing line is left for the next scan. Memory holds one block plus the
 * longest line in progress (real lines reach ~5 MB), never the whole file.
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

const NEWLINE = 0x0a;
const CR = 0x0d;

export async function* readCompleteLines(
  fs: FsLike,
  file: string,
  start: number,
  end: number,
  blockSize: number = BLOCK_SIZE,
): AsyncGenerator<TailLine> {
  if (start >= end) return;
  const handle = await fs.open(file, 'r');
  try {
    const block = Buffer.allocUnsafe(blockSize);
    let pending: Buffer[] = [];
    let pendingLength = 0;
    let lineStart = start;
    let position = start;
    while (position < end) {
      const { bytesRead } = await handle.read(
        block,
        0,
        Math.min(blockSize, end - position),
        position,
      );
      if (bytesRead === 0) break;
      const data = block.subarray(0, bytesRead);
      let from = 0;
      let nl = data.indexOf(NEWLINE, from);
      while (nl !== -1) {
        const piece = data.subarray(from, nl);
        const bytes = pendingLength === 0 ? piece : Buffer.concat([...pending, piece]);
        const lineEnd = position + nl + 1;
        const contentLength = bytes.length > 0 && bytes[bytes.length - 1] === CR ? -1 : undefined;
        yield {
          text: bytes.subarray(0, contentLength).toString('utf8'),
          start: lineStart,
          end: lineEnd,
        };
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
    }
  } finally {
    await handle.close();
  }
}
