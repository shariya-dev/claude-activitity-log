import { randomBytes } from 'node:crypto';
import { existsSync, linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';

export interface InstanceLock {
  release(): void;
}

interface LockOptions {
  pid?: number;
  isAlive?: (pid: number) => boolean;
  /** When this OS boot started (ms since epoch). Injected by tests. */
  bootTimeMs?: number;
  /** Test hook: runs between reading a stale lock and moving it aside. */
  beforeTakeover?: () => void;
}

interface LockEntry {
  raw: string;
  pid: number;
  bootTimeMs: number | null;
}

/** Wall-clock adjustments shift the computed boot time slightly; a reboot shifts it by the uptime. */
const SAME_BOOT_TOLERANCE_MS = 120_000;
const MAX_ATTEMPTS = 3;

export function currentBootTimeMs(): number {
  return Date.now() - Math.round(uptime() * 1_000);
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

function readEntry(file: string): LockEntry | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const m = /^(\d+)(?:\s+(\d+))?\s*$/.exec(raw);
  const pid = Number(m?.[1]);
  if (m === null || !Number.isSafeInteger(pid) || pid <= 0)
    return { raw, pid: 0, bootTimeMs: null };
  return { raw, pid, bootTimeMs: m[2] === undefined ? null : Number(m[2]) };
}

/**
 * Live = the pid exists AND was recorded during this boot: after a crash and reboot the old pid
 * may belong to an unrelated process (pid reuse), which must not block the agent.
 */
function holderAlive(entry: LockEntry | null, o: LockOptions): entry is LockEntry {
  if (entry === null || entry.pid <= 0) return false;
  const bootTime = o.bootTimeMs ?? currentBootTimeMs();
  if (entry.bootTimeMs !== null && Math.abs(entry.bootTimeMs - bootTime) > SAME_BOOT_TOLERANCE_MS) {
    return false;
  }
  return (o.isAlive ?? processAlive)(entry.pid);
}

/** The pid of the live process holding the lock, or null when it is free or stale. */
export function readLockHolder(file: string, o: LockOptions = {}): number | null {
  const entry = readEntry(file);
  return holderAlive(entry, o) ? entry.pid : null;
}

/**
 * Moves a stale lock aside. If the file moved is no longer the stale content we read (another
 * process took the lock over meanwhile), it is put back untouched.
 */
function removeStale(file: string, stale: LockEntry, pid: number): void {
  const aside = `${file}.${pid}.${randomBytes(4).toString('hex')}.stale`;
  try {
    renameSync(file, aside);
  } catch {
    return;
  }
  let moved: string | null = null;
  try {
    moved = readFileSync(aside, 'utf8');
  } catch {
    moved = null;
  }
  if (moved !== null && moved !== stale.raw) {
    try {
      linkSync(aside, file);
    } catch {
      if (!existsSync(file)) renameSync(aside, file);
    }
  }
  rmSync(aside, { force: true });
}

/**
 * Single-instance lock `<app_data_dir>/agent.lock` holding "<pid> <boot time ms>". A lock whose
 * holder is dead, from an earlier boot, or unreadable is stale and taken over. Returns null
 * while a live process holds it.
 */
export function acquireLock(file: string, o: LockOptions = {}): InstanceLock | null {
  const pid = o.pid ?? process.pid;
  const content = `${pid} ${o.bootTimeMs ?? currentBootTimeMs()}\n`;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
      return {
        release() {
          if (readEntry(file)?.raw === content) rmSync(file, { force: true });
        },
      };
    } catch (err) {
      if ((err as { code?: unknown }).code !== 'EEXIST') throw err;
    }
    const holder = readEntry(file);
    if (holder === null) continue;
    if (holder.pid !== pid && holderAlive(holder, o)) return null;
    o.beforeTakeover?.();
    removeStale(file, holder, pid);
  }
  return null;
}
