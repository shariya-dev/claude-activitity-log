import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  formatPlatformVersion,
  readDeviceInfo,
} from '../../../../src/platform/win32/deviceInfo.js';
import { parseRegQuery } from '../../../../src/platform/win32/registry.js';
import { FakeRunner, hasArgs } from './fakes.js';

const machineGuidOutput = [
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography',
  '    MachineGuid    REG_SZ    3F2504E0-4F89-11D3-9A0C-0305E82C3301',
  '',
].join('\r\n');

const currentVersionOutput = [
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion',
  '    SystemRoot    REG_SZ    C:\\WINDOWS',
  '    CurrentBuild    REG_SZ    26100',
  '    CurrentBuildNumber    REG_SZ    26100',
  '    DisplayVersion    REG_SZ    24H2',
  '    ProductName    REG_SZ    Windows 10 Pro',
  '    ReleaseId    REG_SZ    2009',
  '    UBR    REG_DWORD    0x1234',
  '    InstallDate    REG_DWORD    0x66d1a2b3',
  '    EditionID    REG_SZ    Professional',
  '    Empty    REG_SZ    ',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Accessibility',
  '',
].join('\r\n');

describe('parseRegQuery', () => {
  it('maps value names to data and ignores key lines and blank data', () => {
    const values = parseRegQuery(currentVersionOutput);
    expect(values.get('DisplayVersion')).toBe('24H2');
    expect(values.get('CurrentBuild')).toBe('26100');
    expect(values.get('SystemRoot')).toBe('C:\\WINDOWS');
    expect(values.get('UBR')).toBe('0x1234');
    expect(values.get('Empty')).toBe('');
    expect(values.has('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows')).toBe(false);
  });

  it('keeps data containing spaces', () => {
    expect(parseRegQuery('    ProductName    REG_SZ    Windows 11 Pro\n').get('ProductName')).toBe(
      'Windows 11 Pro',
    );
  });
});

describe('formatPlatformVersion', () => {
  it('appends the display version to os.release()', () => {
    expect(formatPlatformVersion('10.0.26100', new Map([['DisplayVersion', '24H2']]))).toBe(
      '10.0.26100 (24H2)',
    );
  });

  it('uses CurrentBuild when os.release() lacks the build', () => {
    expect(formatPlatformVersion('10.0', new Map([['CurrentBuild', '19045']]))).toBe('10.0.19045');
  });

  it('falls back to ReleaseId, then to os.release() alone', () => {
    expect(formatPlatformVersion('10.0.19041', new Map([['ReleaseId', '2004']]))).toBe(
      '10.0.19041 (2004)',
    );
    expect(formatPlatformVersion('10.0.19041', new Map())).toBe('10.0.19041');
  });

  it('never exceeds the contract limit of 64 characters', () => {
    const long = new Map([['DisplayVersion', 'x'.repeat(200)]]);
    expect(formatPlatformVersion('10.0.26100', long).length).toBeLessThanOrEqual(64);
  });
});

describe('readDeviceInfo', () => {
  const env = { SystemRoot: 'C:\\Windows' };

  function runner(): FakeRunner {
    return new FakeRunner()
      .on(hasArgs('reg.exe', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography'), {
        stdout: machineGuidOutput,
      })
      .on(hasArgs('reg.exe', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'), {
        stdout: currentVersionOutput,
      });
  }

  const system = { hostname: () => 'DEV-PC', release: () => '10.0.26100', arch: () => 'x64' };

  it('builds DeviceInfo with a sha256 of the lower-cased MachineGuid', async () => {
    const fake = runner();
    const info = await readDeviceInfo({ ...system, env, run: fake.run });
    expect(info).toEqual({
      hostname: 'DEV-PC',
      platform: 'windows',
      platformVersion: '10.0.26100 (24H2)',
      architecture: 'x64',
      machineFingerprint: createHash('sha256')
        .update('3f2504e0-4f89-11d3-9a0c-0305e82c3301')
        .digest('hex'),
    });
    expect(info.machineFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('queries the 64-bit registry view with the absolute System32 reg.exe', async () => {
    const fake = runner();
    await readDeviceInfo({ ...system, env, run: fake.run });
    expect(fake.calls.length).toBe(2);
    for (const call of fake.calls) {
      expect(call.file).toBe('C:\\Windows\\System32\\reg.exe');
      expect(call.args[0]).toBe('query');
      expect(call.args).toContain('/reg:64');
    }
    expect(fake.calls[0]?.args).toEqual([
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid',
      '/reg:64',
    ]);
  });

  it('fails clearly when MachineGuid cannot be read', async () => {
    const fake = new FakeRunner().on(hasArgs('reg.exe', 'MachineGuid'), {
      code: 1,
      stderr: 'ERROR: The system was unable to find the specified registry key or value.',
    });
    await expect(readDeviceInfo({ ...system, env, run: fake.run })).rejects.toThrow(/MachineGuid/);
  });

  it('still reports os.release() when the CurrentVersion key is unreadable', async () => {
    const fake = new FakeRunner()
      .on(hasArgs('reg.exe', 'MachineGuid'), { stdout: machineGuidOutput })
      .on(hasArgs('reg.exe', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'), {
        code: 1,
      });
    const info = await readDeviceInfo({ ...system, env, run: fake.run });
    expect(info.platformVersion).toBe('10.0.26100');
  });
});
