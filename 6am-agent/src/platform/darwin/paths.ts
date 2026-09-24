/** macOS locations (claude-data-contract §2, agent.md §1). Pure functions of env + home. */
import path from 'node:path';

export type Env = Record<string, string | undefined>;

const APP_NAME = '6amAgent';

function envDir(env: Env, name: string): string | null {
  const value = env[name];
  return value === undefined || value === '' ? null : path.resolve(value);
}

/** Ordered: `$CLAUDE_CONFIG_DIR`, `~/.claude`, then the defensive XDG locations. */
export function claudeDataCandidates(env: Env, home: string): string[] {
  const xdg = envDir(env, 'XDG_CONFIG_HOME');
  const candidates = [
    envDir(env, 'CLAUDE_CONFIG_DIR'),
    path.join(home, '.claude'),
    xdg === null ? null : path.join(xdg, 'claude'),
    path.join(home, '.config', 'claude'),
  ];
  return [...new Set(candidates.filter((c): c is string => c !== null))];
}

export function claudeGlobalConfigCandidates(env: Env, home: string): string[] {
  const configDir = envDir(env, 'CLAUDE_CONFIG_DIR');
  const candidates = [
    configDir === null ? null : path.join(configDir, '.claude.json'),
    path.join(home, '.claude.json'),
  ];
  return [...new Set(candidates.filter((c): c is string => c !== null))];
}

export function appDataDir(home: string): string {
  return path.join(home, 'Library', 'Application Support', APP_NAME);
}

export function logDir(home: string): string {
  return path.join(home, 'Library', 'Logs', APP_NAME);
}
