import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { selectAdapter } from '../../../../src/platform/index.js';
import { createAdapter } from '../../../../src/platform/linux/index.js';
import { fakeRun } from './fakeRun.js';

describe('linux adapter', () => {
  let root: string;
  let out: string[];
  let spawned: { cmd: string; args: string[] }[];
  let spawnResult: boolean;

  const make = (env: NodeJS.ProcessEnv) =>
    createAdapter({
      env,
      homedir: path.join(root, 'home'),
      run: fakeRun().run,
      spawnDetached: async (cmd, args) => {
        spawned.push({ cmd, args });
        return spawnResult;
      },
      write: (text) => out.push(text),
      probeSecretService: () => false,
      osReleasePaths: [path.join(root, 'os-release')],
      machineIdPaths: [path.join(root, 'machine-id')],
      hostname: () => 'ws-01',
      arch: () => 'x64',
      kernelRelease: () => '6.8.0',
    });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'linux-adapter-'));
    out = [];
    spawned = [];
    spawnResult = true;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is what selectAdapter returns for linux, without probing anything', () => {
    expect(selectAdapter('linux').id).toBe('linux');
  });

  it('exposes linux paths with logs under the state dir', () => {
    const adapter = make({});

    expect(adapter.id).toBe('linux');
    expect(adapter.appDataDir()).toBe(path.join(root, 'home', '.local', 'state', '6am-agent'));
    expect(adapter.logDir()).toBe(path.join(root, 'home', '.local', 'state', '6am-agent', 'logs'));
    expect(adapter.claudeDataCandidates()[0]).toBe(path.join(root, 'home', '.claude'));
    expect(adapter.claudeGlobalConfigCandidates()).toEqual([
      path.join(root, 'home', '.claude.json'),
    ]);
  });

  it('keeps file credentials in $XDG_STATE_HOME/6am-agent/cred', async () => {
    const adapter = make({ XDG_STATE_HOME: path.join(root, 'state') });

    await adapter.credentials.set('device_token', 'x');

    expect(adapter.credentials.backend).toBe('file-0600');
    await expect(
      import('node:fs').then((fs) =>
        fs.readFileSync(path.join(root, 'state', '6am-agent', 'cred', 'device_token'), 'utf8'),
      ),
    ).resolves.toBe('x');
  });

  it('builds device info from os-release and machine-id', async () => {
    writeFileSync(path.join(root, 'os-release'), 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\n');
    writeFileSync(path.join(root, 'machine-id'), 'abc\n');

    await expect(make({}).deviceInfo()).resolves.toEqual({
      hostname: 'ws-01',
      platform: 'linux',
      platformVersion: 'Ubuntu 24.04.1 LTS',
      architecture: 'x64',
      machineFingerprint: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
  });

  it('opens URLs with xdg-open when a display is available', async () => {
    await make({ DISPLAY: ':0' }).openUrl('http://127.0.0.1:5000/pair?t=1');

    expect(spawned).toEqual([{ cmd: 'xdg-open', args: ['http://127.0.0.1:5000/pair?t=1'] }]);
    expect(out).toEqual([]);
  });

  it('prints the URL when headless or when xdg-open cannot start', async () => {
    await make({}).openUrl('http://127.0.0.1:5000/a');
    spawnResult = false;
    await make({ WAYLAND_DISPLAY: 'wayland-0' }).openUrl('http://127.0.0.1:5000/b');

    expect(spawned).toEqual([{ cmd: 'xdg-open', args: ['http://127.0.0.1:5000/b'] }]);
    expect(out).toEqual([
      'Open this URL in a browser: http://127.0.0.1:5000/a\n',
      'Open this URL in a browser: http://127.0.0.1:5000/b\n',
    ]);
  });

  it('checks read permissions with hints', async () => {
    const readable = path.join(root, 'readable');
    const locked = path.join(root, 'locked');
    mkdirSync(readable);
    mkdirSync(locked);
    chmodSync(locked, 0o000);

    let result;
    try {
      result = await make({}).checkPermissions([readable, locked, path.join(root, 'nope')]);
    } finally {
      chmodSync(locked, 0o700);
    }

    expect(result[0]).toEqual({ path: readable, readable: true });
    expect(result[2]).toEqual({
      path: path.join(root, 'nope'),
      readable: false,
      hint: 'does not exist',
    });
    if (process.getuid?.() !== 0) {
      expect(result[1]).toMatchObject({ path: locked, readable: false });
      expect(result[1]?.hint).toContain('not readable by the agent user');
    }
  });
});
