import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  machineFingerprint,
  parseOsRelease,
  platformVersion,
} from '../../../../src/platform/linux/deviceInfo.js';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

describe('parseOsRelease', () => {
  it('parses double-quoted, single-quoted and bare values and ignores comments', () => {
    const text = [
      '# comment',
      'PRETTY_NAME="Ubuntu 24.04.1 LTS"',
      "NAME='Fedora Linux'",
      'ID=ubuntu',
      '',
      'BROKEN LINE',
    ].join('\n');

    expect(parseOsRelease(text)).toEqual({
      PRETTY_NAME: 'Ubuntu 24.04.1 LTS',
      NAME: 'Fedora Linux',
      ID: 'ubuntu',
    });
  });

  it('unescapes backslash sequences inside double quotes', () => {
    expect(parseOsRelease('PRETTY_NAME="My \\"Distro\\" \\$1 \\\\ x"').PRETTY_NAME).toBe(
      'My "Distro" $1 \\ x',
    );
  });
});

describe('device info files', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'linux-device-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('uses PRETTY_NAME from the first os-release file that exists', async () => {
    writeFileSync(path.join(dir, 'usr-os-release'), 'PRETTY_NAME="Fedora Linux 41"\n');

    await expect(
      platformVersion({
        osReleasePaths: [path.join(dir, 'etc-os-release'), path.join(dir, 'usr-os-release')],
        kernelRelease: () => '6.8.0',
      }),
    ).resolves.toBe('Fedora Linux 41');
  });

  it('falls back to the kernel release when os-release is missing or has no PRETTY_NAME', async () => {
    writeFileSync(path.join(dir, 'os-release'), 'ID=arch\n');

    await expect(
      platformVersion({
        osReleasePaths: [path.join(dir, 'missing'), path.join(dir, 'os-release')],
        kernelRelease: () => '6.8.0-45-generic',
      }),
    ).resolves.toBe('6.8.0-45-generic');
  });

  it('hashes /etc/machine-id', async () => {
    writeFileSync(path.join(dir, 'machine-id'), '0123456789abcdef0123456789abcdef\n');

    await expect(
      machineFingerprint({
        machineIdPaths: [path.join(dir, 'machine-id'), path.join(dir, 'dbus-machine-id')],
        fallbackIdPath: path.join(dir, 'state', 'device-id'),
      }),
    ).resolves.toBe(sha256('0123456789abcdef0123456789abcdef'));
  });

  it('falls back to the dbus machine-id when /etc/machine-id is missing, empty or uninitialized', async () => {
    writeFileSync(path.join(dir, 'dbus-machine-id'), 'fedcba9876543210fedcba9876543210\n');

    for (const primary of [null, '', 'uninitialized\n']) {
      if (primary !== null) {
        writeFileSync(path.join(dir, 'machine-id'), primary);
      }

      await expect(
        machineFingerprint({
          machineIdPaths: [path.join(dir, 'machine-id'), path.join(dir, 'dbus-machine-id')],
          fallbackIdPath: path.join(dir, 'state', 'device-id'),
        }),
      ).resolves.toBe(sha256('fedcba9876543210fedcba9876543210'));
    }
  });

  it('persists a random id (0600) when no machine-id exists, and reuses it', async () => {
    const fallbackIdPath = path.join(dir, 'state', 'device-id');
    const opts = { machineIdPaths: [path.join(dir, 'none')], fallbackIdPath };

    const first = await machineFingerprint(opts);
    const second = await machineFingerprint(opts);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(first).toBe(sha256(readFileSync(fallbackIdPath, 'utf8').trim()));
    expect(statSync(fallbackIdPath).mode & 0o777).toBe(0o600);
  });

  it('agrees on one fallback id when two processes create it at the same time', async () => {
    const opts = {
      machineIdPaths: [path.join(dir, 'none')],
      fallbackIdPath: path.join(dir, 'state', 'device-id'),
    };

    const [a, b, c] = await Promise.all([
      machineFingerprint(opts),
      machineFingerprint(opts),
      machineFingerprint(opts),
    ]);

    expect(new Set([a, b, c]).size).toBe(1);
  });
});
