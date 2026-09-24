import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CredentialStore } from '../types.js';
import type { RunCommand } from './exec.js';

export const SECRET_SERVICE_NAME = 'com.6amtech.agent';
const SECRET_LABEL = '6amAgent';
const PROBE_TIMEOUT_MS = 5_000;
const NEGATIVE_PROBE_TTL_MS = 60_000;

function assertKey(key: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(key) || key === '.' || key === '..') {
    throw new Error(`Invalid credential key: ${JSON.stringify(key)}`);
  }
}

/**
 * One file per key in a 0700 dir, each file 0600. This is the expected backend on headless
 * workstations and whenever no Secret Service (gnome-keyring, KWallet) is reachable.
 */
export function createFileCredentialStore(dir: string): CredentialStore {
  const fileFor = (key: string): string => {
    assertKey(key);
    return path.join(dir, key);
  };

  return {
    backend: 'file-0600',

    async get(key) {
      try {
        return await readFile(fileFor(key), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },

    async set(key, value) {
      const file = fileFor(key);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // mkdir leaves an existing dir's mode alone, and umask can narrow it: set it explicitly.
      await chmod(dir, 0o700);
      const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;

      try {
        await writeFile(tmp, value, { mode: 0o600, flag: 'wx' });
        await rename(tmp, file);
      } finally {
        await rm(tmp, { force: true });
      }
    },

    async delete(key) {
      await rm(fileFor(key), { force: true });
    },
  };
}

/**
 * Interprets `secret-tool lookup` of a key that never exists: exit 0, or exit 1 with nothing on
 * stderr (not found), means a Secret Service answered. Anything else (missing binary, no D-Bus,
 * no provider, timeout) means it is not reachable.
 */
export function secretServiceReachable(result: { status: number | null; stderr: string }): boolean {
  return result.status === 0 || (result.status === 1 && result.stderr.trim() === '');
}

export function probeSecretService(): boolean {
  const result = spawnSync(
    'secret-tool',
    ['lookup', 'service', SECRET_SERVICE_NAME, 'key', '__6am_agent_probe__'],
    { input: '', encoding: 'utf8', timeout: PROBE_TIMEOUT_MS },
  );

  return secretServiceReachable({
    status: result.error ? null : result.status,
    stderr: result.stderr ?? '',
  });
}

/**
 * libsecret via `secret-tool` when a Secret Service is reachable, otherwise the 0600 file store.
 * The secret travels on stdin/stdout only.
 * - Reads always also check the file store, so a device paired headless keeps working once a
 *   desktop keyring appears.
 * - A keyring error (locked, no prompt possible, timeout) with no file copy throws rather than
 *   returning null, so the caller retries instead of treating the device as unpaired.
 * - A write the keyring refuses falls back to the file store.
 * - A reachable probe result is kept; an unreachable one is re-probed after a minute, so a
 *   service that started before the keyring came up still finds a token stored there later.
 */
export function createLinuxCredentialStore(o: {
  run: RunCommand;
  dir: string;
  probeSecretService?: () => boolean;
  now?: () => number;
}): CredentialStore {
  const files = createFileCredentialStore(o.dir);
  const probe = o.probeSecretService ?? probeSecretService;
  const now = o.now ?? Date.now;
  let reachable = false;
  let probedAt: number | null = null;

  const secretServiceEnabled = (): boolean => {
    if (!reachable && (probedAt === null || now() - probedAt >= NEGATIVE_PROBE_TTL_MS)) {
      reachable = probe();
      probedAt = now();
    }
    return reachable;
  };
  const markUnreachable = (): void => {
    reachable = false;
    probedAt = now();
  };
  const attrs = (key: string): string[] => ['service', SECRET_SERVICE_NAME, 'key', key];

  return {
    get backend() {
      return secretServiceEnabled() ? 'libsecret' : 'file-0600';
    },

    async get(key) {
      assertKey(key);
      let keyringError: string | null = null;

      if (secretServiceEnabled()) {
        const result = await o.run('secret-tool', ['lookup', ...attrs(key)]);

        if (result.code === 0 && result.stdout !== '') {
          return result.stdout;
        }

        if (!secretServiceReachable({ status: result.code, stderr: result.stderr })) {
          keyringError = result.stderr.trim() || `secret-tool exited with ${result.code}`;
        }
      }

      const fromFile = await files.get(key);

      if (fromFile === null && keyringError !== null) {
        throw new Error(`Secret Service lookup failed: ${keyringError}`);
      }

      return fromFile;
    },

    async set(key, value) {
      assertKey(key);

      if (secretServiceEnabled()) {
        const result = await o.run(
          'secret-tool',
          ['store', `--label=${SECRET_LABEL}`, ...attrs(key)],
          { input: value },
        );

        if (result.code === 0) {
          await files.delete(key);
          return;
        }

        markUnreachable();
      }

      await files.set(key, value);
    },

    async delete(key) {
      assertKey(key);

      if (secretServiceEnabled()) {
        await o.run('secret-tool', ['clear', ...attrs(key)]);
      }

      await files.delete(key);
    },
  };
}
