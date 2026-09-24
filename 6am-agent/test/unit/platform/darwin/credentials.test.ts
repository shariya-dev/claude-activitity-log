import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDarwinCredentialStore,
  createFileStore,
  createKeychainStore,
} from '../../../../src/platform/darwin/credentials.js';
import { fakeExec, type ExecCall } from './fakeExec.js';

const SECRET = '42|s3cr3t "quoted" \\ back$lash';

function argvHasSecret(calls: ExecCall[], secret: string): boolean {
  return calls.some((c) => c.args.some((a) => a.includes(secret)) || c.file.includes(secret));
}

describe('Keychain credential store', () => {
  it('passes the secret on stdin to `security -i`, never in argv', async () => {
    const exec = fakeExec();
    await createKeychainStore(exec).set('device_token', SECRET);
    expect(exec.calls).toHaveLength(1);
    const [call] = exec.calls;
    expect(call?.file).toBe('/usr/bin/security');
    expect(call?.args).toEqual(['-i']);
    expect(argvHasSecret(exec.calls, SECRET)).toBe(false);
    expect(call?.input).toBe(
      'add-generic-password -U -s "com.6amtech.agent" -a "device_token" -w ' +
        '"42|s3cr3t \\"quoted\\" \\\\ back$lash"\n',
    );
  });

  it('reads with find-generic-password -w and strips the trailing newline', async () => {
    const exec = fakeExec(() => ({ stdout: 'tok-123\n' }));
    await expect(createKeychainStore(exec).get('device_token')).resolves.toBe('tok-123');
    expect(exec.calls[0]?.file).toBe('/usr/bin/security');
    expect(exec.calls[0]?.args).toEqual([
      'find-generic-password',
      '-s',
      'com.6amtech.agent',
      '-a',
      'device_token',
      '-w',
    ]);
  });

  it('returns null when the item is not found (exit 44)', async () => {
    const exec = fakeExec(() => ({ code: 44 }));
    await expect(createKeychainStore(exec).get('device_token')).resolves.toBeNull();
  });

  it('deletes and tolerates a missing item', async () => {
    const exec = fakeExec(() => ({ code: 44 }));
    await expect(createKeychainStore(exec).delete('device_token')).resolves.toBeUndefined();
    expect(exec.calls[0]?.args).toEqual([
      'delete-generic-password',
      '-s',
      'com.6amtech.agent',
      '-a',
      'device_token',
    ]);
  });

  it('does not leak the secret in the error when `security` fails', async () => {
    const exec = fakeExec(() => ({ code: 45, stderr: `failed for ${SECRET}` }));
    const err = await createKeychainStore(exec)
      .set('device_token', SECRET)
      .catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(SECRET);
    expect((err as Error).message).toMatch(/exit 45/);
  });

  it('rejects values with control characters and unsafe keys without running anything', async () => {
    const exec = fakeExec();
    const store = createKeychainStore(exec);
    await expect(store.set('device_token', 'a\nb')).rejects.toThrow(/printable ASCII/);
    await expect(store.set('device_token', 'tökén')).rejects.toThrow(/printable ASCII/);
    await expect(store.set('bad key"', 'v')).rejects.toThrow(/key/);
    expect(exec.calls).toHaveLength(0);
  });
});

describe('file-0600 credential store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cam-cred-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores values in a 0600 file inside a 0700 dir', async () => {
    const appData = path.join(dir, 'app');
    const store = createFileStore(appData);
    expect(store.backend).toBe('file-0600');
    await store.set('device_token', SECRET);
    const file = path.join(appData, 'credentials.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(appData)).mode & 0o777).toBe(0o700);
    await expect(store.get('device_token')).resolves.toBe(SECRET);
    await expect(store.get('other')).resolves.toBeNull();
  });

  it('keeps 0600 after an update and deletes the file when empty', async () => {
    const store = createFileStore(dir);
    await store.set('a', '1');
    await store.set('b', '2');
    await store.set('a', '3');
    const file = path.join(dir, 'credentials.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ a: '3', b: '2' });
    await store.delete('a');
    await store.delete('b');
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.get('a')).resolves.toBeNull();
  });
});

describe('darwin credential store selection', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cam-cred-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('uses the Keychain when it is available', async () => {
    const exec = fakeExec();
    const store = createDarwinCredentialStore({
      exec,
      fileDir: dir,
      keychainAvailable: () => true,
    });
    expect(store.backend).toBe('keychain');
    await store.set('device_token', SECRET);
    expect(exec.calls[0]?.args).toEqual(['-i']);
  });

  it('falls back to the 0600 file when the Keychain is unavailable (headless)', async () => {
    const exec = fakeExec();
    const store = createDarwinCredentialStore({
      exec,
      fileDir: dir,
      keychainAvailable: () => false,
    });
    expect(store.backend).toBe('file-0600');
    await store.set('device_token', SECRET);
    await expect(store.get('device_token')).resolves.toBe(SECRET);
    expect(exec.calls).toHaveLength(0);
    expect((await stat(path.join(dir, 'credentials.json'))).mode & 0o777).toBe(0o600);
  });

  it('surfaces a locked Keychain as an error, never as "not paired", and keeps the backend', async () => {
    const exec = fakeExec(() => ({ code: 36, stderr: 'User interaction is not allowed.' }));
    const store = createDarwinCredentialStore({
      exec,
      fileDir: dir,
      keychainAvailable: () => true,
    });
    await expect(store.get('device_token')).rejects.toThrow(/exit 36/);
    await expect(store.set('device_token', SECRET)).rejects.toThrow(/exit 36/);
    expect(store.backend).toBe('keychain');
    await expect(stat(path.join(dir, 'credentials.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('finds a token a headless session left in the file when the Keychain has none', async () => {
    await createFileStore(dir).set('device_token', SECRET);
    const store = createDarwinCredentialStore({
      exec: fakeExec(() => ({ code: 44 })),
      fileDir: dir,
      keychainAvailable: () => true,
    });
    await expect(store.get('device_token')).resolves.toBe(SECRET);
  });

  it('moves a value into the Keychain on set and deletes it from both stores', async () => {
    await createFileStore(dir).set('device_token', 'old');
    const exec = fakeExec((c) => (c.args[0] === 'find-generic-password' ? { code: 44 } : {}));
    const store = createDarwinCredentialStore({
      exec,
      fileDir: dir,
      keychainAvailable: () => true,
    });
    await store.set('device_token', SECRET);
    await expect(createFileStore(dir).get('device_token')).resolves.toBeNull();

    await createFileStore(dir).set('device_token', 'stale');
    await store.delete('device_token');
    await expect(createFileStore(dir).get('device_token')).resolves.toBeNull();
    expect(exec.calls.map((c) => c.args[0])).toEqual(['-i', 'delete-generic-password']);
  });

  it('probes the Keychain only once', async () => {
    let probes = 0;
    const store = createDarwinCredentialStore({
      exec: fakeExec(() => ({ code: 44 })),
      fileDir: dir,
      keychainAvailable: () => {
        probes += 1;
        return true;
      },
    });
    await store.get('a');
    await store.get('b');
    void store.backend;
    expect(probes).toBe(1);
  });
});
