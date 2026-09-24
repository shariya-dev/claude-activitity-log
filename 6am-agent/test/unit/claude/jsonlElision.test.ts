import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeFs } from '../../../src/core/claude/fs.js';
import {
  readCompleteLines,
  readLineBatches,
  type JsonPathSegment,
  type StringElision,
  type TailLine,
} from '../../../src/core/claude/jsonlTailReader.js';

async function tmpFile(content: string | Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'h31-elide-'));
  const file = path.join(dir, 'f.jsonl');
  await writeFile(file, content);
  return file;
}

async function read(
  content: string,
  elision: StringElision | null,
  blockSize?: number,
): Promise<TailLine[]> {
  const file = await tmpFile(content);
  const out: TailLine[] = [];
  const size = Buffer.byteLength(content);
  for await (const line of readCompleteLines(nodeFs, file, 0, size, blockSize, elision)) {
    out.push(line);
  }
  return out;
}

const texts = async (content: string, elision: StringElision | null, blockSize?: number) =>
  (await read(content, elision, blockSize)).map((l) => l.text);

const MAX10: StringElision = { maxUnits: 10 };

describe('readCompleteLines with string elision', () => {
  it('replaces string literals longer than maxUnits by "" and keeps byte offsets', async () => {
    const line = `{"a":"${'x'.repeat(20)}","b":"yy","c":[1,"${'z'.repeat(11)}"]}`;
    const lines = await read(`${line}\n{"d":1}\n`, MAX10);
    expect(lines).toEqual([
      { text: '{"a":"","b":"yy","c":[1,""]}', start: 0, end: line.length + 1 },
      { text: '{"d":1}', start: line.length + 1, end: line.length + 9 },
    ]);
  });

  it('keeps a string of exactly maxUnits and elides one unit more', async () => {
    expect(await texts(`["${'x'.repeat(10)}","${'y'.repeat(11)}"]\n`, MAX10)).toEqual([
      `["${'x'.repeat(10)}",""]`,
    ]);
  });

  it('never elides a string that may decode to maxUnits or fewer', async () => {
    // Multi-byte characters and escapes are one unit (a surrogate pair counts as one).
    const kept = ['é'.repeat(10), '😀'.repeat(6), '\\n'.repeat(10), '\\u00e9'.repeat(10)];
    const line = JSON.stringify(kept).replace(/\\\\/g, '\\');
    expect(await texts(`${line}\n`, MAX10)).toEqual([line]);
    expect(await texts(`["${'日'.repeat(11)}","${'\\t'.repeat(11)}"]\n`, MAX10)).toEqual([
      '["",""]',
    ]);
  });

  it('elides long keys too', async () => {
    expect(await texts(`{"${'k'.repeat(11)}":1,"ok":2}\n`, MAX10)).toEqual(['{"":1,"ok":2}']);
  });

  it('asks keep() with the path from the root and keeps what it accepts', async () => {
    const long = 'p'.repeat(30);
    const line = JSON.stringify({
      message: {
        content: [
          { type: 'text', text: long },
          { type: 'tool_result', content: long },
        ],
      },
      toolUseResult: { stdout: long },
    });
    const seen: JsonPathSegment[][] = [];
    const elision: StringElision = {
      maxUnits: 20,
      keep: (p) => {
        seen.push([...p]);
        return p.at(-1) === 'text';
      },
    };
    expect(await texts(`${line}\n`, elision)).toEqual([
      JSON.stringify({
        message: {
          content: [
            { type: 'text', text: long },
            { type: 'tool_result', content: '' },
          ],
        },
        toolUseResult: { stdout: '' },
      }),
    ]);
    expect(seen).toEqual([
      ['message', 'content', 0, 'text'],
      ['message', 'content', 1, 'content'],
      ['toolUseResult', 'stdout'],
    ]);
  });

  it('resolves escaped keys and marks long keys as unknown in the path', async () => {
    const seen: JsonPathSegment[][] = [];
    const elision: StringElision = { maxUnits: 10, keep: (p) => (seen.push([...p]), false) };
    const line = `{"mess\\u0061ge":{"${'k'.repeat(11)}":{"v":"${'x'.repeat(11)}"}}}`;
    expect(await texts(`${line}\n`, elision)).toEqual(['{"mess\\u0061ge":{"":{"v":""}}}']);
    expect(seen).toEqual([['message', null, 'v']]);
  });

  it('gives the same result for every block size', async () => {
    const content =
      [
        JSON.stringify({
          a: 'é'.repeat(40),
          b: ['x', 'y'.repeat(25)],
          c: { 'd\n': 'q"\\'.repeat(9) },
        }),
        '{"short":"s"}',
        JSON.stringify({ t: '日本'.repeat(20) }),
      ].join('\r\n') + '\n';
    const expected = await texts(content, MAX10);
    expect(expected).toEqual([
      '{"a":"","b":["x",""],"c":{"d\\n":""}}',
      '{"short":"s"}',
      '{"t":""}',
    ]);
    for (const blockSize of [1, 2, 3, 5, 7, 16, 64]) {
      expect(await texts(content, MAX10, blockSize)).toEqual(expected);
    }
  });

  it('yields "" for a line that cannot be valid JSON because of a string token', async () => {
    const lines = [
      `{"a":"${'x'.repeat(20)}\u0001"}`, // raw control character in an elided string
      `{"a":"x\u0001"}`, // … and in a kept one
      `{"a":"${'x'.repeat(20)}\\q"}`, // invalid escape
      `{"a":"\\u12G4"}`, // invalid \\u escape
      `{"a":"${'x'.repeat(20)}`, // unterminated
      '{"a":"x', // unterminated, short
    ];
    expect(await texts(lines.join('\n') + '\n', MAX10)).toEqual(['', '', '', '', '', '']);
  });

  it('leaves structural damage outside strings to the JSON parser', async () => {
    const line = `{"a":"${'x'.repeat(20)}" "b":1}`;
    expect(await texts(`${line}\n`, MAX10)).toEqual(['{"a":"" "b":1}']);
  });

  it('strips a trailing carriage return', async () => {
    expect(await texts(`{"a":"${'x'.repeat(20)}"}\r\n{}\r\n`, MAX10)).toEqual(['{"a":""}', '{}']);
  });

  it('turns a multi-megabyte line into a short one across default-size blocks', async () => {
    const big = 'é'.repeat(3 * 1024 * 1024);
    const line = JSON.stringify({ type: 'user', toolUseResult: { stdout: big }, uuid: 'u' });
    const lines = await read(`${line}\n{}\n`, { maxUnits: 256 });
    expect(lines.map((l) => l.text)).toEqual([
      '{"type":"user","toolUseResult":{"stdout":""},"uuid":"u"}',
      '{}',
    ]);
    expect(lines[0]!.end).toBe(Buffer.byteLength(line) + 1);
  });

  it('keeps interleaved readers apart', async () => {
    const a = await tmpFile(`${Array.from({ length: 50 }, (_, i) => `{"a":${i}}`).join('\n')}\n`);
    const b = await tmpFile(
      `${Array.from({ length: 50 }, (_, i) => `{"b":"${'y'.repeat(i)}"}`).join('\n')}\n`,
    );
    const open = async (file: string, elision: StringElision | null) => {
      const { size } = await stat(file);
      return readLineBatches(nodeFs, file, 0, size, 16, elision)[Symbol.asyncIterator]();
    };
    for (const elision of [null, MAX10]) {
      const readers = [await open(a, elision), await open(b, elision)];
      const out: string[][] = [[], []];
      for (let done = 0; done < 2;) {
        done = 0;
        for (const [i, reader] of readers.entries()) {
          const next = await reader.next();
          if (next.done) done += 1;
          else out[i]!.push(...next.value.map((l) => l.text));
        }
      }
      expect(out[0]).toEqual(Array.from({ length: 50 }, (_, i) => `{"a":${i}}`));
      expect(out[1]).toEqual(
        Array.from(
          { length: 50 },
          (_, i) => `{"b":"${elision === null || i <= 10 ? 'y'.repeat(i) : ''}"}`,
        ),
      );
    }
  });

  it('keeps a partial trailing line for the next scan', async () => {
    const lines = await read(`{"a":1}\n{"b":"${'x'.repeat(40)}`, MAX10);
    expect(lines).toEqual([{ text: '{"a":1}', start: 0, end: 8 }]);
  });
});
