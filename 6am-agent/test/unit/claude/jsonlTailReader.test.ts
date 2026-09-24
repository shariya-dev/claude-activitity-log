import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { nodeFs, type FsLike } from '../../../src/core/claude/fs.js';
import { readCompleteLines, type TailLine } from '../../../src/core/claude/jsonlTailReader.js';

async function tmpFile(content: string | Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'h09-tail-'));
  const file = path.join(dir, 'f.jsonl');
  await writeFile(file, content);
  return file;
}

async function collect(
  file: string,
  start: number,
  end: number,
  blockSize?: number,
  fs: FsLike = nodeFs,
): Promise<TailLine[]> {
  const out: TailLine[] = [];
  for await (const line of readCompleteLines(fs, file, start, end, blockSize)) out.push(line);
  return out;
}

describe('readCompleteLines', () => {
  it('yields complete lines with absolute byte ranges and leaves a partial tail', async () => {
    const file = await tmpFile('a\nbb\nccc');
    const lines = await collect(file, 0, 8);
    expect(lines).toEqual([
      { text: 'a', start: 0, end: 2 },
      { text: 'bb', start: 2, end: 5 },
    ]);
  });

  it('starts at an offset and stops at the given end', async () => {
    const file = await tmpFile('a\nbb\nccc\ndd\n');
    expect(await collect(file, 2, 9)).toEqual([
      { text: 'bb', start: 2, end: 5 },
      { text: 'ccc', start: 5, end: 9 },
    ]);
  });

  it('buffers lines longer than the block size and multi-byte characters across blocks', async () => {
    const long = 'é'.repeat(50) + 'x'.repeat(37);
    const file = await tmpFile(`${long}\nz\n`);
    const size = Buffer.byteLength(`${long}\nz\n`);
    const lines = await collect(file, 0, size, 8);
    expect(lines.map((l) => l.text)).toEqual([long, 'z']);
    expect(lines[1]).toMatchObject({ end: size });
  });

  it('strips a trailing carriage return', async () => {
    const file = await tmpFile('a\r\nb\n');
    expect((await collect(file, 0, 5)).map((l) => l.text)).toEqual(['a', 'b']);
  });

  it('reads nothing when start >= end and always closes the handle', async () => {
    const file = await tmpFile('a\n');
    const close = vi.fn();
    const fs: FsLike = {
      ...nodeFs,
      open: vi.fn(async (p, f) => {
        const h = await nodeFs.open(p, f);
        return {
          read: h.read.bind(h),
          close: async () => {
            close();
            await h.close();
          },
        };
      }),
    };
    expect(await collect(file, 2, 2, undefined, fs)).toEqual([]);
    expect(fs.open).not.toHaveBeenCalled();
    await collect(file, 0, 2, undefined, fs);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stops early when the file is shorter than expected', async () => {
    const file = await tmpFile('a\nb');
    expect(await collect(file, 0, 100)).toEqual([{ text: 'a', start: 0, end: 2 }]);
  });
});
