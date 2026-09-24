/**
 * H31: tool results, file contents and thinking text are elided while reading. Inflating them to
 * megabytes must not change a single record or chunk boundary, and must not stop the scanner
 * from reading each file to its end.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClaudeScanner } from '../../../src/core/claude/scanner.js';
import {
  collect,
  DEVICE_UID,
  fixtureText,
  makeClaudeDir,
  scanOptions,
  settings,
  sid,
  writeText,
  type ClaudeDir,
} from './helpers.js';

const BIG = 'x'.repeat(2 * 1024 * 1024 + 7);
const clock = () => new Date('2026-09-24T00:00:00.000Z');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Megabyte-sized values wherever Claude writes bulk text that no record uses. */
function inflate(line: string): string {
  const json: unknown = JSON.parse(line);
  if (!isRecord(json)) return line;
  if ('toolUseResult' in json) json.toolUseResult = { stdout: BIG, stderr: '' };
  const message = json.message;
  if (isRecord(message) && Array.isArray(message.content)) {
    for (const part of message.content) {
      if (!isRecord(part)) continue;
      if (part.type === 'thinking') part.thinking = BIG;
      if (part.type === 'tool_result') part.content = BIG;
      if (part.type === 'tool_use') part.input = { command: BIG };
      if (part.type === 'text' && json.type === 'assistant') part.text = BIG;
    }
  }
  if (isRecord(json.attachment)) json.attachment.content = BIG;
  return JSON.stringify(json);
}

async function scanFixture(fixture: string, n: number, big: boolean, prompt: boolean) {
  const dir: ClaudeDir = await makeClaudeDir();
  const text = await fixtureText(fixture);
  const file = path.join(dir.projectDir, `${sid(n)}.jsonl`);
  const lines = text.split('\n').filter((l) => l !== '');
  await writeText(file, `${(big ? lines.map(inflate) : lines).join('\n')}\n`);
  const scanner = createClaudeScanner({
    source: dir.source,
    deviceUid: () => DEVICE_UID,
    readGitRemote: async () => null,
    clock,
  });
  const chunks = await collect(
    scanner,
    new Map(),
    scanOptions({ settings: settings({ prompt }), maxUsagePerChunk: 1 }),
  );
  return { chunks, size: (await stat(file)).size };
}

describe('claude scanner — megabyte lines', () => {
  it.each([
    ['basic-session.jsonl', 1],
    ['multi-model.jsonl', 3],
    ['split-usage-growing.jsonl', 5],
  ])('%s gives the same chunks with inflated bulk text', async (fixture, n) => {
    for (const prompt of [false, true]) {
      const plain = await scanFixture(fixture, n, false, prompt);
      const big = await scanFixture(fixture, n, true, prompt);
      expect(big.size).toBeGreaterThan(plain.size + BIG.length);
      expect(big.chunks.map((c) => c.records)).toEqual(plain.chunks.map((c) => c.records));
      const last = big.chunks.at(-1)!.checkpoints.at(-1)!;
      expect(last).toMatchObject({ offset: big.size, size: big.size });
    }
  });
});
