import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServiceManager } from '../types.js';
import type { RunCommand, SpawnDetached } from './exec.js';

export const UNIT_NAME = '6am-agent.service';
const AUTOSTART_NAME = '6am-agent.desktop';
const DESCRIPTION = '6AM Technologies Claude Code activity agent';

interface ExecOpts {
  nodePath: string;
  entryPath: string;
}

function assertPlain(value: string): void {
  if (/[\p{Cc}]/u.test(value)) {
    throw new Error(`Service path must not contain control characters: ${JSON.stringify(value)}`);
  }
}

/** systemd.service(5) quoting: C-style escapes in double quotes, `%` specifiers, `$` variables. */
function systemdArg(value: string): string {
  assertPlain(value);
  const escaped = value.replace(/[\\"]/g, '\\$&').replaceAll('%', '%%').replaceAll('$', '$$$$');
  return `"${escaped}"`;
}

/** Desktop Entry spec: quote the arg, escape `"`, `` ` ``, `$`, `\` inside it, then escape the
 * backslashes again for the string value, and double `%` so it is not a field code. */
function desktopArg(value: string): string {
  assertPlain(value);
  const quoted = `"${value.replace(/[\\"`$]/g, '\\$&')}"`;
  return quoted.replaceAll('\\', '\\\\').replaceAll('%', '%%');
}

export function renderUnit(o: ExecOpts): string {
  return [
    '[Unit]',
    `Description=${DESCRIPTION}`,
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${systemdArg(o.nodePath)} ${systemdArg(o.entryPath)} run`,
    'Restart=always',
    'RestartSec=30',
    'Nice=10',
    'IOSchedulingClass=idle',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

export function renderAutostartEntry(o: ExecOpts): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=6AM Agent',
    `Comment=${DESCRIPTION}`,
    `Exec=${desktopArg(o.nodePath)} ${desktopArg(o.entryPath)} run`,
    'Terminal=false',
    'NoDisplay=true',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;

  try {
    await writeFile(tmp, content, { mode: 0o644, flag: 'wx' });
    await chmod(tmp, 0o644);
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Per-user `systemd --user` unit. When the shell lacks the user bus (`su -`, `sudo -iu`, some SSH
 * setups) but systemd is booted, systemctl is retried with XDG_RUNTIME_DIR=/run/user/<uid>; if the
 * user manager still cannot be reached, install fails with a hint instead of silently falling
 * back. Only machines without systemd get an XDG autostart entry, which starts the agent at the
 * next desktop login; the agent is also started right away. `loginctl enable-linger` (needs
 * privileges) keeps the unit running without an open session; it is suggested, never run.
 */
export function createLinuxServiceManager(o: {
  run: RunCommand;
  configDir: string;
  spawnDetached: SpawnDetached;
  /** Exists iff systemd is PID 1 (sd_booted(3)). */
  systemdRunDir?: string;
  uid?: number;
}): ServiceManager {
  const unitPath = path.join(o.configDir, 'systemd', 'user', UNIT_NAME);
  const autostartPath = path.join(o.configDir, 'autostart', AUTOSTART_NAME);
  const systemdRunDir = o.systemdRunDir ?? '/run/systemd/system';
  const uid = o.uid ?? process.getuid?.() ?? 0;
  let env: Record<string, string> | undefined;

  const systemctl = (...args: string[]) =>
    o.run('systemctl', ['--user', ...args], env === undefined ? {} : { env });

  /** 'systemd' when a user manager answers, 'booted-unreachable', or 'none' (no systemd). */
  const detect = async (): Promise<'systemd' | 'booted-unreachable' | 'none'> => {
    env = undefined;

    if ((await systemctl('show', '--property=Version')).code === 0) {
      return 'systemd';
    }

    if (!(await exists(systemdRunDir))) {
      return 'none';
    }

    env = { XDG_RUNTIME_DIR: `/run/user/${uid}` };

    if ((await systemctl('show', '--property=Version')).code === 0) {
      return 'systemd';
    }

    env = undefined;
    return 'booted-unreachable';
  };

  const mustSystemctl = async (...args: string[]): Promise<void> => {
    const result = await systemctl(...args);

    if (result.code !== 0) {
      throw new Error(
        `systemctl --user ${args.join(' ')} failed: ${result.stderr.trim() || `exit ${result.code}`}`,
      );
    }
  };

  return {
    async install(opts) {
      const manager = await detect();

      if (manager === 'booted-unreachable') {
        throw new Error(
          'systemd is running but your user service manager is not reachable from this shell. ' +
            'Run this from a normal login session, or ask an admin to run ' +
            '`sudo loginctl enable-linger <user>` and try again.',
        );
      }

      if (manager === 'systemd') {
        await writeAtomic(unitPath, renderUnit(opts));
        await rm(autostartPath, { force: true });
        await mustSystemctl('daemon-reload');
        await mustSystemctl('enable', UNIT_NAME);
        // restart (not start) so a reinstall or upgrade runs the new binaries.
        await mustSystemctl('restart', UNIT_NAME);
        return;
      }

      await writeAtomic(autostartPath, renderAutostartEntry(opts));
      await o.spawnDetached(opts.nodePath, [opts.entryPath, 'run']);
    },

    async uninstall() {
      if ((await detect()) === 'systemd') {
        // Fails harmlessly when the unit was never loaded.
        await systemctl('disable', '--now', UNIT_NAME);
        await rm(unitPath, { force: true });
        await mustSystemctl('daemon-reload');
        await systemctl('reset-failed', UNIT_NAME);
      } else {
        await rm(unitPath, { force: true });
      }

      await rm(autostartPath, { force: true });
    },

    async status() {
      if (await exists(unitPath)) {
        if ((await detect()) !== 'systemd') {
          return 'unknown';
        }

        const result = await systemctl('is-active', UNIT_NAME);

        if (result.code === null) {
          return 'unknown';
        }

        return result.stdout.trim() === 'active' ? 'running' : 'installed';
      }

      return (await exists(autostartPath)) ? 'installed' : 'not-installed';
    },
  };
}
