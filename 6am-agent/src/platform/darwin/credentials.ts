/**
 * Credentials live in the login Keychain as generic passwords (service `com.6amtech.agent`,
 * account = key), managed through /usr/bin/security so the item's ACL trusts that tool rather
 * than the (versioned) node binary. The secret is written through `security -i` on stdin and
 * never appears in argv, logs or error messages. Without a usable Keychain (headless/SSH) the
 * store uses a 0600 file in the app data dir instead.
 */
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CredentialStore } from '../types.js';
import { BIN, commandFailed, type ExecFn } from './exec.js';

export const KEYCHAIN_SERVICE = 'com.6amtech.agent';

/** `security` exits with the low byte of the OSStatus. */
const ITEM_NOT_FOUND = 44; // errSecItemNotFound -25300

const SAFE_KEY = /^[A-Za-z0-9._-]{1,128}$/;
/** `find-generic-password -w` prints anything else as hex, so only printable ASCII round-trips. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

function assertKey(key: string): void {
  if (!SAFE_KEY.test(key)) throw new Error('invalid credential key');
}

/** Quotes a word for the `security -i` command-line parser. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
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
      if (res.code !== 0) throw commandFailed('keychain read', res.code);
      return res.stdout.replace(/\n$/, '');
    },

    async set(key, value) {
      assertKey(key);
      if (!PRINTABLE_ASCII.test(value)) {
        throw new Error('credential value must be printable ASCII');
      }
      const command = `add-generic-password -U -s ${quote(KEYCHAIN_SERVICE)} -a ${quote(key)} -w ${quote(value)}\n`;
      const res = await exec(BIN.security, ['-i'], { input: command });
      if (res.code !== 0) throw commandFailed('keychain write', res.code);
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
      if (res.code !== 0 && res.code !== ITEM_NOT_FOUND)
        throw commandFailed('keychain delete', res.code);
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
    // A fresh, exclusively created temp file: the secret is never written into an existing file
    // whose mode could be wider than 0600.
    const tmp = `${file}.${process.pid}.tmp`;
    await rm(tmp, { force: true });
    await writeFile(tmp, JSON.stringify(values), { mode: 0o600, flag: 'wx' });
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

/**
 * The probe picks the backend once per process and it never changes: a Keychain that fails
 * (e.g. locked) is an error for the caller to retry, never an empty result that would read as
 * "not paired". In Keychain mode a value a headless session left in the file is still found,
 * moves into the Keychain on the next set, and delete clears both.
 */
export function createDarwinCredentialStore(deps: DarwinCredentialDeps): CredentialStore {
  const keychain = createKeychainStore(deps.exec);
  const file = createFileStore(deps.fileDir);
  let useKeychain: boolean | null = null;

  const keychainMode = (): boolean => {
    useKeychain ??= deps.keychainAvailable();
    return useKeychain;
  };

  return {
    get backend() {
      return keychainMode() ? keychain.backend : file.backend;
    },
    async get(key) {
      if (!keychainMode()) return file.get(key);
      return (await keychain.get(key)) ?? file.get(key);
    },
    async set(key, value) {
      if (!keychainMode()) return file.set(key, value);
      await keychain.set(key, value);
      await file.delete(key);
    },
    async delete(key) {
      if (keychainMode()) await keychain.delete(key);
      await file.delete(key);
    },
  };
}
