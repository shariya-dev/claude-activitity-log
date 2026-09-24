import { type CommandRunner, type RunResult, powershellPath } from './exec.js';

/**
 * Runs a constant script in Windows PowerShell 5.1. The script travels as -EncodedCommand
 * (UTF-16LE base64), so no quoting layer can alter it; variable data goes only on stdin.
 */
export function powershellArgs(script: string): string[] {
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

/** Inverse of `powershellArgs`, for tests and diagnostics. */
export function decodePowerShellCommand(args: readonly string[]): string {
  const index = args.indexOf('-EncodedCommand');
  const encoded = index === -1 ? undefined : args[index + 1];
  return encoded === undefined ? '' : Buffer.from(encoded, 'base64').toString('utf16le');
}

export function runPowerShell(
  run: CommandRunner,
  env: NodeJS.ProcessEnv,
  script: string,
  input?: string,
): Promise<RunResult> {
  return run(powershellPath(env), powershellArgs(script), input === undefined ? {} : { input });
}

/** Prelude for every script: fail fast, and keep progress records off stderr. */
export const PS_PRELUDE =
  "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue';";

const ERROR_TEXT_MAX = 300;

/**
 * Readable text from PowerShell's stderr. With redirected streams PowerShell serialises errors
 * as CLIXML (`#< CLIXML` + `<S S="Error">` records with `_xHHHH_` escapes and ANSI colours).
 */
export function powershellErrorText(stderr: string): string {
  let text = stderr;
  if (stderr.trimStart().startsWith('#< CLIXML')) {
    text = [...stderr.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)]
      .map((m) => m[1] ?? '')
      .join(' ')
      .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }
  text = text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (text === '' ? 'no error output' : text).slice(0, ERROR_TEXT_MAX);
}
