import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePowerShellCommand } from '../../../../src/platform/win32/credentials.js';
import { ScheduledTaskService, TASK_NAME } from '../../../../src/platform/win32/service.js';
import { FakeRunner, MemoryFileOps, hasArgs, isBinary } from './fakes.js';

const env = { SystemRoot: 'C:\\Windows', USERDOMAIN: 'DEV-PC', USERNAME: 'Zoë' };
const appData = 'C:\\Users\\Zoë Smith\\AppData\\Local\\6amAgent';
const install = 'C:\\Users\\Zoë Smith\\AppData\\Local\\Programs\\6amAgent';
const opts = { nodePath: `${install}\\runtime\\node.exe`, entryPath: `${install}\\app\\agent.cjs` };
const sid = 'S-1-5-21-1004336348-1177238915-682003330-1001';
const schtasks = 'C:\\Windows\\System32\\schtasks.exe';

const self = { pid: 4242, execPath: opts.nodePath, entryPath: opts.entryPath };

function setup(fake: FakeRunner, current: typeof self | { pid: number; execPath: string } = self) {
  const files = new MemoryFileOps();
  const service = new ScheduledTaskService({
    run: fake.run,
    env,
    files,
    appDataDir: appData,
    self: current,
  });
  return { files, service };
}

const decodeInput = (input: string | undefined) =>
  JSON.parse(Buffer.from(input ?? '', 'base64').toString('utf8')) as unknown;

function baseRunner(): FakeRunner {
  return new FakeRunner().on(isBinary('powershell.exe'), { stdout: `${sid}\r\n` });
}

