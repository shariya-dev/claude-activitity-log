import { describe, expect, it } from 'vitest';
import { openUrl } from '../../../../src/platform/win32/openUrl.js';
import { FakeRunner } from './fakes.js';

const env = { SystemRoot: 'C:\\Windows', TOKEN: 'secret' };

describe('openUrl', () => {
  it('runs cmd.exe start with a quoted URL and verbatim arguments', async () => {
    const fake = new FakeRunner();
    await openUrl('http://127.0.0.1:53111/pair?t=abc&x=1', { run: fake.run, env });
    expect(fake.calls).toEqual([
      {
        file: 'C:\\Windows\\System32\\cmd.exe',
        args: ['/d', '/v:off', '/s', '/c', '"start "" "http://127.0.0.1:53111/pair?t=abc&x=1""'],
        opts: { windowsVerbatimArguments: true },
      },
    ]);
  });

  it('normalises the URL so quotes are percent-encoded', async () => {
    const fake = new FakeRunner();
    await openUrl('https://monitor.example.com/a"b?q="x"', { run: fake.run, env });
    expect(fake.calls[0]?.args.at(-1)).toBe(
      '"start "" "https://monitor.example.com/a%22b?q=%22x%22""',
    );
  });

  it('rejects non-http(s) URLs', async () => {
    const fake = new FakeRunner();
    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'not a url',
    ]) {
      await expect(openUrl(url, { run: fake.run, env })).rejects.toThrow(/URL/);
    }
    expect(fake.calls).toEqual([]);
  });

  it('rejects URLs that cmd.exe would expand as environment variables', async () => {
    const fake = new FakeRunner();
    await expect(openUrl('https://example.com/?a=%token%', { run: fake.run, env })).rejects.toThrow(
      /environment variable/,
    );
    await expect(
      openUrl('https://example.com/?a=%20b%20', { run: fake.run, env }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['a dynamic cmd variable', 'http://127.0.0.1/%CD%'],
    ['a dynamic variable in lower case', 'http://127.0.0.1/?x=%random%'],
    ['an overlapping variable name', 'http://127.0.0.1/%41%TOKEN%'],
    ['substring syntax', 'http://127.0.0.1/%TOKEN:~0,3%'],
  ])('rejects %s', async (_, url) => {
    const fake = new FakeRunner();
    await expect(openUrl(url, { run: fake.run, env })).rejects.toThrow(/environment variable/);
    expect(fake.calls).toEqual([]);
  });

  it('fails when cmd.exe fails', async () => {
    const fake = new FakeRunner().on(() => true, { code: 1, stderr: 'boom' });
    await expect(openUrl('https://example.com', { run: fake.run, env })).rejects.toThrow(/boom/);
  });
});
