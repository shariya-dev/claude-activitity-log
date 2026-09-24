import { spawn } from 'node:child_process';

export interface CommandResult {
  /** Exit code, or null when the command could not start, was killed, or timed out. */
  code: number | null;
  stdout: string;
  stderr: string;
}

export type RunCommand = (
  cmd: string,
  args: string[],
  opts?: { input?: string; timeoutMs?: number; env?: Record<string, string> },
) => Promise<CommandResult>;

export type SpawnDetached = (cmd: string, args: string[]) => Promise<boolean>;

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Runs a command without a shell. Secrets are passed through `input` (stdin), never argv or
 * `env` (which only adds non-secret variables such as XDG_RUNTIME_DIR).
 */
export const runCommand: RunCommand = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: CommandResult): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ code: null, stdout, stderr: `${stderr}${cmd} timed out` });
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => finish({ code: null, stdout, stderr: error.message }));
    child.on('close', (code) => finish({ code, stdout, stderr }));

    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.input ?? '');
  });

/** Starts a long-lived process detached from the agent. Resolves false when it cannot start. */
export const spawnDetached: SpawnDetached = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
