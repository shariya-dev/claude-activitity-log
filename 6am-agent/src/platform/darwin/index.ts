import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import type { PlatformAdapter } from '../types.js';
import { createDarwinCredentialStore, probeKeychain } from './credentials.js';
import { readDeviceInfo } from './deviceInfo.js';
import { BIN, commandFailed, execFileRun, type ExecFn } from './exec.js';
import { createLaunchAgentService } from './launchAgent.js';
import {
  appDataDir,
  claudeDataCandidates,
  claudeGlobalConfigCandidates,
  type Env,
  logDir,
} from './paths.js';
import { checkPermissions } from './permissions.js';

export interface DarwinAdapterDeps {
  env: Env;
  home: string;
  uid: number;
  exec: ExecFn;
  keychainAvailable: () => boolean;
  hostname: () => string;
  arch: () => string;
}

export function createAdapter(overrides: Partial<DarwinAdapterDeps> = {}): PlatformAdapter {
  const deps: DarwinAdapterDeps = {
    env: process.env,
    home: os.homedir(),
    uid: process.getuid?.() ?? os.userInfo().uid,
    exec: execFileRun,
    keychainAvailable: probeKeychain,
    hostname: os.hostname,
    arch: os.arch,
    ...overrides,
  };
  const dataDir = appDataDir(deps.home);

  return {
    id: 'macos',
    claudeDataCandidates: () => claudeDataCandidates(deps.env, deps.home),
    claudeGlobalConfigCandidates: () => claudeGlobalConfigCandidates(deps.env, deps.home),
    appDataDir: () => dataDir,
    logDir: () => logDir(deps.home),
    deviceInfo: () => readDeviceInfo(deps),
    credentials: createDarwinCredentialStore({
      exec: deps.exec,
      fileDir: dataDir,
      keychainAvailable: deps.keychainAvailable,
    }),
    service: createLaunchAgentService({
      exec: deps.exec,
      uid: deps.uid,
      home: deps.home,
      logDir: logDir(deps.home),
      sleep: (ms) => delay(ms),
    }),
    async openUrl(url) {
      if (!/^https?:\/\//i.test(url) || !URL.canParse(url)) {
        throw new Error('openUrl only opens http(s) URLs');
      }
      const res = await deps.exec(BIN.open, [url]);
      if (res.code !== 0) throw commandFailed('open', res.code);
    },
    checkPermissions: (paths) => checkPermissions(paths, deps.home),
  };
}
