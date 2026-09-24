import path from 'node:path';
import { selectAdapter } from '../platform/index.js';
import type { CredentialStore, PlatformAdapter } from '../platform/types.js';
import { createFakeAdapter } from '../../test/helpers/fakeAdapter.js';
import type { EffectiveConfig } from './buildConfig.js';
import { createFileCredentialStore } from './fileCredentialStore.js';

/**
 * Picks the platform adapter and applies the dev-only overrides. `selectAdapter` stays the only
 * place that looks at the OS. The fake adapter module is replaced by a throwing stub in stable
 * builds (scripts/build.ts), and `fakeAdapter` is never true on the stable channel.
 */
export function resolveAdapter(
  config: EffectiveConfig,
  injected?: PlatformAdapter,
): PlatformAdapter {
  const base =
    injected ??
    (config.fakeAdapter
      ? createFakeAdapter(config.dataDir === null ? {} : { appDataDir: config.dataDir })
      : selectAdapter());
  if (config.dataDir === null && !config.fileCredentials) return base;

  const dataDir = config.dataDir ?? base.appDataDir();
  const logDir = config.dataDir === null ? base.logDir() : path.join(config.dataDir, 'logs');
  const credentials: CredentialStore = config.fileCredentials
    ? createFileCredentialStore(dataDir)
    : base.credentials;

  return {
    id: base.id,
    credentials,
    service: base.service,
    claudeDataCandidates: () => base.claudeDataCandidates(),
    claudeGlobalConfigCandidates: () => base.claudeGlobalConfigCandidates(),
    appDataDir: () => dataDir,
    logDir: () => logDir,
    deviceInfo: () => base.deviceInfo(),
    openUrl: (url) => base.openUrl(url),
    checkPermissions: (paths) => base.checkPermissions(paths),
  };
}
