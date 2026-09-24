import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsLike } from '../../../src/core/claude/fs.js';
import { readOriginRemote } from '../../../src/core/claude/gitRemote.js';

function fakeFs(readFile: FsLike['readFile']): FsLike {
  const unused = () => Promise.reject(new Error('not used'));
  return { readdir: unused, stat: unused, open: unused, readFile };
}

describe('readOriginRemote (real fs)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cam-git-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the raw origin url', async () => {
    await mkdir(path.join(dir, '.git'));
    await writeFile(
      path.join(dir, '.git', 'config'),
      [
        '[core]',
        '\trepositoryformatversion = 0',
        '[remote "upstream"]',
        '\turl = https://github.com/other/repo.git',
        '[remote "origin"]',
        '\turl = git@github.com:example/acme-api.git',
        '\tfetch = +refs/heads/*:refs/remotes/origin/*',
        '[branch "main"]',
        '\tremote = origin',
        '',
      ].join('\n'),
    );
    await expect(readOriginRemote(dir)).resolves.toBe('git@github.com:example/acme-api.git');
  });

  it('returns null when there is no .git', async () => {
    await expect(readOriginRemote(dir)).resolves.toBeNull();
  });

  it('returns null when .git is a file (worktree/submodule)', async () => {
    await writeFile(path.join(dir, '.git'), 'gitdir: /elsewhere\n');
    await expect(readOriginRemote(dir)).resolves.toBeNull();
  });
});

describe('readOriginRemote (fake fs)', () => {
  it('reads only <cwd>/.git/config', async () => {
    const readFile = vi.fn<FsLike['readFile']>().mockResolvedValue('');
    await readOriginRemote('/home/dev/proj', fakeFs(readFile));
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith(path.join('/home/dev/proj', '.git', 'config'), 'utf8');
  });

  it('tolerates whitespace, comments and case', async () => {
    const config = [
      '# top comment',
      '; another',
      '  [ remote  "origin" ]  ',
      '    ; url = commented-out',
      '    # url = also-commented',
      '    fetch=+refs/heads/*:refs/remotes/origin/*',
      '    !!! not a key',
      '    URL   =   https://user@Host.com/Org/Repo.git   ',
    ].join('\r\n');
    await expect(
      readOriginRemote(
        '/p',
        fakeFs(async () => config),
      ),
    ).resolves.toBe('https://user@Host.com/Org/Repo.git');
  });

  it('strips a trailing inline comment and surrounding quotes', async () => {
    const config = '[remote "origin"]\n\turl = "https://host/org/repo.git" ; note\n';
    await expect(
      readOriginRemote(
        '/p',
        fakeFs(async () => config),
      ),
    ).resolves.toBe('https://host/org/repo.git');
  });

  it('ignores url keys outside the origin section', async () => {
    const config = [
      'url = https://top/level',
      '[remote "upstream"]',
      'url = https://host/upstream',
      '[remote "originx"]',
      'url = https://host/originx',
      '[remote]',
      'url = https://host/bare',
    ].join('\n');
    await expect(
      readOriginRemote(
        '/p',
        fakeFs(async () => config),
      ),
    ).resolves.toBeNull();
  });

  it('returns null when the origin section has no url', async () => {
    const config = '[remote "origin"]\n\tfetch = x\n[remote "other"]\n\turl = https://h/o/r\n';
    await expect(
      readOriginRemote(
        '/p',
        fakeFs(async () => config),
      ),
    ).resolves.toBeNull();
  });

  it('returns null for a valueless url key', async () => {
    const config = '[remote "origin"]\n\turl\n';
    await expect(
      readOriginRemote(
        '/p',
        fakeFs(async () => config),
      ),
    ).resolves.toBeNull();
  });

  it('returns null for an empty url value', async () => {
    const config = '[remote "origin"]\n\turl =\n';
    await expect(
      readOriginRemote(
        '/p',
        fakeFs(async () => config),
      ),
    ).resolves.toBeNull();
  });

  it('returns null and does not retry on read errors', async () => {
    const readFile = vi
      .fn<FsLike['readFile']>()
      .mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    await expect(readOriginRemote('/p', fakeFs(readFile))).resolves.toBeNull();
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
