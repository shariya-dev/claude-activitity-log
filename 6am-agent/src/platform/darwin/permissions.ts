/**
 * Readability check for diagnostics. `~/.claude` and `~/.claude.json` are not TCC-protected
 * (claude-data-contract §12), but `<cwd>/.git/config` under ~/Documents, ~/Desktop or
 * ~/Downloads can be: macOS privacy protection answers EPERM (not EACCES) to a background
 * process, which only Full Disk Access lifts.
 */
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface PermissionFs {
  stat: (p: string) => Promise<{ isDirectory(): boolean }>;
  readdir: (p: string) => Promise<unknown>;
  access: (p: string, mode: number) => Promise<void>;
}

const nodeFs: PermissionFs = { stat, readdir, access };

const TCC_FOLDERS = ['Desktop', 'Documents', 'Downloads', path.join('Library', 'Mobile Documents')];

export type PermissionResult = { path: string; readable: boolean; hint?: string };

function hintFor(code: string | undefined, p: string, home: string): string {
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'path does not exist';
  if (code === 'EPERM') {
    const where = TCC_FOLDERS.find((f) => p.startsWith(path.join(home, f) + path.sep));
    const scope = where === undefined ? 'this location' : `~/${where}`;
    return (
      `macOS privacy protection blocks ${scope}; grant Full Disk Access to the 6amAgent runtime ` +
      '(System Settings → Privacy & Security → Full Disk Access)'
    );
  }
  if (code === 'EACCES') return 'permission denied; the agent runs as the logged-in user';
  return `not readable (${code ?? 'unknown error'})`;
}

export async function checkPermissions(
  paths: string[],
  home: string,
  fs: Partial<PermissionFs> = {},
): Promise<PermissionResult[]> {
  const io = { ...nodeFs, ...fs };
  const results: PermissionResult[] = [];
  for (const p of paths) {
    try {
      if ((await io.stat(p)).isDirectory()) await io.readdir(p);
      else await io.access(p, constants.R_OK);
      results.push({ path: p, readable: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      results.push({ path: p, readable: false, hint: hintFor(code, p, home) });
    }
  }
  return results;
}
