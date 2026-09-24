import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverClaudeData } from '../../../src/core/claude/discovery.js';
import type { DirEntryLike, FsLike, StatLike } from '../../../src/core/claude/fs.js';

describe('discoverClaudeData (real fs)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'cam-disc-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('prefers the first valid candidate and finds the global config', async () => {
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    await mkdir(path.join(a, 'projects'), { recursive: true });
    await mkdir(path.join(b, 'projects', 'p1'), { recursive: true });
    const cfg = path.join(root, '.claude.json');
    await writeFile(cfg, '{}');
    const res = await discoverClaudeData([a, b], [path.join(root, 'missing.json'), cfg]);
    expect(res).toEqual({
      dataDir: a,
      projectsDir: path.join(a, 'projects'),
      globalConfigPath: cfg,
    });
  });

  it('skips a candidate without projects and one where projects is a file', async () => {
    const noProjects = path.join(root, 'none');
    const fileProjects = path.join(root, 'file');
    const good = path.join(root, 'good');
    await mkdir(noProjects);
    await mkdir(fileProjects);
    await writeFile(path.join(fileProjects, 'projects'), 'x');
    await mkdir(path.join(good, 'projects'), { recursive: true });
    const res = await discoverClaudeData(
      ['', path.join(root, 'absent'), noProjects, fileProjects, good],
      [],
    );
    expect(res?.dataDir).toBe(good);
    expect(res?.globalConfigPath).toBeNull();
  });

  it('ignores a global config candidate that is a directory', async () => {
    const d = path.join(root, 'd');
    await mkdir(path.join(d, 'projects'), { recursive: true });
    const dirCfg = path.join(root, 'cfgdir');
    await mkdir(dirCfg);
    const res = await discoverClaudeData([d], ['', dirCfg]);
    expect(res?.globalConfigPath).toBeNull();
  });

  it('returns null when nothing is valid', async () => {
    await expect(discoverClaudeData([path.join(root, 'x')], [])).resolves.toBeNull();
    await expect(discoverClaudeData([], [])).resolves.toBeNull();
  });
});

type Node = 'dir' | 'file' | 'unreadable-dir';

function fakeFs(tree: Record<string, Node>) {
  const stat = vi.fn(async (p: string): Promise<StatLike> => {
    const n = tree[p];
    if (n === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const isDir = n !== 'file';
    return {
      dev: 1,
      ino: 1,
      size: 0,
      mtimeMs: 0,
      isFile: () => !isDir,
      isDirectory: () => isDir,
    };
  });
  const readdir = vi.fn(async (p: string): Promise<DirEntryLike[]> => {
    if (tree[p] === 'unreadable-dir') {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    }
    if (tree[p] !== 'dir') throw new Error('ENOTDIR');
    return [];
  });
  const readFile = vi.fn(async (): Promise<string> => '');
  const open = vi.fn(async () => {
    throw new Error('not used');
  });
  const fs: FsLike = { stat, readdir, readFile, open };
  return { fs, stat, readdir, readFile, open };
}

describe('discoverClaudeData (fake fs)', () => {
  const j = path.join;

  it('treats an unreadable projects dir as invalid and moves on', async () => {
    const f = fakeFs({
      [j('/a', 'projects')]: 'unreadable-dir',
      [j('/b', 'projects')]: 'dir',
      '/home/.claude.json': 'file',
    });
    const res = await discoverClaudeData(['/a', '/b'], ['/home/.claude.json'], f.fs);
    expect(res).toEqual({
      dataDir: '/b',
      projectsDir: j('/b', 'projects'),
      globalConfigPath: '/home/.claude.json',
    });
  });

  it('never reads the global config or opens files', async () => {
    const f = fakeFs({ [j('/a', 'projects')]: 'dir', '/cfg.json': 'file' });
    await discoverClaudeData(['/a'], ['/cfg.json'], f.fs);
    expect(f.readFile).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  });

  it('empty projects dir is valid', async () => {
    const f = fakeFs({ [j('/a', 'projects')]: 'dir' });
    const res = await discoverClaudeData(['/a'], ['/missing'], f.fs);
    expect(res?.dataDir).toBe('/a');
    expect(res?.globalConfigPath).toBeNull();
  });

  it('projects as a file is invalid', async () => {
    const f = fakeFs({ [j('/a', 'projects')]: 'file' });
    await expect(discoverClaudeData(['/a'], [], f.fs)).resolves.toBeNull();
    expect(f.readdir).not.toHaveBeenCalled();
  });

  it('all invalid -> null', async () => {
    const f = fakeFs({ [j('/b', 'projects')]: 'unreadable-dir' });
    await expect(discoverClaudeData(['', '/a', '/b'], ['/cfg'], f.fs)).resolves.toBeNull();
    expect(f.stat).not.toHaveBeenCalledWith(j('', 'projects'));
  });
});
