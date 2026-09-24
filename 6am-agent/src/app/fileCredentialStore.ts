import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CredentialStore } from '../platform/types.js';

const FILE_NAME = 'credentials.json';

/**
 * Dev-only credential store (`AGENT_CREDENTIAL_BACKEND=file`): a JSON map in `<dir>/credentials.json`
 * with mode 0600, replaced atomically. Release builds use the adapter's OS secure storage.
 */
export function createFileCredentialStore(dir: string): CredentialStore {
  const file = path.join(dir, FILE_NAME);

  const read = (): Record<string, string> => {
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'),
      );
    } catch {
      return {};
    }
  };

  const write = (values: Record<string, string>): void => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(values), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  };

  return {
    backend: 'file-0600',
    get(key) {
      return Promise.resolve(read()[key] ?? null);
    },
    set(key, value) {
      write({ ...read(), [key]: value });
      return Promise.resolve();
    },
    delete(key) {
      const values = read();
      if (!(key in values)) return Promise.resolve();
      delete values[key];
      if (Object.keys(values).length === 0) rmSync(file, { force: true });
      else write(values);
      return Promise.resolve();
    },
  };
}
