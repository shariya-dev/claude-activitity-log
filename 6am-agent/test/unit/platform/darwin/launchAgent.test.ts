import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLaunchAgentService,
  renderLaunchAgentPlist,
} from '../../../../src/platform/darwin/launchAgent.js';
import { fakeExec, type ExecCall } from './fakeExec.js';

const fixture = (name: string) => path.join(import.meta.dirname, 'fixtures', name);

const NODE = '/Library/Application Support/6amAgent/1.0.0/runtime/node';
const ENTRY = '/Library/Application Support/6amAgent/1.0.0/app/agent.cjs';

const PRINT_RUNNING = `gui/501/com.6amtech.agent = {
	active count = 1
	path = /Users/dev/Library/LaunchAgents/com.6amtech.agent.plist
	type = LaunchAgent
	state = running

	program = /Library/Application Support/6amAgent/1.0.0/runtime/node
}
`;

const NOT_FOUND = { code: 113, stderr: 'Could not find service "com.6amtech.agent" in domain' };

describe('renderLaunchAgentPlist', () => {
  it('matches the golden plist (and escapes XML)', async () => {
    const xml = renderLaunchAgentPlist({
      nodePath: NODE,
      entryPath: ENTRY,
      logDir: '/Users/dev & co/Library/Logs/6amAgent',
    });
    expect(xml).toBe(await readFile(fixture('com.6amtech.agent.plist'), 'utf8'));
  });
});

describe('LaunchAgent service', () => {
  let home: string;
  let logDir: string;
  let plistPath: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'cam-la-'));
    logDir = path.join(home, 'Library', 'Logs', '6amAgent');
    plistPath = path.join(home, 'Library', 'LaunchAgents', 'com.6amtech.agent.plist');
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const service = (exec: ReturnType<typeof fakeExec>) =>
    createLaunchAgentService({ exec, uid: 501, home, logDir, sleep: async () => undefined });

  const launchctl = (calls: ExecCall[]) => {
    for (const c of calls) expect(c.file).toBe('/bin/launchctl');
    return calls.map((c) => c.args.join(' '));
  };

  it('install writes the per-user plist and bootstraps it into gui/<uid>', async () => {
    const exec = fakeExec((c) => (c.args[0] === 'print' ? NOT_FOUND : undefined));
    await service(exec).install({ nodePath: NODE, entryPath: ENTRY });

    const written = await readFile(plistPath, 'utf8');
    expect(written).toBe(renderLaunchAgentPlist({ nodePath: NODE, entryPath: ENTRY, logDir }));
    expect((await stat(plistPath)).mode & 0o777).toBe(0o644);
    expect((await stat(logDir)).isDirectory()).toBe(true);
    expect(launchctl(exec.calls)).toEqual([
      'print gui/501/com.6amtech.agent',
      'enable gui/501/com.6amtech.agent',
      `bootstrap gui/501 ${plistPath}`,
    ]);
  });

  it('install boots out a loaded instance first and waits until it is gone', async () => {
    let prints = 0;
    const exec = fakeExec((c) => {
      if (c.args[0] !== 'print') return undefined;
      prints += 1;
      return prints <= 2 ? { stdout: PRINT_RUNNING } : NOT_FOUND;
    });
    await service(exec).install({ nodePath: NODE, entryPath: ENTRY });
    expect(launchctl(exec.calls)).toEqual([
      'print gui/501/com.6amtech.agent',
      'bootout gui/501/com.6amtech.agent',
      'print gui/501/com.6amtech.agent',
      'print gui/501/com.6amtech.agent',
      'enable gui/501/com.6amtech.agent',
      `bootstrap gui/501 ${plistPath}`,
    ]);
  });

  it('install fails with the launchctl exit code when bootstrap fails', async () => {
    const exec = fakeExec((c) => {
      if (c.args[0] === 'print') return NOT_FOUND;
      if (c.args[0] === 'bootstrap') return { code: 5, stderr: 'Bootstrap failed: 5' };
      return undefined;
    });
    await expect(service(exec).install({ nodePath: NODE, entryPath: ENTRY })).rejects.toThrow(
      /bootstrap.*exit 5/,
    );
  });

  it('uninstall boots out the service and removes the plist', async () => {
    await mkdir(path.dirname(plistPath), { recursive: true });
    await writeFile(plistPath, 'x');
    const exec = fakeExec((c) => (c.args[0] === 'print' ? { stdout: PRINT_RUNNING } : undefined));
    await service(exec).uninstall();
    expect(launchctl(exec.calls)).toEqual([
      'print gui/501/com.6amtech.agent',
      'bootout gui/501/com.6amtech.agent',
    ]);
    await expect(stat(plistPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uninstall is a no-op when nothing is installed', async () => {
    const exec = fakeExec(() => NOT_FOUND);
    await expect(service(exec).uninstall()).resolves.toBeUndefined();
    expect(launchctl(exec.calls)).toEqual(['print gui/501/com.6amtech.agent']);
  });

  it('status reports running, installed, not-installed and unknown', async () => {
    expect(await service(fakeExec(() => NOT_FOUND)).status()).toBe('not-installed');

    await mkdir(path.dirname(plistPath), { recursive: true });
    await writeFile(plistPath, 'x');
    expect(await service(fakeExec(() => NOT_FOUND)).status()).toBe('installed');
    expect(await service(fakeExec(() => ({ stdout: PRINT_RUNNING }))).status()).toBe('running');
    expect(
      await service(
        fakeExec(() => ({ stdout: PRINT_RUNNING.replace('state = running', 'state = waiting') })),
      ).status(),
    ).toBe('installed');
    expect(await service(fakeExec(() => ({ code: 1, stderr: '?' }))).status()).toBe('unknown');
  });
});
