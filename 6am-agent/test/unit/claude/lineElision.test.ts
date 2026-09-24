/**
 * H31: the scanner reads transcripts with the strings `parseLine` does not use elided. This pins
 * that the elision never changes what `parseLine` returns, for every gate combination, on the
 * fixtures and on generated lines with values straddling every length limit and with corrupted
 * bytes, and that every string path that can change the result is one the elision keeps.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeFs } from '../../../src/core/claude/fs.js';
import { readCompleteLines, type StringElision } from '../../../src/core/claude/jsonlTailReader.js';
import { parseLine, type LineGates } from '../../../src/core/claude/lineParser.js';
import { transcriptElision } from '../../../src/core/claude/scanner.js';
import { seeded } from '../../validation/gen.js';

type Rng = ReturnType<typeof seeded>;

const FIXTURES = path.resolve('test/fixtures/claude');
const GATES: LineGates[] = [false, true].flatMap((model) =>
  [false, true].flatMap((git) => [false, true].map((prompt) => ({ model, git, prompt }))),
);

async function tmpFile(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'h31-line-'));
  const file = path.join(dir, 'f.jsonl');
  await writeFile(file, content);
  return file;
}

async function readAll(file: string, elision: StringElision | null, blockSize?: number) {
  const out = [];
  const { size } = await stat(file);
  for await (const line of readCompleteLines(nodeFs, file, 0, size, blockSize, elision)) {
    out.push(line);
  }
  return out;
}

async function expectSameParse(content: string, blockSize?: number): Promise<number> {
  const file = await tmpFile(content);
  const plain = await readAll(file, null);
  for (const gates of GATES) {
    const elided = await readAll(file, transcriptElision(gates), blockSize);
    expect(elided.map((l) => [l.start, l.end])).toEqual(plain.map((l) => [l.start, l.end]));
    for (let i = 0; i < plain.length; i++) {
      expect(parseLine(elided[i]!.text, gates), `line ${i} ${JSON.stringify(gates)}`).toEqual(
        parseLine(plain[i]!.text, gates),
      );
    }
  }
  return plain.length;
}

const ALPHABETS = ['a', 'é', '日', '😀', '\n', '"', '\\', '\t', '\u2028', '\ud800'];

/** A string whose UTF-16 length is `units` (± a surrogate), from a random alphabet mix. */
function text(rng: Rng, units: number): string {
  const alphabet = ALPHABETS.slice(0, rng.int(1, ALPHABETS.length));
  let s = '';
  while (s.length < units) s += rng.pick(alphabet);
  return s;
}

/** Lengths around every limit parseLine and the elision apply (64 … 4096) and far beyond. */
function length(rng: Rng): number {
  const around = rng.pick([1, 64, 65, 128, 129, 191, 192, 256, 257, 4096, 4097, 20_000]);
  return Math.max(0, around + rng.int(-3, 3));
}

function value(rng: Rng, depth = 0): unknown {
  const r = rng.next();
  if (r < 0.5) return text(rng, length(rng));
  if (r < 0.6) return rng.int(0, 1_000_000);
  if (r < 0.65) return rng.next() < 0.5;
  if (r < 0.7) return null;
  if (depth > 2) return 'leaf';
  if (r < 0.85) return Array.from({ length: rng.int(0, 3) }, () => value(rng, depth + 1));
  return Object.fromEntries(
    Array.from({ length: rng.int(0, 3) }, () => [text(rng, rng.int(1, 12)), value(rng, depth + 1)]),
  );
}

const maybe = (rng: Rng, v: () => unknown, fallback: () => unknown) =>
  rng.next() < 0.75 ? v() : fallback();

function part(rng: Rng): unknown {
  const type = rng.pick(['text', 'tool_result', 'tool_use', 'thinking', text(rng, 5000)]);
  return {
    type,
    text: maybe(
      rng,
      () => text(rng, length(rng)),
      () => value(rng),
    ),
    content: maybe(
      rng,
      () => text(rng, length(rng)),
      () => value(rng),
    ),
    ...(rng.next() < 0.3 ? { input: { command: text(rng, length(rng)) } } : {}),
  };
}

function transcriptLine(rng: Rng): Record<string, unknown> {
  const iso = () =>
    rng.next() < 0.8
      ? new Date(Date.UTC(2026, 8, rng.int(1, 28), rng.int(0, 23))).toISOString()
      : text(rng, length(rng));
  const line: Record<string, unknown> = {
    type: rng.pick(['assistant', 'user', 'system', 'attachment', 'nope', text(rng, 4100)]),
    sessionId: maybe(
      rng,
      () => text(rng, length(rng)),
      () => value(rng),
    ),
    uuid: text(rng, length(rng)),
    timestamp: iso(),
    cwd: maybe(
      rng,
      () => text(rng, length(rng)),
      () => value(rng),
    ),
    version: text(rng, length(rng)),
    entrypoint: text(rng, length(rng)),
    gitBranch: text(rng, length(rng)),
    isSidechain: rng.next() < 0.3,
    requestId: text(rng, length(rng)),
    message: {
      role: 'user',
      model: text(rng, length(rng)),
      id: text(rng, length(rng)),
      content:
        rng.next() < 0.4
          ? text(rng, length(rng))
          : Array.from({ length: rng.int(0, 3) }, () => part(rng)),
      usage: { input_tokens: rng.int(0, 99), output_tokens: rng.int(0, 99) },
    },
    toolUseResult: value(rng),
  };
  if (rng.next() < 0.1) line.origin = { kind: rng.pick(['human', 'task', text(rng, 5000)]) };
  if (rng.next() < 0.1) line.isMeta = true;
  if (rng.next() < 0.1) line[text(rng, 4200)] = value(rng);
  return line;
}

