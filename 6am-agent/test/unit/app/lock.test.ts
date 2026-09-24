import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, readLockHolder } from '../../../src/app/lock.js';

describe('single-instance lock', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'h18-lock-'));
    file = path.join(dir, 'agent.lock');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the pid and releases the file', () => {
    const lock = acquireLock(file);
    expect(lock).not.toBeNull();
    expect(readFileSync(file, 'utf8').trim()).toBe(String(process.pid));
    expect(readLockHolder(file)).toBe(process.pid);
    lock?.release();
    expect(existsSync(file)).toBe(false);
    expect(readLockHolder(file)).toBeNull();
  });

  it('refuses a second instance while the holder is alive', () => {
    const first = acquireLock(file, { isAlive: () => true });
    expect(first).not.toBeNull();
    expect(acquireLock(file, { pid: 999_999, isAlive: () => true })).toBeNull();
    first?.release();
  });

  it('takes over a stale lock whose pid is dead', () => {
    writeFileSync(file, '424242\n');
    const lock = acquireLock(file, { isAlive: (pid) => pid !== 424242 });
    expect(lock).not.toBeNull();
    expect(readFileSync(file, 'utf8').trim()).toBe(String(process.pid));
    lock?.release();
  });

  it('takes over a lock file with garbage content', () => {
    writeFileSync(file, 'not-a-pid');
    expect(acquireLock(file)).not.toBeNull();
  });

  it('release does not delete a lock taken over by another process', () => {
    const lock = acquireLock(file);
    writeFileSync(file, '777\n');
    lock?.release();
    expect(readFileSync(file, 'utf8').trim()).toBe('777');
  });

  it('readLockHolder reports null for a dead holder', () => {
    writeFileSync(file, '424242\n');
    expect(readLockHolder(file, { isAlive: () => false })).toBeNull();
    expect(readLockHolder(file, { isAlive: () => true })).toBe(424242);
  });
});
