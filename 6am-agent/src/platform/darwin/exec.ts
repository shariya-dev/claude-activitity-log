/**
 * The only way the macOS adapter runs other programs: execFile (no shell) with absolute paths,
 * so a tampered PATH in the LaunchAgent environment cannot substitute a binary. Secrets go on
 * stdin (`input`), never in argv.
 */
import { execFile } from 'node:child_process';

export const BIN = {
  ioreg: '/usr/sbin/ioreg',
  security: '/usr/bin/security',
  launchctl: '/bin/launchctl',
  swVers: '/usr/bin/sw_vers',
  open: '/usr/bin/open',
} as const;

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Resolves with the exit code instead of rejecting on a non-zero exit; rejects only if the spawn fails. */
export type ExecFn = (
  file: string,
  args: readonly string[],
  opts?: { input?: string },
) => Promise<ExecResult>;

const TIMEOUT_MS = 15_000;

export const execFileRun: ExecFn = (file, args, opts) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      [...args],
      { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err !== null && typeof err.code !== 'number') {
          // Never err.message: Node appends the child's stderr to it.
          const why = err.killed ? 'timed out' : (err.signal ?? err.code ?? 'failed');
          reject(new Error(`${file} could not run: ${why}`));
          return;
        }
        resolve({ code: err === null ? 0 : (err.code as number), stdout, stderr });
      },
    );
    // A child that exits before reading stdin raises EPIPE here; the exit code reports the failure.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(opts?.input ?? '');
  });

/** Error for a failed command that never includes its output (it may echo secrets). */
export function commandFailed(what: string, code: number): Error {
  return new Error(`${what} failed (exit ${code})`);
}
