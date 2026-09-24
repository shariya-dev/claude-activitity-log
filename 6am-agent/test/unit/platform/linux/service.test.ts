import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLinuxServiceManager,
  renderAutostartEntry,
  renderUnit,
} from '../../../../src/platform/linux/service.js';
import { fakeRun, type RecordedCall } from './fakeRun.js';

const golden = (name: string): string =>
  readFileSync(path.join(import.meta.dirname, 'golden', name), 'utf8');

const opts = { nodePath: '/opt/6am-agent/runtime/node', entryPath: '/opt/6am-agent/app/agent.cjs' };

const systemctl = (call: RecordedCall): string =>
  call.cmd === 'systemctl' ? call.args.join(' ') : `${call.cmd} ${call.args.join(' ')}`;

describe('unit rendering', () => {
  it('matches the golden systemd user unit', () => {
    expect(renderUnit(opts)).toBe(golden('6am-agent.service'));
  });

  it('matches the golden XDG autostart entry', () => {
    expect(renderAutostartEntry(opts)).toBe(golden('6am-agent.desktop'));
  });

  it('quotes paths with spaces and escapes systemd specifiers and variables', () => {
    const unit = renderUnit({
      nodePath: '/home/a b/.local/share/6am-agent/runtime/node',
      entryPath: '/home/a b/100%/$HOME/"q"\\x.cjs',
    });

    expect(unit).toContain(
      'ExecStart="/home/a b/.local/share/6am-agent/runtime/node" "/home/a b/100%%/$$HOME/\\"q\\"\\\\x.cjs" run\n',
    );
  });

  it('escapes desktop-entry Exec reserved characters and field codes', () => {
    const entry = renderAutostartEntry({ nodePath: '/a b/node', entryPath: '/x/100%/$y`"z.cjs' });

    expect(entry).toContain('Exec="/a b/node" "/x/100%%/\\\\$y\\\\`\\\\"z.cjs" run\n');
  });

  it('rejects paths containing newlines', () => {
    expect(() => renderUnit({ nodePath: '/a\n[Service]', entryPath: '/b' })).toThrow(
      'must not contain control characters',
    );
  });
});

