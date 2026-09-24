import os from 'node:os';
import type { PlatformAdapter } from '../types.js';
import { DpapiCredentialStore } from './credentials.js';
import { readDeviceInfo } from './deviceInfo.js';
import { type CommandRunner, spawnRunner } from './exec.js';
import { type Win32FileOps, nodeFileOps } from './fileOps.js';
import { openUrl } from './openUrl.js';
import * as paths from './paths.js';
import { checkPermissions } from './permissions.js';
import { ScheduledTaskService } from './service.js';

export interface Win32Deps {
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  hostname: () => string;
  release: () => string;
  arch: () => string;
  run: CommandRunner;
  files: Win32FileOps;
  self: { pid: number; execPath: string; entryPath?: string };
}

export function createAdapter(overrides: Partial<Win32Deps> = {}): PlatformAdapter {
  const deps: Win32Deps = {
    env: process.env,
    homedir: os.homedir,
    hostname: os.hostname,
    release: os.release,
    arch: os.arch,
    run: spawnRunner,
    files: nodeFileOps,
    self: { pid: process.pid, execPath: process.execPath, entryPath: process.argv[1] },
    ...overrides,
  };
  const appDataDir = paths.appDataDir(deps);
  const shared = { run: deps.run, env: deps.env, files: deps.files, appDataDir };

  return {
    id: 'windows',
    claudeDataCandidates: () => paths.claudeDataCandidates(deps),
    claudeGlobalConfigCandidates: () => paths.claudeGlobalConfigCandidates(deps),
    appDataDir: () => appDataDir,
    logDir: () => paths.logDir(deps),
    deviceInfo: () => readDeviceInfo(deps),
    credentials: new DpapiCredentialStore(shared),
    service: new ScheduledTaskService({ ...shared, self: deps.self }),
    openUrl: (url) => openUrl(url, deps),
    checkPermissions: (list) => checkPermissions(list, deps.files, paths.currentUserName(deps.env)),
  };
}
