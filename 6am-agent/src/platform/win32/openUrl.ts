import { type CommandRunner, firstErrorLine, system32 } from './exec.js';

export interface OpenUrlDeps {
  run: CommandRunner;
  env: NodeJS.ProcessEnv;
}

// Variables cmd.exe computes on the fly; they are never in the environment block.
const DYNAMIC_VARIABLES = [
  'cd',
  'date',
  'time',
  'random',
  'errorlevel',
  'cmdextversion',
  'cmdcmdline',
  'highestnumanodenumber',
  '__cd__',
  '__appdir__',
];

/**
 * True if any text between two consecutive `%` signs (checked overlapping, since cmd resumes
 * scanning at the closing `%` when a name is undefined) is a variable cmd.exe would expand.
 */
function expandsInCmd(text: string, env: NodeJS.ProcessEnv): boolean {
  const names = new Set([...Object.keys(env), ...DYNAMIC_VARIABLES].map((k) => k.toLowerCase()));
  const marks = [...text.matchAll(/%/g)].map((m) => m.index);
  for (let i = 0; i + 1 < marks.length; i += 1) {
    const inner = text.slice((marks[i] ?? 0) + 1, marks[i + 1]);
    // %NAME:~0,3% and %NAME:a=b% expand NAME too.
    if (names.has((inner.split(':')[0] ?? '').toLowerCase())) return true;
  }
  return false;
}

/**
 * Opens an http(s) URL in the default browser with `cmd.exe /c start "" "<url>"`. cmd.exe has
 * its own parser, so the command line is built verbatim: the WHATWG href percent-encodes `"`,
 * and `& | < > ^` are literal inside quotes. cmd still expands `%NAME%` inside quotes, so a URL
 * that names a defined or dynamic variable is refused rather than risk leaking or altering it.
 */
export async function openUrl(url: string, deps: OpenUrlDeps): Promise<void> {
  let href: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    href = parsed.href;
  } catch {
    throw new Error('openUrl accepts only http(s) URLs');
  }

  if (expandsInCmd(href, deps.env)) {
    throw new Error('openUrl refuses a URL that cmd.exe would expand as an environment variable');
  }
  if (/["\r\n]/.test(href)) throw new Error('openUrl refuses a URL containing quotes');

  const result = await deps.run(
    system32(deps.env, 'cmd.exe'),
    ['/d', '/v:off', '/s', '/c', `"start "" "${href}""`],
    { windowsVerbatimArguments: true },
  );
  if (result.code !== 0) {
    throw new Error(`Opening the browser failed: ${firstErrorLine(result)}`);
  }
}
