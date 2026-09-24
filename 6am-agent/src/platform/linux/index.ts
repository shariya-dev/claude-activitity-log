import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PlatformAdapter } from '../types.js';
import { createLinuxCredentialStore } from './credentials.js';
import {
  MACHINE_ID_PATHS,
  machineFingerprint,
  OS_RELEASE_PATHS,
  platformVersion,
} from './deviceInfo.js';
import { runCommand, spawnDetached, type RunCommand, type SpawnDetached } from './exec.js';
import {
  appDataDir,
  claudeDataCandidates,
  claudeGlobalConfigCandidates,
  configHome,
  type LinuxEnv,
} from './paths.js';
import { createLinuxServiceManager } from './service.js';

export interface LinuxAdapterDeps {
  env: NodeJS.ProcessEnv;
  homedir: string;
  run: RunCommand;
  spawnDetached: SpawnDetached;
  write: (text: string) => void;
  probeSecretService?: () => boolean;
  osReleasePaths: string[];
  machineIdPaths: string[];
  hostname: () => string;
  arch: () => string;
  kernelRelease: () => string;
}

function permissionHint(code: string | undefined): string {
  if (code === 'ENOENT') {
    return 'does not exist';
  }

  if (code === 'EACCES' || code === 'EPERM') {
    return 'not readable by the agent user; check ownership and mode with `ls -ld`';
  }

  return `cannot be read (${code ?? 'unknown error'})`;
}

export function createAdapter(overrides: Partial<LinuxAdapterDeps> = {}): PlatformAdapter {
  const deps: LinuxAdapterDeps = {
    env: process.env,
    homedir: os.homedir(),
    run: runCommand,
    spawnDetached,
    write: (text) => process.stdout.write(text),
    osReleasePaths: OS_RELEASE_PATHS,
    machineIdPaths: MACHINE_ID_PATHS,
    hostname: os.hostname,
    arch: os.arch,
    kernelRelease: os.release,
    ...overrides,
  };
  const env: LinuxEnv = { env: deps.env, homedir: deps.homedir };
  const dataDir = appDataDir(env);

  return {
    id: 'linux',
    claudeDataCandidates: () => claudeDataCandidates(env),
    claudeGlobalConfigCandidates: () => claudeGlobalConfigCandidates(env),
    appDataDir: () => dataDir,
    logDir: () => path.join(dataDir, 'logs'),

    async deviceInfo() {
      return {
        hostname: deps.hostname(),
        platform: 'linux',
        platformVersion: await platformVersion({
          osReleasePaths: deps.osReleasePaths,
          kernelRelease: deps.kernelRelease,
        }),
        architecture: deps.arch(),
        machineFingerprint: await machineFingerprint({
          machineIdPaths: deps.machineIdPaths,
          fallbackIdPath: path.join(dataDir, 'device-id'),
        }),
      };
    },

    credentials: createLinuxCredentialStore({
      run: deps.run,
      dir: path.join(dataDir, 'cred'),
      ...(deps.probeSecretService ? { probeSecretService: deps.probeSecretService } : {}),
    }),

    service: createLinuxServiceManager({
      run: deps.run,
      configDir: configHome(env),
      spawnDetached: deps.spawnDetached,
    }),

    async openUrl(url) {
      const hasDisplay = Boolean(deps.env.DISPLAY || deps.env.WAYLAND_DISPLAY);

      if (!hasDisplay || !(await deps.spawnDetached('xdg-open', [url]))) {
        deps.write(`Open this URL in a browser: ${url}\n`);
      }
    },

    async checkPermissions(paths) {
      return Promise.all(
        paths.map(async (p) => {
          try {
            await access(p, constants.R_OK);
            return { path: p, readable: true };
          } catch (error) {
            return {
              path: p,
              readable: false,
              hint: permissionHint((error as NodeJS.ErrnoException).code),
            };
          }
        }),
      );
    },
  };
}
