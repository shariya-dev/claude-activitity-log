import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdapter } from '../../../../src/platform/darwin/index.js';
import { checkPermissions } from '../../../../src/platform/darwin/permissions.js';
import { fakeExec } from './fakeExec.js';

describe('darwin adapter', () => {
  const base = {
    env: { CLAUDE_CONFIG_DIR: '/opt/cfg' },
    home: '/Users/dev',
    uid: 501,
    keychainAvailable: () => true,
  };

  it('wires the macOS paths and backends', () => {
    const adapter = createAdapter({ ...base, exec: fakeExec() });
    expect(adapter.id).toBe('macos');
    expect(adapter.claudeDataCandidates()[0]).toBe('/opt/cfg');
    expect(adapter.claudeGlobalConfigCandidates()).toEqual([
      '/opt/cfg/.claude.json',
      '/Users/dev/.claude.json',
    ]);
    expect(adapter.appDataDir()).toBe('/Users/dev/Library/Application Support/6amAgent');
    expect(adapter.logDir()).toBe('/Users/dev/Library/Logs/6amAgent');
    expect(adapter.credentials.backend).toBe('keychain');
  });

  it('opens http(s) URLs with /usr/bin/open', async () => {
    const exec = fakeExec();
    await createAdapter({ ...base, exec }).openUrl('http://127.0.0.1:53111/pair?t=abc');
    expect(exec.calls).toEqual([
      { file: '/usr/bin/open', args: ['http://127.0.0.1:53111/pair?t=abc'], input: undefined },
    ]);
  });

  it('refuses to open anything that is not an http(s) URL', async () => {
    const exec = fakeExec();
    const adapter = createAdapter({ ...base, exec });
    await expect(adapter.openUrl('file:///Applications/Calculator.app')).rejects.toThrow(/http/);
    await expect(adapter.openUrl('-a Terminal')).rejects.toThrow(/http/);
    expect(exec.calls).toHaveLength(0);
  });

  it('reports a failing open', async () => {
    const exec = fakeExec(() => ({ code: 1 }));
    await expect(createAdapter({ ...base, exec }).openUrl('https://x.test')).rejects.toThrow(
      /open.*exit 1/,
    );
  });
});

describe('darwin checkPermissions', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'cam-perm-'));
  });

  afterEach(async () => {
    await chmod(path.join(root, 'locked'), 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  it('reports readable dirs and files', async () => {
    await mkdir(path.join(root, 'claude', 'projects'), { recursive: true });
    await writeFile(path.join(root, 'claude.json'), '{}');
    expect(
      await checkPermissions([path.join(root, 'claude'), path.join(root, 'claude.json')], root),
    ).toEqual([
      { path: path.join(root, 'claude'), readable: true },
      { path: path.join(root, 'claude.json'), readable: true },
    ]);
  });

  it('explains a missing path', async () => {
    const [r] = await checkPermissions([path.join(root, 'absent')], root);
    expect(r).toMatchObject({ readable: false, hint: expect.stringMatching(/does not exist/) });
  });

  it.skipIf(process.getuid?.() === 0)('explains an unreadable dir', async () => {
    const locked = path.join(root, 'locked');
    await mkdir(locked);
    await chmod(locked, 0o000);
    const [r] = await checkPermissions([locked], root);
    expect(r).toMatchObject({ readable: false, hint: expect.stringMatching(/permission/i) });
  });

  it('points to Full Disk Access when macOS privacy protection (EPERM) blocks a read', async () => {
    const eperm = Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    const [r] = await checkPermissions(['/Users/dev/Documents/proj/.git/config'], '/Users/dev', {
      stat: async () => {
        throw eperm;
      },
    });
    expect(r).toMatchObject({ readable: false, hint: expect.stringMatching(/Full Disk Access/) });
  });
});
