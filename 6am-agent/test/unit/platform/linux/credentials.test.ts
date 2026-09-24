import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFileCredentialStore,
  createLinuxCredentialStore,
  secretServiceReachable,
} from '../../../../src/platform/linux/credentials.js';
import { fakeRun } from './fakeRun.js';

const SECRET = 'dev_tok_s3cr3t_value';

describe('file-0600 credential store', () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'linux-cred-'));
    dir = path.join(root, 'state', '6am-agent', 'cred');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes the secret to a 0600 file inside a 0700 dir and reads it back', async () => {
    const store = createFileCredentialStore(dir);

    await store.set('device_token', SECRET);

    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(dir, 'device_token')).mode & 0o777).toBe(0o600);
    await expect(store.get('device_token')).resolves.toBe(SECRET);
    expect(store.backend).toBe('file-0600');
  });

  it('tightens an existing dir and file that are too open', async () => {
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    writeFileSync(path.join(dir, 'device_token'), 'old', { mode: 0o644 });

    await createFileCredentialStore(dir).set('device_token', SECRET);

    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(dir, 'device_token')).mode & 0o777).toBe(0o600);
  });

  it('returns null for a missing key and deletes idempotently', async () => {
    const store = createFileCredentialStore(dir);

    await expect(store.get('device_token')).resolves.toBeNull();
    await store.set('device_token', SECRET);
    await store.delete('device_token');
    await store.delete('device_token');

    await expect(store.get('device_token')).resolves.toBeNull();
    expect(existsSync(path.join(dir, 'device_token'))).toBe(false);
  });

  it('rejects keys that could escape the credential dir', async () => {
    const store = createFileCredentialStore(dir);

    for (const key of ['../x', 'a/b', '..', '.', '']) {
      await expect(store.set(key, SECRET)).rejects.toThrow('Invalid credential key');
    }
  });
});

describe('secret service probe', () => {
  it('is reachable when lookup exits 0 or exits 1 silently (item not found)', () => {
    expect(secretServiceReachable({ status: 0, stderr: '' })).toBe(true);
    expect(secretServiceReachable({ status: 1, stderr: '' })).toBe(true);
  });

  it('is unreachable when secret-tool is missing, errors, or times out', () => {
    expect(secretServiceReachable({ status: null, stderr: '' })).toBe(false);
    expect(
      secretServiceReachable({
        status: 1,
        stderr: 'secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY',
      }),
    ).toBe(false);
  });
});

describe('linux credential store', () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'linux-cred-'));
    dir = path.join(root, 'cred');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stores via secret-tool with the secret on stdin, never in argv', async () => {
    const { run, calls } = fakeRun();
    const store = createLinuxCredentialStore({ run, dir, probeSecretService: () => true });

    await store.set('device_token', SECRET);

    expect(store.backend).toBe('libsecret');
    expect(calls).toEqual([
      {
        cmd: 'secret-tool',
        args: ['store', '--label=6amAgent', 'service', 'com.6amtech.agent', 'key', 'device_token'],
        input: SECRET,
      },
    ]);
    expect(calls.flatMap((c) => c.args).join(' ')).not.toContain(SECRET);
    expect(existsSync(path.join(dir, 'device_token'))).toBe(false);
  });

  it('looks up and clears via secret-tool', async () => {
    const { run, calls } = fakeRun((call) =>
      call.args[0] === 'lookup' ? { stdout: SECRET } : undefined,
    );
    const store = createLinuxCredentialStore({ run, dir, probeSecretService: () => true });

    await expect(store.get('device_token')).resolves.toBe(SECRET);
    await store.delete('device_token');

    expect(calls.map((c) => c.args)).toEqual([
      ['lookup', 'service', 'com.6amtech.agent', 'key', 'device_token'],
      ['clear', 'service', 'com.6amtech.agent', 'key', 'device_token'],
    ]);
  });

  it('falls back to the file store for a secret-service miss (e.g. paired headless)', async () => {
    const { run } = fakeRun((call) => (call.args[0] === 'lookup' ? { code: 1 } : undefined));
    await createFileCredentialStore(dir).set('device_token', SECRET);
    const store = createLinuxCredentialStore({ run, dir, probeSecretService: () => true });

    await expect(store.get('device_token')).resolves.toBe(SECRET);
  });

  it('uses the 0600 file store and never calls secret-tool without a secret service', async () => {
    const { run, calls } = fakeRun();
    const store = createLinuxCredentialStore({ run, dir, probeSecretService: () => false });

    await store.set('device_token', SECRET);

    expect(store.backend).toBe('file-0600');
    await expect(store.get('device_token')).resolves.toBe(SECRET);
    expect(statSync(path.join(dir, 'device_token')).mode & 0o777).toBe(0o600);
    expect(calls).toEqual([]);
  });

  it('falls back to the file store when secret-tool store fails (locked keyring)', async () => {
    const { run } = fakeRun((call) =>
      call.args[0] === 'store' ? { code: 1, stderr: 'Cannot create an item' } : { code: 1 },
    );
    const store = createLinuxCredentialStore({ run, dir, probeSecretService: () => true });

    await store.set('device_token', SECRET);

    expect(store.backend).toBe('file-0600');
    await expect(store.get('device_token')).resolves.toBe(SECRET);
  });

  it('removes a stale file copy when the secret service takes the secret', async () => {
    await createFileCredentialStore(dir).set('device_token', 'old');
    const { run } = fakeRun();

    await createLinuxCredentialStore({ run, dir, probeSecretService: () => true }).set(
      'device_token',
      SECRET,
    );

    expect(existsSync(path.join(dir, 'device_token'))).toBe(false);
  });

  it('deletes from both stores', async () => {
    await createFileCredentialStore(dir).set('device_token', SECRET);
    const { run, calls } = fakeRun();

    await createLinuxCredentialStore({ run, dir, probeSecretService: () => true }).delete(
      'device_token',
    );

    expect(calls.map((c) => c.args[0])).toEqual(['clear']);
    expect(existsSync(path.join(dir, 'device_token'))).toBe(false);
  });

  it('returns the file copy when the secret service errors', async () => {
    await createFileCredentialStore(dir).set('device_token', SECRET);
    const { run } = fakeRun(() => ({ code: 1, stderr: 'Cannot prompt: no display' }));
    const store = createLinuxCredentialStore({ run, dir, probeSecretService: () => true });

    await expect(store.get('device_token')).resolves.toBe(SECRET);
  });

  it('throws instead of reporting "not paired" when the secret service errors and no file exists', async () => {
    const { run } = fakeRun(() => ({ code: 1, stderr: 'Cannot prompt: no display' }));
    const store = createLinuxCredentialStore({ run, dir, probeSecretService: () => true });

    await expect(store.get('device_token')).rejects.toThrow('Cannot prompt: no display');
  });

  it('keeps a reachable probe result and re-probes an unreachable one after a minute', async () => {
    let now = 0;
    let reachable = false;
    let probes = 0;
    const { run } = fakeRun((call) => (call.args[0] === 'lookup' ? { code: 1 } : undefined));
    const store = createLinuxCredentialStore({
      run,
      dir,
      now: () => now,
      probeSecretService: () => {
        probes += 1;
        return reachable;
      },
    });

    expect(store.backend).toBe('file-0600');
    await store.get('a');
    expect(probes).toBe(1);

    now = 61_000;
    reachable = true;
    expect(store.backend).toBe('libsecret');
    await store.get('a');
    now = 10_000_000;
    void store.backend;

    expect(probes).toBe(2);
  });
});
