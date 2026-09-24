/**
 * The minimal read-only filesystem surface the Claude reader uses. Injected so tests can
 * spy on or fake it. There is deliberately no write method: the agent never writes to
 * Claude's directories.
 */
import * as fsp from 'node:fs/promises';

export interface DirEntryLike {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface StatLike {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface FileHandleLike {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface FsLike {
  readdir(path: string, options: { withFileTypes: true }): Promise<DirEntryLike[]>;
  stat(path: string): Promise<StatLike>;
  open(path: string, flags: 'r'): Promise<FileHandleLike>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
}

export const nodeFs: FsLike = {
  readdir: (path, options) => fsp.readdir(path, options),
  stat: (path) => fsp.stat(path),
  open: (path, flags) => fsp.open(path, flags),
  readFile: (path, encoding) => fsp.readFile(path, encoding),
};

/** `dev:ino`. Where the OS reports ino 0 (FAT/exFAT), shrink detection still resets the offset. */
export function fileIdentity(stat: StatLike): string {
  return `${stat.dev}:${stat.ino}`;
}
