/**
 * Windows locations (claude-data-contract §2; agent.md §1). Built with path.win32 so the logic
 * is the same whichever OS runs the tests. Paths may contain spaces and non-ASCII characters;
 * they are only ever passed as whole arguments, never through a shell.
 */
import path from 'node:path';

export interface PathEnv {
  env: NodeJS.ProcessEnv;
  homedir: () => string;
}

const APP_DIR_NAME = '6amAgent';

function absolute(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '' || !path.win32.isAbsolute(trimmed)) return null;
  const normalized = path.win32.normalize(trimmed);
  // Keep a drive root ("C:\") intact; strip any other trailing separator.
  return /^[A-Za-z]:\\$/.test(normalized) ? normalized : normalized.replace(/\\+$/, '');
}

export function userProfile(e: PathEnv): string {
  return absolute(e.env.USERPROFILE) ?? path.win32.normalize(e.homedir());
}

export function localAppData(e: PathEnv): string {
  return absolute(e.env.LOCALAPPDATA) ?? path.win32.join(userProfile(e), 'AppData', 'Local');
}

/** A relative CLAUDE_CONFIG_DIR is ignored: the service's cwd is not the shell's. */
function claudeConfigDir(e: PathEnv): string | null {
  return absolute(e.env.CLAUDE_CONFIG_DIR);
}

function dedupeCaseInsensitive(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Ordered: %CLAUDE_CONFIG_DIR%, then %USERPROFILE%\.claude (the only documented locations). */
export function claudeDataCandidates(e: PathEnv): string[] {
  const configured = claudeConfigDir(e);
  const home = path.win32.join(userProfile(e), '.claude');
  return dedupeCaseInsensitive(configured === null ? [home] : [configured, home]);
}

export function claudeGlobalConfigCandidates(e: PathEnv): string[] {
  const configured = claudeConfigDir(e);
  const home = path.win32.join(userProfile(e), '.claude.json');
  return dedupeCaseInsensitive(
    configured === null ? [home] : [path.win32.join(configured, '.claude.json'), home],
  );
}

export function appDataDir(e: PathEnv): string {
  return path.win32.join(localAppData(e), APP_DIR_NAME);
}

export function logDir(e: PathEnv): string {
  return path.win32.join(appDataDir(e), 'logs');
}

/** DOMAIN\user of the current account, from the environment; undefined when unknown. */
export function currentUserName(env: NodeJS.ProcessEnv): string | undefined {
  const { USERDOMAIN, USERNAME } = env;
  if (USERNAME === undefined || USERNAME === '') return undefined;
  return USERDOMAIN === undefined || USERDOMAIN === '' ? USERNAME : `${USERDOMAIN}\\${USERNAME}`;
}
