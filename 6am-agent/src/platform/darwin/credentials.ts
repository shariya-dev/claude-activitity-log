/**
 * Credentials live in the login Keychain as generic passwords (service `com.6amtech.agent`,
 * account = key), managed through /usr/bin/security so the item's ACL trusts that tool rather
 * than the (versioned) node binary. The secret is written through `security -i` on stdin and
 * never appears in argv, logs or error messages. Without a usable Keychain (headless/SSH) the
 * store falls back to a 0600 file in the app data dir.
 */
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CredentialStore } from '../types.js';
import { BIN, commandFailed, type ExecFn } from './exec.js';

export const KEYCHAIN_SERVICE = 'com.6amtech.agent';

/** `security` exits with the low byte of the OSStatus. */
const ITEM_NOT_FOUND = 44; // errSecItemNotFound -25300
const KEYCHAIN_UNAVAILABLE = new Set([
  36, // errSecInteractionNotAllowed -25308
  37, // errSecNoDefaultKeychain -25307
  53, // errSecNotAvailable -25291
]);

const SAFE_KEY = /^[A-Za-z0-9._-]{1,128}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

class KeychainUnavailableError extends Error {}

function assertKey(key: string): void {
  if (!SAFE_KEY.test(key)) throw new Error('invalid credential key');
}

/** Quotes a word for the `security -i` command-line parser. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function keychainFailure(what: string, code: number): Error {
  return KEYCHAIN_UNAVAILABLE.has(code)
    ? new KeychainUnavailableError(`keychain unavailable (exit ${code})`)
    : commandFailed(`keychain ${what}`, code);
}

export function createKeychainStore(exec: ExecFn): CredentialStore {
  return {
    backend: 'keychain',

    async get(key) {
      assertKey(key);
      const res = await exec(BIN.security, [
        'find-generic-password',
        '-s',
        KEYCHAIN_SERVICE,
        '-a',
        key,
        '-w',
      ]);
      if (res.code === ITEM_NOT_FOUND) return null;
      if (res.code !== 0) throw keychainFailure('read', res.code);
      return res.stdout.replace(/\n$/, '');
    },

    async set(key, value) {
      assertKey(key);
      if (CONTROL_CHARS.test(value))
        throw new Error('credential value contains control characters');
      const command = `add-generic-password -U -s ${quote(KEYCHAIN_SERVICE)} -a ${quote(key)} -w ${quote(value)}\n`;
      const res = await exec(BIN.security, ['-i'], { input: command });
      if (res.code !== 0) throw keychainFailure('write', res.code);
    },

    async delete(key) {
      assertKey(key);
      const res = await exec(BIN.security, [
        'delete-generic-password',
        '-s',
        KEYCHAIN_SERVICE,
        '-a',
        key,
      ]);
      if (res.code !== 0 && res.code !== ITEM_NOT_FOUND) throw keychainFailure('delete', res.code);
    },
  };
}

const CREDENTIALS_FILE = 'credentials.json';

export function createFileStore(dir: string): CredentialStore {
  const file = path.join(dir, CREDENTIALS_FILE);

  async function load(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as Record<string, string>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  async function save(values: Record<string, string>): Promise<void> {
    if (Object.keys(values).length === 0) {
      await rm(file, { force: true });
      return;
    }
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(values), { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, file);
  }

  return {
    backend: 'file-0600',
    async get(key) {
      return (await load())[key] ?? null;
    },
    async set(key, value) {
      assertKey(key);
      await save({ ...(await load()), [key]: value });
    },
    async delete(key) {
      const values = await load();
      if (!(key in values)) return;
      delete values[key];
      await save(values);
    },
  };
}

/** A default keychain that answers without user interaction; false when headless. */
export function probeKeychain(): boolean {
  try {
    execFileSync(BIN.security, ['show-keychain-info'], { stdio: 'ignore', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export interface DarwinCredentialDeps {
  exec: ExecFn;
  fileDir: string;
  keychainAvailable: () => boolean;
}

/** Keychain first; the 0600 file only when the Keychain is unusable in this session. */
export function createDarwinCredentialStore(deps: DarwinCredentialDeps): CredentialStore {
  const keychain = createKeychainStore(deps.exec);
  const file = createFileStore(deps.fileDir);
  let active: CredentialStore | null = null;

  const current = (): CredentialStore => {
    active ??= deps.keychainAvailable() ? keychain : file;
    return active;
  };

  async function run<T>(op: (store: CredentialStore) => Promise<T>): Promise<T> {
    const store = current();
    try {
      return await op(store);
    } catch (err) {
      if (!(err instanceof KeychainUnavailableError)) throw err;
      active = file;
      return op(file);
    }
  }

  return {
    get backend() {
      return current().backend;
    },
    get: (key) => run((s) => s.get(key)),
    set: (key, value) => run((s) => s.set(key, value)),
    delete: (key) => run((s) => s.delete(key)),
  };
}