describe('ScheduledTaskService.install', () => {
  it('registers the task from a UTF-16 XML file, then starts it', async () => {
    let xmlAtCreate: Uint8Array | undefined;
    const fake = baseRunner();
    const { files, service } = setup(fake);
    fake.on(hasArgs('schtasks.exe', '/Create'), (call) => {
      xmlAtCreate = files.read(call.args[call.args.indexOf('/XML') + 1] ?? '');
      return { code: 0 };
    });

    await service.install(opts);

    const schtasksCalls = fake.calls.filter(isBinary('schtasks.exe'));
    expect(schtasksCalls.map((c) => c.file)).toEqual([schtasks, schtasks]);
    expect(schtasksCalls.map((c) => c.args)).toEqual([
      ['/Create', '/TN', TASK_NAME, '/XML', `${appData}\\6amAgent-task.xml`, '/F'],
      ['/Run', '/TN', TASK_NAME],
    ]);

    expect(xmlAtCreate).toBeDefined();
    const bytes = xmlAtCreate ?? new Uint8Array();
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    const xml = Buffer.from(bytes.subarray(2)).toString('utf16le');
    expect(xml).toContain(`<UserId>${sid}</UserId>`);
    expect(xml).toContain(`"${opts.nodePath}" "${opts.entryPath}" run`);
    expect(xml).toContain(`<WorkingDirectory>${appData}</WorkingDirectory>`);

    expect(files.read(`${appData}\\6amAgent-task.xml`)).toBeUndefined();
    expect(files.dirs.has(`${appData}\\logs`.toLowerCase())).toBe(true);
  });

  it('resolves the current user SID with PowerShell, without secrets or profile', async () => {
    const fake = baseRunner();
    await setup(fake).service.install(opts);
    const ps = fake.calls.find(isBinary('powershell.exe'));
    expect(ps?.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(ps?.args).toEqual(expect.arrayContaining(['-NoProfile', '-NonInteractive']));
    expect(decodePowerShellCommand(ps?.args ?? [])).toContain('WindowsIdentity]::GetCurrent()');
  });

  it('falls back to DOMAIN\\user when the SID cannot be resolved', async () => {
    const fake = new FakeRunner().on(isBinary('powershell.exe'), { code: 1 });
    let xml = '';
    const { files, service } = setup(fake);
    fake.on(hasArgs('schtasks.exe', '/Create'), (call) => {
      const bytes = files.read(call.args[call.args.indexOf('/XML') + 1] ?? '') ?? new Uint8Array();
      xml = Buffer.from(bytes.subarray(2)).toString('utf16le');
      return { code: 0 };
    });
    await service.install(opts);
    expect(xml).toContain('<UserId>DEV-PC\\Zoë</UserId>');
  });

  it('surfaces schtasks errors and still removes the XML file', async () => {
    const fake = baseRunner().on(hasArgs('schtasks.exe', '/Create'), {
      code: 1,
      stderr: 'ERROR: Access is denied.\r\n',
    });
    const { files, service } = setup(fake);
    await expect(service.install(opts)).rejects.toThrow(/Access is denied/);
    expect(files.read(`${appData}\\6amAgent-task.xml`)).toBeUndefined();
    expect(fake.calls.some(hasArgs('schtasks.exe', '/Run'))).toBe(false);
  });

  it('rejects relative paths before touching the scheduler', async () => {
    const fake = baseRunner();
    await expect(
      setup(fake).service.install({ nodePath: 'node.exe', entryPath: opts.entryPath }),
    ).rejects.toThrow(/absolute/);
    expect(fake.calls.filter(isBinary('schtasks.exe'))).toEqual([]);
  });
});

describe('ScheduledTaskService.uninstall', () => {
  it('ends the task, stops leftover agent processes, then deletes the task', async () => {
    const fake = new FakeRunner();
    await setup(fake).service.uninstall();
    expect(fake.calls.map((c) => [path.win32.basename(c.file), c.args[0]])).toEqual([
      ['schtasks.exe', '/End'],
      ['powershell.exe', '-NoLogo'],
      ['schtasks.exe', '/Delete'],
    ]);
    expect(fake.calls.at(-1)?.args).toEqual(['/Delete', '/TN', TASK_NAME, '/F']);
  });

  it('stops only node.exe processes of this install running this bundle, never itself', async () => {
    const fake = new FakeRunner();
    await setup(fake).service.uninstall();
    const ps = fake.calls.find(isBinary('powershell.exe'));
    const script = decodePowerShellCommand(ps?.args ?? []);
    expect(script).toContain('Win32_Process');
    expect(script).toContain('Stop-Process');
    expect(script).toContain('ExecutablePath');
    expect(script).toContain('CommandLine');
    // Paths travel as base64 UTF-8 JSON on stdin, so non-ASCII survives the console code page.
    expect(decodeInput(ps?.opts?.input)).toEqual({
      exe: opts.nodePath,
      entry: opts.entryPath,
      exclude: 4242,
    });
    expect(ps?.args.join(' ')).not.toContain('Zoë');
  });

  it('skips the process sweep when the bundle path is unknown', async () => {
    const fake = new FakeRunner();
    await setup(fake, { pid: 1, execPath: opts.nodePath }).service.uninstall();
    expect(fake.calls.some(isBinary('powershell.exe'))).toBe(false);
  });

  it('still deletes the task when stopping leftovers fails, then reports it', async () => {
    const fake = new FakeRunner().on(isBinary('powershell.exe'), { code: 1, stderr: 'denied' });
    await expect(setup(fake).service.uninstall()).rejects.toThrow(/denied/);
    expect(fake.calls.some(hasArgs('schtasks.exe', '/Delete'))).toBe(true);
  });

  it('is idempotent when the task does not exist', async () => {
    const fake = new FakeRunner().on(isBinary('schtasks.exe'), {
      code: 1,
      stderr: 'ERROR: The system cannot find the file specified.',
    });
    await expect(setup(fake).service.uninstall()).resolves.toBeUndefined();
  });

  it('fails when the task still exists after a failed delete', async () => {
    const fake = new FakeRunner()
      .on(hasArgs('schtasks.exe', '/Delete'), { code: 1, stderr: 'ERROR: Access is denied.' })
      .on(hasArgs('schtasks.exe', '/Query'), { stdout: '"\\6amAgent","N/A","Ready"\r\n' });
    await expect(setup(fake).service.uninstall()).rejects.toThrow(/Access is denied/);
  });
});

describe('ScheduledTaskService.status', () => {
  it.each([
    ['"\\6amAgent","N/A","Running"\r\n', 'running'],
    ['"\\6amAgent","N/A","Ready"\r\n', 'installed'],
    ['"\\6amAgent","N/A","Disabled"\r\n', 'installed'],
    ['\r\n"\\6amAgent","25/09/2026 09:00:00","Running"\r\n', 'running'],
  ] as const)('parses %j as %s', async (stdout, expected) => {
    const fake = new FakeRunner().on(hasArgs('schtasks.exe', '/Query'), { stdout });
    expect(await setup(fake).service.status()).toBe(expected);
    expect(fake.calls[0]?.args).toEqual(['/Query', '/TN', TASK_NAME, '/FO', 'CSV', '/NH']);
  });

  it('asks PowerShell for the non-localised state when the Status text is not English', async () => {
    for (const [state, expected] of [
      ['Running', 'running'],
      ['Ready', 'installed'],
    ] as const) {
      const fake = new FakeRunner()
        .on(hasArgs('schtasks.exe', '/Query'), {
          stdout: '"\\6amAgent","N/A","Wird ausgeführt"\r\n',
        })
        .on(isBinary('powershell.exe'), { stdout: `${state}\r\n` });
      expect(await setup(fake).service.status()).toBe(expected);
      const ps = fake.calls.find(isBinary('powershell.exe'));
      expect(decodePowerShellCommand(ps?.args ?? [])).toContain('Get-ScheduledTask');
    }
    const failing = new FakeRunner()
      .on(hasArgs('schtasks.exe', '/Query'), { stdout: '"\\6amAgent","N/A","Prêt"\r\n' })
      .on(isBinary('powershell.exe'), { code: 1 });
    expect(await setup(failing).service.status()).toBe('installed');
  });

  it('reports not-installed when the query fails', async () => {
    const fake = new FakeRunner().on(hasArgs('schtasks.exe', '/Query'), {
      code: 1,
      stderr: 'ERROR: The system cannot find the file specified.',
    });
    expect(await setup(fake).service.status()).toBe('not-installed');
  });

  it('reports unknown when schtasks cannot be run or prints nothing recognisable', async () => {
    const spawnFail = new FakeRunner().on(isBinary('schtasks.exe'), new Error('spawn ENOENT'));
    expect(await setup(spawnFail).service.status()).toBe('unknown');
    const garbage = new FakeRunner().on(isBinary('schtasks.exe'), { stdout: 'INFO: nothing' });
    expect(await setup(garbage).service.status()).toBe('unknown');
  });
});
