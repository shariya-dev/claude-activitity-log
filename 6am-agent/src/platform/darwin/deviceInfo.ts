import { createHash } from 'node:crypto';
import type { DeviceInfo } from '../types.js';
import { BIN, commandFailed, type ExecFn } from './exec.js';

const UUID_LINE = /"IOPlatformUUID"\s*=\s*"([^"]+)"/;
const PRODUCT_VERSION_LINE = /^ProductVersion:\s*(\S+)/m;

export function parseIoregPlatformUuid(output: string): string {
  const match = UUID_LINE.exec(output);
  if (match?.[1] === undefined) throw new Error('ioreg output has no IOPlatformUUID');
  return match[1];
}

/** Accepts `sw_vers -productVersion` output or the full `sw_vers` listing. */
export function parseSwVersProductVersion(output: string): string {
  const version = (PRODUCT_VERSION_LINE.exec(output)?.[1] ?? output).trim();
  if (version === '' || /\s/.test(version)) throw new Error('unexpected sw_vers output');
  return version;
}

/** Bonjour names end in `.local`; the dashboard shows the bare machine name. */
export function macHostname(raw: string): string {
  return raw.replace(/\.local\.?$/i, '');
}

export interface DeviceInfoDeps {
  exec: ExecFn;
  hostname: () => string;
  arch: () => string;
}

export async function readDeviceInfo(deps: DeviceInfoDeps): Promise<DeviceInfo> {
  const ioreg = await deps.exec(BIN.ioreg, ['-rd1', '-c', 'IOPlatformExpertDevice']);
  if (ioreg.code !== 0) throw commandFailed('ioreg', ioreg.code);
  const swVers = await deps.exec(BIN.swVers, ['-productVersion']);
  if (swVers.code !== 0) throw commandFailed('sw_vers', swVers.code);

  return {
    hostname: macHostname(deps.hostname()),
    platform: 'macos',
    platformVersion: parseSwVersProductVersion(swVers.stdout),
    architecture: deps.arch(),
    machineFingerprint: createHash('sha256')
      .update(parseIoregPlatformUuid(ioreg.stdout))
      .digest('hex'),
  };
}
