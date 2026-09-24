import path from 'node:path';

export interface LinuxEnv {
  env: NodeJS.ProcessEnv;
  homedir: string;
}

export const APP_DIR_NAME = '6am-agent';

/** XDG base-directory values must be absolute; anything else is ignored (XDG spec). */
function xdgDir(value: string | undefined): string | null {
  return value !== undefined && path.isAbsolute(value) ? value : null;
}

export function configHome({ env, homedir }: LinuxEnv): string {
  return xdgDir(env.XDG_CONFIG_HOME) ?? path.join(homedir, '.config');
}

export function appDataDir({ env, homedir }: LinuxEnv): string {
  return path.join(
    xdgDir(env.XDG_STATE_HOME) ?? path.join(homedir, '.local', 'state'),
    APP_DIR_NAME,
  );
}

/** Order per claude-data-contract §2; the XDG entries are checked defensively only. */
export function claudeDataCandidates(e: LinuxEnv): string[] {
  const candidates = [
    e.env.CLAUDE_CONFIG_DIR ? e.env.CLAUDE_CONFIG_DIR : null,
    path.join(e.homedir, '.claude'),
    xdgDir(e.env.XDG_CONFIG_HOME) === null ? null : path.join(configHome(e), 'claude'),
    path.join(e.homedir, '.config', 'claude'),
  ];

  return [...new Set(candidates.filter((c): c is string => c !== null))];
}

export function claudeGlobalConfigCandidates({ env, homedir }: LinuxEnv): string[] {
  const candidates = [path.join(homedir, '.claude.json')];

  if (env.CLAUDE_CONFIG_DIR) {
    candidates.unshift(path.join(env.CLAUDE_CONFIG_DIR, '.claude.json'));
  }

  return candidates;
}
