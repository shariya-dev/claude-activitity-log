/**
 * Child-process access for the Windows adapter. Every system binary is started by absolute path
 * under %SystemRoot%\System32, never through PATH or a shell. Secrets travel only on stdin.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

export interface RunOptions {
  /** Written to the child's stdin, then stdin is closed. The only channel for secrets. */
  input?: string;
  /** Pass the arguments to CreateProcess unquoted (needed for cmd.exe's own parser). */
  windowsVerbatimArguments?: boolean;
  timeoutMs?: number;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Resolves with the exit code (never rejects on a non-zero exit); rejects if the spawn fails. */
export type CommandRunner = (
  file: string,
  args: readonly string[],
  opts?: RunOptions,
) => Promise<RunResult>;

const DEFAULT_TIMEOUT_MS = 30_000;

export const spawnRunner: CommandRunner = (file, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: opts.windowsVerbatimArguments ?? false,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on('error', () => {
      // The child may exit before reading stdin; its exit code reports the failure.
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === null) {
        reject(
          new Error(`${path.win32.basename(file)} terminated by ${signal ?? 'unknown signal'}`),
        );
        return;
      }
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    child.stdin.end(opts.input ?? '');
  });

/** %SystemRoot%, trusted only when it is an absolute drive path; otherwise the default. */
export function systemRoot(env: NodeJS.ProcessEnv): string {
  const value = env.SystemRoot ?? env.SYSTEMROOT ?? '';
  return /^[A-Za-z]:\\[^"]*$/.test(value) ? value.replace(/\\+$/, '') : 'C:\\Windows';
}

export function system32(env: NodeJS.ProcessEnv, ...rest: string[]): string {
  return path.win32.join(systemRoot(env), 'System32', ...rest);
}

export function powershellPath(env: NodeJS.ProcessEnv): string {
  return system32(env, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** First line of a child's stderr, for error messages. Never includes stdout. */
export function firstErrorLine(result: RunResult): string {
  const line = result.stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '');
  return (line ?? `exit code ${result.code}`).slice(0, 300);
}
