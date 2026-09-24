/**
 * Enumerates exactly `projects/*\/*.jsonl` (main transcripts) and
 * `projects/*\/*\/subagents/*.jsonl` (subagent transcripts). Nothing else under the data
 * dir is listed. Order is deterministic: per project dir, main files, then subagent files.
 */
import path from 'node:path';
import type { FsLike } from './fs.js';

export interface TranscriptFile {
  path: string;
  kind: 'main' | 'subagent';
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

async function listDir(fs: FsLike, dir: string) {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).sort(byName);
  } catch {
    return [];
  }
}

const isJsonl = (e: { name: string; isFile(): boolean }) => e.isFile() && e.name.endsWith('.jsonl');

/** Throws if `projectsDir` itself is unreadable; unreadable subdirectories are skipped. */
export async function listTranscriptFiles(
  projectsDir: string,
  fs: FsLike,
): Promise<TranscriptFile[]> {
  const projectDirs = (await fs.readdir(projectsDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .sort(byName);
  const files: TranscriptFile[] = [];
  for (const projectDir of projectDirs) {
    const dir = path.join(projectsDir, projectDir.name);
    const entries = await listDir(fs, dir);
    for (const e of entries.filter(isJsonl)) {
      files.push({ path: path.join(dir, e.name), kind: 'main' });
    }
    for (const sessionDir of entries.filter((e) => e.isDirectory())) {
      const subDir = path.join(dir, sessionDir.name, 'subagents');
      for (const e of (await listDir(fs, subDir)).filter(isJsonl)) {
        files.push({ path: path.join(subDir, e.name), kind: 'subagent' });
      }
    }
  }
  return files;
}