describe('systemd user service manager', () => {
  let root: string;
  let configDir: string;
  let unitPath: string;
  let autostartPath: string;
  let systemdRunDir: string;
  let spawned: { cmd: string; args: string[] }[];

  const spawnDetached = async (cmd: string, args: string[]): Promise<boolean> => {
    spawned.push({ cmd, args });
    return true;
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'linux-svc-'));
    configDir = path.join(root, '.config');
    unitPath = path.join(configDir, 'systemd', 'user', '6am-agent.service');
    autostartPath = path.join(configDir, 'autostart', '6am-agent.desktop');
    systemdRunDir = path.join(root, 'run-systemd-system');
    spawned = [];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes the unit (0644), reloads, enables and restarts it', async () => {
    const { run, calls } = fakeRun();
    const manager = createLinuxServiceManager({
      run,
      configDir,
      spawnDetached,
      systemdRunDir,
      uid: 1000,
    });

    await manager.install(opts);

    expect(readFileSync(unitPath, 'utf8')).toBe(golden('6am-agent.service'));
    expect(statSync(unitPath).mode & 0o777).toBe(0o644);
    expect(calls.map(systemctl)).toEqual([
      '--user show --property=Version',
      '--user daemon-reload',
      '--user enable 6am-agent.service',
      '--user restart 6am-agent.service',
    ]);
    expect(spawned).toEqual([]);
  });

  it('removes a leftover autostart entry when systemd is available', async () => {
    mkdirSync(path.dirname(autostartPath), { recursive: true });
    writeFileSync(autostartPath, 'old');
    const { run } = fakeRun();

    await createLinuxServiceManager({
      run,
      configDir,
      spawnDetached,
      systemdRunDir,
      uid: 1000,
    }).install(opts);

    expect(existsSync(autostartPath)).toBe(false);
  });

  it('throws with systemctl stderr when enabling fails', async () => {
    const { run } = fakeRun((call) =>
      call.args[1] === 'enable' ? { code: 1, stderr: 'Failed to enable unit' } : undefined,
    );

    await expect(
      createLinuxServiceManager({
        run,
        configDir,
        spawnDetached,
        systemdRunDir,
        uid: 1000,
      }).install(opts),
    ).rejects.toThrow('Failed to enable unit');
  });

  it('reports running only when systemctl says active', async () => {
    const answers: Record<string, string> = {};
    const { run } = fakeRun((call) =>
      call.args[1] === 'is-active' ? { stdout: `${answers.state}\n`, code: 3 } : undefined,
    );
    const manager = createLinuxServiceManager({
      run,
      configDir,
      spawnDetached,
      systemdRunDir,
      uid: 1000,
    });

    await expect(manager.status()).resolves.toBe('not-installed');

    await manager.install(opts);
    answers.state = 'active';
    await expect(manager.status()).resolves.toBe('running');
    answers.state = 'activating';
    await expect(manager.status()).resolves.toBe('installed');
    answers.state = 'failed';
    await expect(manager.status()).resolves.toBe('installed');
  });

  it('reports unknown when is-active cannot run', async () => {
    const { run } = fakeRun((call) =>
      call.args[1] === 'is-active' ? { code: null, stderr: 'spawn timeout' } : undefined,
    );
    const manager = createLinuxServiceManager({
      run,
      configDir,
      spawnDetached,
      systemdRunDir,
      uid: 1000,
    });
    await manager.install(opts);

    await expect(manager.status()).resolves.toBe('unknown');
  });

  it('disables, stops and removes the unit on uninstall, tolerating an unloaded unit', async () => {
    const { run, calls } = fakeRun((call) =>
      call.args[1] === 'disable' ? { code: 1, stderr: 'Unit file does not exist' } : undefined,
    );
    const manager = createLinuxServiceManager({
      run,
      configDir,
      spawnDetached,
      systemdRunDir,
      uid: 1000,
    });
    await manager.install(opts);
    calls.length = 0;

    await manager.uninstall();

    expect(existsSync(unitPath)).toBe(false);
    expect(calls.map(systemctl)).toEqual([
      '--user show --property=Version',
      '--user disable --now 6am-agent.service',
      '--user daemon-reload',
      '--user reset-failed 6am-agent.service',
    ]);
  });

  describe('when systemd is booted but the user bus is not in the environment', () => {
    const busless = (call: RecordedCall) =>
      call.cmd === 'systemctl' && call.env === undefined
        ? { code: 1, stderr: 'Failed to connect to bus: $DBUS_SESSION_BUS_ADDRESS not set' }
        : undefined;

    it('retries every systemctl call with XDG_RUNTIME_DIR=/run/user/<uid>', async () => {
      mkdirSync(systemdRunDir);
      const { run, calls } = fakeRun(busless);

      await createLinuxServiceManager({
        run,
        configDir,
        spawnDetached,
        systemdRunDir,
        uid: 1000,
      }).install(opts);

      expect(existsSync(unitPath)).toBe(true);
      expect(existsSync(autostartPath)).toBe(false);
      expect(calls.slice(1).map((c) => [systemctl(c), c.env])).toEqual(
        [
          '--user show --property=Version',
          '--user daemon-reload',
          '--user enable 6am-agent.service',
          '--user restart 6am-agent.service',
        ].map((c) => [c, { XDG_RUNTIME_DIR: '/run/user/1000' }]),
      );
    });

    it('fails loudly instead of writing an autostart entry that would never run', async () => {
      mkdirSync(systemdRunDir);
      const { run } = fakeRun((call) =>
        call.cmd === 'systemctl' ? { code: 1, stderr: 'Failed to connect to bus' } : undefined,
      );

      await expect(
        createLinuxServiceManager({
          run,
          configDir,
          spawnDetached,
          systemdRunDir,
          uid: 1000,
        }).install(opts),
      ).rejects.toThrow('loginctl enable-linger');
      expect(existsSync(autostartPath)).toBe(false);
      expect(spawned).toEqual([]);
    });
  });

  describe('without a systemd user manager', () => {
    const noSystemd = (call: RecordedCall) =>
      call.cmd === 'systemctl'
        ? { code: 1, stderr: 'Failed to connect to bus: No medium found' }
        : undefined;

    it('falls back to an XDG autostart entry, starts the agent and reports installed', async () => {
      const { run, calls } = fakeRun(noSystemd);
      const manager = createLinuxServiceManager({
        run,
        configDir,
        spawnDetached,
        systemdRunDir,
        uid: 1000,
      });

      await manager.install(opts);

      expect(readFileSync(autostartPath, 'utf8')).toBe(golden('6am-agent.desktop'));
      expect(existsSync(unitPath)).toBe(false);
      expect(spawned).toEqual([{ cmd: opts.nodePath, args: [opts.entryPath, 'run'] }]);
      expect(calls.map(systemctl)).toEqual(['--user show --property=Version']);
      await expect(manager.status()).resolves.toBe('installed');
    });

    it('treats a missing systemctl binary the same way', async () => {
      const { run } = fakeRun((call) =>
        call.cmd === 'systemctl' ? { code: null, stderr: 'spawn systemctl ENOENT' } : undefined,
      );
      const manager = createLinuxServiceManager({
        run,
        configDir,
        spawnDetached,
        systemdRunDir,
        uid: 1000,
      });

      await manager.install(opts);

      expect(existsSync(autostartPath)).toBe(true);
    });

    it('removes the autostart entry on uninstall', async () => {
      const { run } = fakeRun(noSystemd);
      const manager = createLinuxServiceManager({
        run,
        configDir,
        spawnDetached,
        systemdRunDir,
        uid: 1000,
      });
      await manager.install(opts);

      await manager.uninstall();

      expect(existsSync(autostartPath)).toBe(false);
      await expect(manager.status()).resolves.toBe('not-installed');
    });
  });
});
