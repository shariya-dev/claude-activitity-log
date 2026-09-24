import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeFs, type FsLike } from '../../../src/core/claude/fs.js';
import { listTranscriptFiles } from '../../../src/core/claude/transcriptFiles.js';

async function tree(files: string[]): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'h09-files-'));
  for (const f of files) {
    await mkdir(path.dirname(path.join(root, f)), { recursive: true });
    await writeFile(path.join(root, f), '');
  }
  return root;
}

describe('listTranscriptFiles', () => {
  it('lists main and subagent transcripts only, in a stable order', async () => {
    const root = await tree([
      'b-proj/s2.jsonl',
      'b-proj/s1.jsonl',
      'b-proj/s1/subagents/agent-b.jsonl',
      'b-proj/s1/subagents/agent-a.jsonl',
      'b-proj/s1/subagents/agent-a.meta.json',
      'b-proj/s1/tool-results/x.txt',
      'b-proj/s1/tool-results/y.jsonl',
      'b-proj/memory/MEMORY.md',
      'b-proj/notes.txt',
      'a-proj/s3.jsonl',
      'stray.jsonl',
    ]);
    const files = await listTranscriptFiles(root, nodeFs);
    expect(files.map((f) => [path.relative(root, f.path), f.kind])).toEqual([
      [path.join('a-proj', 's3.jsonl'), 'main'],
      [path.join('b-proj', 's1.jsonl'), 'main'],
      [path.join('b-proj', 's2.jsonl'), 'main'],
      [path.join('b-proj', 's1', 'subagents', 'agent-a.jsonl'), 'subagent'],
      [path.join('b-proj', 's1', 'subagents', 'agent-b.jsonl'), 'subagent'],
    ]);
  });

  it('returns nothing for an empty projects dir', async () => {
    expect(await listTranscriptFiles(await tree([]), nodeFs)).toEqual([]);
  });

  it('throws when the projects dir itself is unreadable but skips unreadable project dirs', async () => {
    const root = await tree(['ok/s.jsonl', 'locked/s.jsonl']);
    const fs: FsLike = {
      ...nodeFs,
      readdir: async (p, o) => {
        if (p === path.join(root, 'locked')) throw new Error('EACCES');
        return nodeFs.readdir(p, o);
      },
    };
    expect(
      (await listTranscriptFiles(root, fs)).map((f) => path.basename(path.dirname(f.path))),
    ).toEqual(['ok']);
    await expect(listTranscriptFiles(path.join(root, 'missing'), nodeFs)).rejects.toThrow();
  });
});
