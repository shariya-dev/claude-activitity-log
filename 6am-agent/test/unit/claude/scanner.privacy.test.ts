import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { extractPrompt } from '../../../src/core/claude/prompt.js';
import { createClaudeScanner } from '../../../src/core/claude/scanner.js';
import {
  addSubagentFixture,
  addTranscript,
  collect,
  DEVICE_UID,
  makeClaudeDir,
  merged,
  scanOptions,
  settings,
  sid,
  spyFs,
} from './helpers.js';

vi.mock('../../../src/core/claude/prompt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/claude/prompt.js')>();
  return { ...actual, extractPrompt: vi.fn(actual.extractPrompt) };
});

async function scanAll(prompt: boolean) {
  const dir = await makeClaudeDir();
  await addTranscript(dir, 'basic-session.jsonl', sid(1));
  await addTranscript(dir, 'multi-model.jsonl', sid(3));
  await addSubagentFixture(dir);
  const fs = spyFs();
  const sc = createClaudeScanner({ source: dir.source, deviceUid: () => DEVICE_UID, fs });
  const chunks = await collect(sc, new Map(), scanOptions({ settings: settings({ prompt }) }));
  return { chunks, fs, dir };
}

describe('prompt gating', () => {
  it('prompt OFF: the prompt extraction function is never called and no text is emitted', async () => {
    vi.mocked(extractPrompt).mockClear();
    const { chunks } = await scanAll(false);
    expect(extractPrompt).not.toHaveBeenCalled();
    expect(merged(chunks).messages).toEqual([]);
    const body = JSON.stringify(chunks);
    expect(body).not.toContain('Lorem ipsum');
  });

  it('prompt ON: extraction runs for user lines only', async () => {
    vi.mocked(extractPrompt).mockClear();
    const { chunks } = await scanAll(true);
    expect(extractPrompt).toHaveBeenCalled();
    for (const [line] of vi.mocked(extractPrompt).mock.calls) expect(line.type).toBe('user');
    expect(merged(chunks).messages.length).toBeGreaterThan(0);
  });

  it('never opens anything outside projects/ except the global config', async () => {
    const { fs, dir } = await scanAll(true);
    const opened = fs.open.mock.calls.map(([p]) => p);
    expect(opened.every((p) => p.startsWith(dir.source.projectsDir) && p.endsWith('.jsonl'))).toBe(
      true,
    );
    const read = fs.readFile.mock.calls.map(([p]) => p);
    expect(read.filter((p) => p === dir.source.globalConfigPath)).toHaveLength(1);
    expect(
      read
        .filter((p) => p !== dir.source.globalConfigPath)
        .every((p) => p.endsWith(path.join('.git', 'config'))),
    ).toBe(true);
  });
});

describe('platform boundary', () => {
  it('src/core/claude and src/core/detect never reference process.platform', () => {
    const root = path.resolve(import.meta.dirname, '../../../src/core');
    for (const sub of ['claude', 'detect']) {
      for (const f of readdirSync(path.join(root, sub))) {
        const text = readFileSync(path.join(root, sub, f), 'utf8');
        expect(text, f).not.toMatch(/process\.platform|os\.platform|from '\.\.\/\.\.\/platform/);
      }
    }
  });
});
