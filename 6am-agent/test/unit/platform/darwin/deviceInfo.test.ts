import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  macHostname,
  parseIoregPlatformUuid,
  parseSwVersProductVersion,
  readDeviceInfo,
} from '../../../../src/platform/darwin/deviceInfo.js';
import { fakeExec } from './fakeExec.js';

const UUID = '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9';

const IOREG = `+-o J316sAP  <class IOPlatformExpertDevice, id 0x100000202, registered, matched, active, busy 0 (1234 ms), retain 42>
    {
      "IOPolledInterface" = "AppleARMWatchdogTimerHibernateHandler is not serializable"
      "compatible" = <"J316sAP","MacBookPro18,1","AppleARM">
      "IOPlatformSerialNumber" = "SERIAL0000"
      "IOPlatformUUID" = "${UUID}"
      "model" = <"MacBookPro18,1">
    }
`;

const SW_VERS = 'ProductName:\t\tmacOS\nProductVersion:\t\t26.3.1\nBuildVersion:\t\t25D771280a\n';

describe('darwin device info', () => {
  it('extracts IOPlatformUUID from ioreg output', () => {
    expect(parseIoregPlatformUuid(IOREG)).toBe(UUID);
  });

  it('rejects ioreg output without IOPlatformUUID', () => {
    expect(() => parseIoregPlatformUuid('"IOPlatformSerialNumber" = "X"')).toThrow(
      /IOPlatformUUID/,
    );
  });

  it('parses the bare -productVersion output and the full sw_vers listing', () => {
    expect(parseSwVersProductVersion('26.3.1\n')).toBe('26.3.1');
    expect(parseSwVersProductVersion(SW_VERS)).toBe('26.3.1');
  });

  it('rejects empty sw_vers output', () => {
    expect(() => parseSwVersProductVersion('  \n')).toThrow(/sw_vers/);
  });

  it('strips the .local suffix from the hostname', () => {
    expect(macHostname('Devs-MacBook-Pro.local')).toBe('Devs-MacBook-Pro');
    expect(macHostname('build01.example.com')).toBe('build01.example.com');
  });

  it('builds DeviceInfo with absolute binaries and a sha256 fingerprint', async () => {
    const exec = fakeExec((c) =>
      c.file === '/usr/sbin/ioreg' ? { stdout: IOREG } : { stdout: '26.3.1\n' },
    );
    const info = await readDeviceInfo({
      exec,
      hostname: () => 'Devs-MacBook-Pro.local',
      arch: () => 'arm64',
    });
    expect(info).toEqual({
      hostname: 'Devs-MacBook-Pro',
      platform: 'macos',
      platformVersion: '26.3.1',
      architecture: 'arm64',
      machineFingerprint: createHash('sha256').update(UUID).digest('hex'),
    });
    expect(info.machineFingerprint).not.toContain(UUID);
    expect(exec.calls.map((c) => [c.file, c.args])).toEqual([
      ['/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']],
      ['/usr/bin/sw_vers', ['-productVersion']],
    ]);
  });

  it('fails when ioreg exits non-zero', async () => {
    const exec = fakeExec(() => ({ code: 1, stderr: 'boom' }));
    await expect(
      readDeviceInfo({ exec, hostname: () => 'h', arch: () => 'arm64' }),
    ).rejects.toThrow(/ioreg/);
  });
});
