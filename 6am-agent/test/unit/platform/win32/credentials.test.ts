import { describe, expect, it } from 'vitest';
import {
  DpapiCredentialStore,
  decodePowerShellCommand,
} from '../../../../src/platform/win32/credentials.js';
import { FakeRunner, MemoryFileOps, type RecordedCall, isBinary } from './fakes.js';

const appData = 'C:\\Users\\Zoë Smith\\AppData\\Local\\6amAgent';
const credDir = `${appData}\\cred`;
const env = { SystemRoot: 'C:\\Windows' };
const secret = 'dev_tok|3f9 secret "quoted" äöü';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const fromB64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');

/** A fake DPAPI: "protect" reverses the bytes, which is enough to prove data round-trips. */
function dpapiRunner(): FakeRunner {
  const reverse = (input: string) =>
    Buffer.from(Buffer.from(input.trim(), 'base64').reverse()).toString('base64');
  return new FakeRunner().on(isBinary('powershell.exe'), (call) => ({
    stdout: reverse(call.opts?.input ?? ''),
  }));
}

function store(fake: FakeRunner, files = new MemoryFileOps()) {
  return {
    files,
    creds: new DpapiCredentialStore({ run: fake.run, env, files, appDataDir: appData }),
  };
}

function argvText(call: RecordedCall): string {
  return [call.file, ...call.args].join(' ');
}

describe('DpapiCredentialStore', () => {
  it('reports the dpapi backend', () => {
    expect(store(dpapiRunner()).creds.backend).toBe('dpapi');
  });

  it('round-trips a secret through DPAPI and stores only base64 ciphertext', async () => {
    const fake = dpapiRunner();
    const { creds, files } = store(fake);

    await creds.set('device_token', secret);
    const onDisk = files.readText(`${credDir}\\device_token.bin`);
    expect(onDisk).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(onDisk).not.toContain(secret);
    expect(fromB64(onDisk ?? '')).not.toContain(secret);

    expect(await creds.get('device_token')).toBe(secret);
  });

  it('never puts the secret, or its base64, in argv', async () => {
    const fake = dpapiRunner();
    const { creds } = store(fake);
    await creds.set('device_token', secret);
    await creds.get('device_token');

    expect(fake.calls.length).toBe(2);
    for (const call of fake.calls) {
      const script = decodePowerShellCommand(call.args);
      for (const text of [argvText(call), script]) {
        expect(text).not.toContain(secret);
        expect(text).not.toContain(b64(secret));
        expect(text).not.toContain('dev_tok');
      }
    }
    expect(fake.calls[0]?.opts?.input).toBe(b64(secret));
  });

  it('runs Windows PowerShell by absolute path, non-interactive, with an encoded script', async () => {
    const fake = dpapiRunner();
    await store(fake).creds.set('device_token', secret);
    const call = fake.calls[0];
    expect(call?.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(call?.args).toEqual(
      expect.arrayContaining(['-NoProfile', '-NonInteractive', '-EncodedCommand']),
    );
    const script = decodePowerShellCommand(call?.args ?? []);
    expect(script).toContain('[Security.Cryptography.ProtectedData]::Protect');
    expect(script).toContain('CurrentUser');
    expect(script).toContain('[Console]::In.ReadToEnd()');
  });

  it('writes atomically through a temp file in the cred dir', async () => {
    const fake = dpapiRunner();
    const { creds, files } = store(fake);
    await creds.set('device_token', 'one');
    await creds.set('device_token', 'two');
    expect(await creds.get('device_token')).toBe('two');
    expect([...files.files.keys()]).toEqual([`${credDir}\\device_token.bin`.toLowerCase()]);
  });

  it('round-trips an empty secret', async () => {
    const { creds } = store(dpapiRunner());
    await creds.set('device_token', '');
    expect(await creds.get('device_token')).toBe('');
  });

  it('returns null for a missing key without spawning PowerShell', async () => {
    const fake = dpapiRunner();
    expect(await store(fake).creds.get('device_token')).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it('deletes a key, and deleting a missing key is a no-op', async () => {
    const fake = dpapiRunner();
    const { creds } = store(fake);
    await creds.set('device_token', secret);
    await creds.delete('device_token');
    await creds.delete('device_token');
    expect(await creds.get('device_token')).toBeNull();
  });

  it('rejects keys that could escape the cred dir', async () => {
    const { creds } = store(dpapiRunner());
    for (const key of ['', '..', '..\\x', 'a/b', 'a:b', '.hidden', 'CON']) {
      await expect(creds.set(key, 'v')).rejects.toThrow(/credential key/);
    }
  });

  it('fails without echoing PowerShell output when DPAPI fails', async () => {
    const fake = new FakeRunner().on(isBinary('powershell.exe'), {
      code: 1,
      stdout: 'partial-output',
      stderr: 'Exception calling "Unprotect": The data is invalid.',
    });
    const files = new MemoryFileOps();
    files.addFile(`${credDir}\\device_token.bin`, 'AAAA');
    const { creds } = store(fake, files);
    const error = await creds.get('device_token').then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toMatch(/DPAPI/);
    expect(error?.message).not.toContain('partial-output');
  });

  it('rejects non-base64 output from PowerShell', async () => {
    const fake = new FakeRunner().on(isBinary('powershell.exe'), { stdout: 'not base64!' });
    await expect(store(fake).creds.set('device_token', secret)).rejects.toThrow(/DPAPI/);
  });
});
