import { createHash } from 'node:crypto';
import type { DeviceInfo } from '../types.js';
import type { CommandRunner } from './exec.js';
import { queryRegistry } from './registry.js';

export interface DeviceInfoDeps {
  run: CommandRunner;
  env: NodeJS.ProcessEnv;
  hostname: () => string;
  release: () => string;
  arch: () => string;
}

const CRYPTOGRAPHY_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Cryptography';
const CURRENT_VERSION_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';
const PLATFORM_VERSION_MAX = 64; // sync-api-v1 `platform_version` 1..64

/** e.g. "10.0.26100 (24H2)". Windows 11 still reports "10.0"; the build number tells them apart. */
export function formatPlatformVersion(release: string, values: Map<string, string>): string {
  const build = values.get('CurrentBuild') ?? '';
  const base = /^\d+\.\d+$/.test(release) && /^\d+$/.test(build) ? `${release}.${build}` : release;
  const display = values.get('DisplayVersion') || values.get('ReleaseId') || '';
  return (display === '' ? base : `${base} (${display})`).slice(0, PLATFORM_VERSION_MAX);
}

export async function readDeviceInfo(deps: DeviceInfoDeps): Promise<DeviceInfo> {
  const guid = (await queryRegistry(deps.run, deps.env, CRYPTOGRAPHY_KEY, 'MachineGuid'))
    .get('MachineGuid')
    ?.trim()
    .toLowerCase();
  if (guid === undefined || guid === '') {
    throw new Error(`MachineGuid not found under ${CRYPTOGRAPHY_KEY}`);
  }

  let versionValues = new Map<string, string>();
  try {
    versionValues = await queryRegistry(deps.run, deps.env, CURRENT_VERSION_KEY);
  } catch {
    // The display version is cosmetic; os.release() alone is still a valid platform_version.
  }

  return {
    hostname: deps.hostname(),
    platform: 'windows',
    platformVersion: formatPlatformVersion(deps.release(), versionValues),
    architecture: deps.arch(),
    machineFingerprint: createHash('sha256').update(guid).digest('hex'),
  };
}
