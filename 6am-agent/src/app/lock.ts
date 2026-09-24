import { readFileSync, rmSync, writeFileSync } from 'node:fs';

export interface InstanceLock {
  release(): void;
}

interface LockOptions {
  pid?: number;
  isAlive?: (pid: number) => boolean;
}

/** `kill(pid, 0)` probes without signalling; EPERM means the process exists under another user. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: unknown }).code === 'EPERM';
  }
}

function readPid(file: string): number | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
  if (!/^\d+$/.test(raw)) return null;
  const pid = Number(raw);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/** The pid of the live process holding the lock, or null when it is free or stale. */
export function readLockHolder(file: string, o: LockOptions = {}): number | null {
  const isAlive = o.isAlive ?? processAlive;
  const pid = readPid(file);
  return pid !== null && isAlive(pid) ? pid : null;
}

/**
 * Single-instance lock `<app_data_dir>/agent.lock` holding the owner's pid. A lock whose pid is not
 * alive (or unreadable) is stale and taken over. Returns null while a live process holds it.
 */
export function acquireLock(file: string, o: LockOptions = {}): InstanceLock | null {
  const pid = o.pid ?? process.pid;
  const isAlive = o.isAlive ?? processAlive;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, `${pid}\n`, { flag: 'wx', mode: 0o600 });
      return {
        release() {
          if (readPid(file) === pid) rmSync(file, { force: true });
        },
      };
    } catch (err) {
      if ((err as { code?: unknown }).code !== 'EEXIST') throw err;
    }
    const holder = readPid(file);
    if (holder !== null && holder !== pid && isAlive(holder)) return null;
    rmSync(file, { force: true });
  }
  return null;
}