/** Breaks a serialized line the ways real files break: truncation, control bytes, bad escapes. */
function corrupt(rng: Rng, line: string): string {
  const at = rng.int(0, line.length);
  switch (rng.int(0, 4)) {
    case 0:
      return line.slice(0, at);
    case 1:
      return `${line.slice(0, at)}\u0001${line.slice(at)}`;
    case 2:
      return `${line.slice(0, at)}\\q${line.slice(at)}`;
    case 3:
      return `${line.slice(0, at)}"${line.slice(at)}`;
    default:
      return `${line.slice(0, at)}\\u12${line.slice(at)}`;
  }
}

/** Every string leaf of a JSON value, with its path. */
function stringLeaves(value: unknown, at: (string | number)[] = []): (string | number)[][] {
  if (typeof value === 'string') return [at];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringLeaves(v, [...at, i]));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => stringLeaves(v, [...at, k]));
  }
  return [];
}

function withLeaf(value: unknown, at: (string | number)[], leaf: string): unknown {
  if (at.length === 0) return leaf;
  const copy = (Array.isArray(value) ? [...value] : { ...(value as object) }) as Record<
    string | number,
    unknown
  >;
  copy[at[0]!] = withLeaf(copy[at[0]!], at.slice(1), leaf);
  return copy;
}

describe('transcript string elision', () => {
  it('parseLine returns exactly the fields the elision allow-list was written for', () => {
    // A new ParsedLine field means a new path is read: add it to scanner.ts isParsedPath first.
    const line = readFileSync(path.join(FIXTURES, 'basic-session.jsonl'), 'utf8').split('\n')[3]!;
    expect(Object.keys(parseLine(line, { model: true, git: true, prompt: true })!)).toEqual([
      'type',
      'sessionId',
      'uuid',
      'timestampMs',
      'cwd',
      'version',
      'entrypoint',
      'gitBranch',
      'isSidechain',
      'model',
      'usage',
      'prompt',
    ]);
  });

  it('keeps every string path whose value changes what parseLine returns', () => {
    const files = readdirSync(FIXTURES, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(FIXTURES, f));
    const lines = files.flatMap((f) => readFileSync(f, 'utf8').split('\n'));
    let influential = 0;
    for (const text of lines) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        continue;
      }
      for (const at of stringLeaves(json)) {
        for (const gates of GATES) {
          const before = parseLine(text, gates);
          const after = parseLine(JSON.stringify(withLeaf(json, at, '')), gates);
          if (JSON.stringify(before) === JSON.stringify(after)) continue;
          influential += 1;
          expect(
            transcriptElision(gates).keep!(at),
            `${at.join('.')} ${JSON.stringify(gates)}`,
          ).toBe(true);
        }
      }
    }
    expect(influential).toBeGreaterThan(100);
  });

  it('parses every fixture line exactly as without elision', async () => {
    const files = readdirSync(FIXTURES, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(FIXTURES, f));
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      expect(await expectSameParse(readFileSync(file, 'utf8'), 97)).toBeGreaterThan(0);
    }
  });

  it(
    'parses generated lines exactly as without elision, clean and corrupted',
    { timeout: 60_000 },
    async () => {
      const rng = seeded(31);
      const lines: string[] = [];
      for (let i = 0; i < 400; i++) {
        // Some lines use lone surrogates and escapes via JSON.stringify; half are also corrupted.
        const json = JSON.stringify(transcriptLine(rng));
        lines.push(rng.next() < 0.5 ? json : corrupt(rng, json).replace(/\n/g, ' '));
      }
      const content = `${lines.join('\n')}\n`;
      expect(await expectSameParse(content)).toBe(lines.length);
      // Tiny blocks put every token boundary across reads.
      const few = `${lines.slice(0, 12).join('\n')}\n`;
      expect(await expectSameParse(few, 13)).toBe(12);
    },
  );

  it('elides the long strings that no parsed field can use', async () => {
    const line = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'p'.repeat(5000) },
          { type: 'tool_result', content: 'r'.repeat(5000) },
        ],
      },
      toolUseResult: { stdout: 'o'.repeat(5000) },
    };
    const file = await tmpFile(`${JSON.stringify(line)}\n`);
    const [off] = await readAll(file, transcriptElision(GATES[0]!));
    const [on] = await readAll(file, transcriptElision(GATES[1]!));
    expect(off!.text.length).toBeLessThan(200);
    // Prompt ON keeps the user text parts and the string form of message.content only.
    expect(on!.text).toContain('p'.repeat(5000));
    expect(on!.text).not.toContain('r'.repeat(5000));
    expect(on!.text).not.toContain('o'.repeat(5000));
  });
});
