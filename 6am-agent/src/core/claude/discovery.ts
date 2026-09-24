/**
 * Picks the Claude data dir from ordered candidates (claude-data-contract §2). The platform
 * layer supplies the candidates; this only stats and lists. It never reads the global config
 * and never writes.
 */
import { join } from 'node:path';
import { type FsLike, nodeFs } from './fs.js';

export interface ClaudeDataSource {
  dataDir: string;
  projectsDir: string;
  globalConfigPath: string | null;
}

export async function discoverClaudeData(
  candidates: string[],
  globalConfigCandidates: string[],
  fs: FsLike = nodeFs,
): Promise<ClaudeDataSource | null> {
  for (const dataDir of candidates) {
    if (dataDir === '') continue;
    const projectsDir = join(dataDir, 'projects');
    if (!(await isReadableDir(projectsDir, fs))) continue;
    return { dataDir, projectsDir, globalConfigPath: await firstFile(globalConfigCandidates, fs) };
  }
  return null;
}

/** An empty `projects/` is valid: Claude is installed but not used yet. */
async function isReadableDir(path: string, fs: FsLike): Promise<boolean> {
  try {
    if (!(await fs.stat(path)).isDirectory()) return false;
    await fs.readdir(path, { withFileTypes: true });
    return true;
  } catch {
    return false;
  }
}

async function firstFile(paths: string[], fs: FsLike): Promise<string | null> {
  for (const path of paths) {
    if (path === '') continue;
    try {
      if ((await fs.stat(path)).isFile()) return path;
    } catch {
      // missing or unreadable: try the next candidate
    }
  }
  return null;
}
