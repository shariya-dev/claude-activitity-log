import { constants } from 'node:fs';
import {
  access,
  mkdir,
  open,
  opendir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';

/** The filesystem operations the Windows adapter needs, injectable for tests. */
export interface Win32FileOps {
  mkdir(p: string): Promise<void>;
  readFile(p: string): Promise<Uint8Array>;
  writeFile(p: string, data: string | Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Removes a file; a missing file is not an error. */
  rm(p: string): Promise<void>;
  /** Throws (ENOENT, EPERM, ...) when the path cannot be stat'ed. */
  isDirectory(p: string): Promise<boolean>;
  /** Actually opens the path for reading (a directory is listed), since ACLs are not in the mode. */
  probeRead(p: string): Promise<void>;
}

export const nodeFileOps: Win32FileOps = {
  async mkdir(p) {
    await mkdir(p, { recursive: true });
  },
  readFile: (p) => readFile(p),
  writeFile: (p, data) => writeFile(p, data),
  rename: (from, to) => rename(from, to),
  rm: (p) => rm(p, { force: true }),
  async isDirectory(p) {
    return (await stat(p)).isDirectory();
  },
  async probeRead(p) {
    if ((await stat(p)).isDirectory()) {
      const dir = await opendir(p);
      try {
        await dir.read();
      } finally {
        await dir.close();
      }
      return;
    }
    await access(p, constants.R_OK);
    const handle = await open(p, 'r');
    await handle.close();
  },
};
