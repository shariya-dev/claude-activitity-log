import path from 'node:path';
import type { ServiceManager } from '../types.js';
import {
  type CommandRunner,
  type RunResult,
  firstErrorLine,
  system32,
  systemRoot,
} from './exec.js';
import type { Win32FileOps } from './fileOps.js';
import { currentUserName } from './paths.js';
import { PS_PRELUDE, powershellErrorText, runPowerShell } from './powershell.js';
import { assertExecutablePath, buildTaskXml, encodeTaskXml } from './taskXml.js';

export const TASK_NAME = '6amAgent';

export interface ScheduledTaskDeps {
  run: CommandRunner;
  env: NodeJS.ProcessEnv;
  files: Win32FileOps;
  appDataDir: string;
  /** The running agent process: `uninstall-service` runs from the installed node.exe + bundle. */
  self: { pid: number; execPath: string; entryPath?: string };
}

const SID_SCRIPT = `${PS_PRELUDE} [Console]::Out.Write([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)`;

const STATE_SCRIPT = `${PS_PRELUDE} [Console]::Out.Write([string](Get-ScheduledTask -TaskPath '\\' -TaskName '${TASK_NAME}').State)`;

/**
 * Stops agent processes left behind by `/End`, which terminates only the task's action process
 * (conhost), not node running inside it. Matches node.exe at this install's path whose command
 * line contains this bundle, so a developer's other Node processes are never touched. Input is
 * base64 UTF-8 JSON on stdin, so non-ASCII paths survive the console code page.
 */
const STOP_AGENTS_SCRIPT = [
  PS_PRELUDE,
  '$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())) | ConvertFrom-Json;',
  '$entry = ([string]$t.entry).ToLowerInvariant();',
  '$n = 0;',
  'Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" | Where-Object {',
  '$_.ProcessId -ne $t.exclude -and $_.ExecutablePath -eq $t.exe -and',
  '$_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($entry)',
  '} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ };',
  '[Console]::Out.Write($n)',
].join(' ');

const ENGLISH_STATES = new Set(['running', 'ready', 'disabled', 'queued', 'could not start']);

/**
 * Per-user Scheduled Task (agent.md §1, D11). Registration by a standard user needs no admin
 * rights because the task runs only as that user, with an interactive token and least privilege.
 */
export class ScheduledTaskService implements ServiceManager {
  constructor(private readonly deps: ScheduledTaskDeps) {}

  private schtasks(...args: string[]): Promise<RunResult> {
    return this.deps.run(system32(this.deps.env, 'schtasks.exe'), args);
  }

  /** The SID survives account renames and has no encoding issues; DOMAIN\user is the fallback. */
  private async currentUserId(): Promise<string> {
    try {
      const result = await runPowerShell(this.deps.run, this.deps.env, SID_SCRIPT);
      const sid = result.stdout.trim();
      if (result.code === 0 && /^S-1-\d+(-\d+)+$/.test(sid)) return sid;
    } catch {
      // fall through to the environment
    }
    const user = currentUserName(this.deps.env);
    if (user === undefined) {
      throw new Error('Cannot determine the current Windows user for the scheduled task');
    }
    return user;
  }

  async install(opts: { nodePath: string; entryPath: string }): Promise<void> {
    assertExecutablePath('nodePath', opts.nodePath);
    assertExecutablePath('entryPath', opts.entryPath);

    const { appDataDir, files } = this.deps;
    await files.mkdir(path.win32.join(appDataDir, 'logs'));
    const xml = buildTaskXml({
      userId: await this.currentUserId(),
      nodePath: opts.nodePath,
      entryPath: opts.entryPath,
      // Not the install dir: a process cwd there would block the uninstaller from deleting it.
      workingDirectory: appDataDir,
      systemRoot: systemRoot(this.deps.env),
    });

    const xmlFile = path.win32.join(appDataDir, `${TASK_NAME}-task.xml`);
    await files.writeFile(xmlFile, encodeTaskXml(xml));
    try {
      const created = await this.schtasks('/Create', '/TN', TASK_NAME, '/XML', xmlFile, '/F');
      if (created.code !== 0) {
        throw new Error(`schtasks /Create failed: ${firstErrorLine(created)}`);
      }
    } finally {
      await files.rm(xmlFile);
    }

    const started = await this.schtasks('/Run', '/TN', TASK_NAME);
    if (started.code !== 0) {
      throw new Error(`schtasks /Run failed: ${firstErrorLine(started)}`);
    }
  }

  async uninstall(): Promise<void> {
    // /End fails when the task is not running or does not exist; either is fine here.
    await this.schtasks('/End', '/TN', TASK_NAME);
    const stopError = await this.stopLeftoverAgents();
    const deleted = await this.schtasks('/Delete', '/TN', TASK_NAME, '/F');
    if (deleted.code !== 0 && (await this.status()) !== 'not-installed') {
      throw new Error(`schtasks /Delete failed: ${firstErrorLine(deleted)}`);
    }
    if (stopError !== null) {
      throw new Error(`Stopping running agent processes failed: ${stopError}`);
    }
  }

  /** Returns an error message instead of throwing, so the task is still deleted. */
  private async stopLeftoverAgents(): Promise<string | null> {
    const { pid, execPath, entryPath } = this.deps.self;
    if (entryPath === undefined || entryPath === '') return null;
    const input = Buffer.from(
      JSON.stringify({ exe: execPath, entry: entryPath, exclude: pid }),
      'utf8',
    ).toString('base64');
    try {
      const result = await runPowerShell(this.deps.run, this.deps.env, STOP_AGENTS_SCRIPT, input);
      return result.code === 0 ? null : powershellErrorText(result.stderr);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * `schtasks /Query` exits non-zero only when the task cannot be found. Its Status column is
   * localised, so a non-English status is resolved through Get-ScheduledTask's State enum.
   */
  async status(): Promise<'running' | 'installed' | 'not-installed' | 'unknown'> {
    let result: RunResult;
    try {
      result = await this.schtasks('/Query', '/TN', TASK_NAME, '/FO', 'CSV', '/NH');
    } catch {
      return 'unknown';
    }
    if (result.code !== 0) return 'not-installed';

    for (const line of result.stdout.split(/\r?\n/)) {
      const fields = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '');
      if (fields.length >= 3 && fields[0]?.replace(/^\\/, '') === TASK_NAME) {
        const state = (fields[fields.length - 1] ?? '').toLowerCase();
        return (ENGLISH_STATES.has(state) ? state : await this.scheduledTaskState()) === 'running'
          ? 'running'
          : 'installed';
      }
    }
    return 'unknown';
  }

  private async scheduledTaskState(): Promise<string> {
    try {
      const result = await runPowerShell(this.deps.run, this.deps.env, STATE_SCRIPT);
      return result.code === 0 ? result.stdout.trim().toLowerCase() : '';
    } catch {
      return '';
    }
  }
}
