/**
 * Per-user LaunchAgent in the `gui/<uid>` domain: loaded at every login of that user, never a
 * system LaunchDaemon. `KeepAlive.SuccessfulExit=false` restarts the agent after a crash but
 * not after a clean exit.
 */
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServiceManager } from '../types.js';
import { BIN, commandFailed, type ExecFn } from './exec.js';

export const LAUNCH_AGENT_LABEL = 'com.6amtech.agent';

/**
 * V8 flags for the long-running agent (H33): 8 MB young-generation semispaces instead of 16 MB
 * keep the initial sync's peak RSS under the 120 MB target. They must be on the node command line
 * (v8.setFlagsFromString is too late to resize the heap).
 */
export const AGENT_NODE_FLAGS = ['--max-semi-space-size=8'] as const;

const SERVICE_NOT_FOUND = 113;
const BOOTOUT_POLLS = 20;
const BOOTOUT_POLL_MS = 250;

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderLaunchAgentPlist(o: {
  nodePath: string;
  entryPath: string;
  logDir: string;
}): string {
  const out = path.join(o.logDir, 'launchd.out.log');
  const err = path.join(o.logDir, 'launchd.err.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LAUNCH_AGENT_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${xml(o.nodePath)}</string>
${AGENT_NODE_FLAGS.map((f) => `\t\t<string>${xml(f)}</string>\n`).join('')}		<string>${xml(o.entryPath)}</string>
		<string>run</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>ThrottleInterval</key>
	<integer>30</integer>
	<key>ProcessType</key>
	<string>Background</string>
	<key>LowPriorityIO</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${xml(out)}</string>
	<key>StandardErrorPath</key>
	<string>${xml(err)}</string>
</dict>
</plist>
`;
}

export interface LaunchAgentDeps {
  exec: ExecFn;
  uid: number;
  home: string;
  logDir: string;
  sleep: (ms: number) => Promise<void>;
}

export function createLaunchAgentService(deps: LaunchAgentDeps): ServiceManager {
  const domain = `gui/${deps.uid}`;
  const target = `${domain}/${LAUNCH_AGENT_LABEL}`;
  const plistPath = path.join(deps.home, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);

  const launchctl = (...args: string[]) => deps.exec(BIN.launchctl, args);

  async function isLoaded(): Promise<boolean> {
    return (await launchctl('print', target)).code === 0;
  }

  async function plistExists(): Promise<boolean> {
    try {
      return (await stat(plistPath)).isFile();
    } catch {
      return false;
    }
  }

  /** bootout returns before launchd has torn the job down; bootstrap fails (5) until it has. */
  async function bootout(): Promise<void> {
    await launchctl('bootout', target);
    for (let i = 0; i < BOOTOUT_POLLS; i += 1) {
      if (!(await isLoaded())) return;
      await deps.sleep(BOOTOUT_POLL_MS);
    }
    throw new Error(`launchctl bootout did not unload ${LAUNCH_AGENT_LABEL}`);
  }

  return {
    async install({ nodePath, entryPath }) {
      await mkdir(deps.logDir, { recursive: true, mode: 0o700 });
      await mkdir(path.dirname(plistPath), { recursive: true });
      const tmp = `${plistPath}.${process.pid}.tmp`;
      await writeFile(tmp, renderLaunchAgentPlist({ nodePath, entryPath, logDir: deps.logDir }), {
        mode: 0o644,
      });
      await rename(tmp, plistPath);

      if (await isLoaded()) await bootout();
      await launchctl('enable', target);
      const res = await launchctl('bootstrap', domain, plistPath);
      if (res.code !== 0) throw commandFailed('launchctl bootstrap', res.code);
    },

    async uninstall() {
      if (await isLoaded()) await bootout();
      await rm(plistPath, { force: true });
    },

    async status() {
      const res = await launchctl('print', target);
      if (res.code === 0) return /^\s*state = running$/m.test(res.stdout) ? 'running' : 'installed';
      if (res.code === SERVICE_NOT_FOUND)
        return (await plistExists()) ? 'installed' : 'not-installed';
      return 'unknown';
    },
  };
}
