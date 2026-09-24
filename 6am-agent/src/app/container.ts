import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { discoverClaudeData, type ClaudeDataSource } from '../core/claude/discovery.js';
import { createClaudeScanner } from '../core/claude/scanner.js';
import type { ScanSource } from '../core/contract/index.js';
import { createAgentRuntime } from '../core/runtime/agentRuntime.js';
import { createLogger, type Logger } from '../core/runtime/logger.js';
import { createSettingsManager, type SettingsManager } from '../core/settings/settingsManager.js';
import { openStateStore, type StateStore } from '../core/state/stateStore.js';
import { createApiClient, type ApiClient } from '../core/sync/apiClient.js';
import { createSyncManager, type SyncManager, type SyncOutcome } from '../core/sync/syncManager.js';
import type { AgentInfo } from '../core/sync/types.js';
import type { DeviceInfo, PlatformAdapter } from '../platform/types.js';
import { AGENT_VERSION } from '../cli/version.js';
import { resolveAdapter } from './adapter.js';
import { applyDevOverrides, loadBuildConfig, type BuildConfig } from './buildConfig.js';

export type { BuildConfig } from './buildConfig.js';

/** Key of the device token in `adapter.credentials`. The token never goes anywhere else. */
export const DEVICE_TOKEN_KEY = 'device_token';
export const API_PATH = '/api/agent/v1';

export interface AgentPaths {
  appDataDir: string;
  logDir: string;
  stateDb: string;
  lockFile: string;
  syncRequestFile: string;
  pairingUrlFile: string;
}

/** Records carried by acknowledged syncs since the counter was last reset (pairing progress). */
export interface SyncCounters {
  sessions: number;
  usage: number;
}

export interface AgentContainer {
  adapter: PlatformAdapter;
  state: StateStore;
  api: ApiClient;
  runtime: ReturnType<typeof createAgentRuntime>;
  /** The discovered Claude data dir; null until `discover()` finds one. */
  source: ClaudeDataSource | null;
  logger: Logger;
  buildConfig: BuildConfig;
  /** The API base URL after dev overrides (host only; `API_PATH` is appended for requests). */
  apiBaseUrl: string;
  paths: AgentPaths;
  settings: SettingsManager;
  sync: SyncManager;
  counters: SyncCounters;
  agentInfo(): Promise<AgentInfo>;
  deviceInfo(): Promise<DeviceInfo>;
  /** Re-runs Claude data discovery and points the scanner at the result. */
  discover(): Promise<ClaudeDataSource | null>;
  /**
   * One sync: through the runtime when it is running (never two syncs at once; resolves null once
   * it finished), else in-process (resolves the outcome).
   */
  syncOnce(): Promise<SyncOutcome | null>;
  close(): void;
}

/** Wraps an ApiClient to count records of acknowledged syncs. Nothing else is observed. */
function countingApi(api: ApiClient, counters: SyncCounters): ApiClient {
  return {
    register: (req) => api.register(req),
    heartbeat: (req) => api.heartbeat(req),
    settings: () => api.settings(),
    async sync(req) {
      const resp = await api.sync(req);
      counters.sessions += req.sessions.length;
      counters.usage += req.usage.length;
      return resp;
    },
    syncStatus: () => api.syncStatus(),
    deregister: () => api.deregister(),
    lastSettingsVersion: () => api.lastSettingsVersion(),
  };
}

const SYNC_POLL_MS = 250;

function defaultBuildConfigPath(): string {
  const entry = process.argv[1];
  return path.join(entry === undefined ? process.cwd() : path.dirname(entry), 'build-config.json');
}

/**
 * Composition root: loads build-config.json (next to agent.cjs), applies dev-only overrides,
 * selects the adapter and wires the H09 reader and H10 engine to it. Nothing starts running here.
 */
export async function createContainer(
  o: { adapter?: PlatformAdapter; buildConfigPath?: string; fetchImpl?: typeof fetch } = {},
): Promise<AgentContainer> {
  const buildConfig = loadBuildConfig(o.buildConfigPath ?? defaultBuildConfigPath());
  const effective = applyDevOverrides(buildConfig);
  const adapter = resolveAdapter(effective, o.adapter);

  const appDataDir = adapter.appDataDir();
  const logDir = adapter.logDir();
  mkdirSync(appDataDir, { recursive: true, mode: 0o700 });
  const paths: AgentPaths = {
    appDataDir,
    logDir,
    stateDb: path.join(appDataDir, 'state.db'),
    lockFile: path.join(appDataDir, 'agent.lock'),
    syncRequestFile: path.join(appDataDir, 'sync-request'),
    pairingUrlFile: path.join(appDataDir, 'pairing-url'),
  };

  const logger = createLogger({ dir: logDir });
  const state = openStateStore(paths.stateDb);
  const counters: SyncCounters = { sessions: 0, usage: 0 };
  const api = countingApi(
    createApiClient({
      baseUrl: `${effective.apiBaseUrl.replace(/\/+$/, '')}${API_PATH}`,
      getToken: () => adapter.credentials.get(DEVICE_TOKEN_KEY),
      ...(o.fetchImpl === undefined ? {} : { fetchImpl: o.fetchImpl }),
      userAgent: `6am-agent/${AGENT_VERSION} (${adapter.id}; ${process.arch})`,
      logger,
    }),
    counters,
  );
  const settings = createSettingsManager({ api, state, logger });

  let scanner: ScanSource | null = null;
  const scan: ScanSource = {
    async *scan(checkpoints, opts) {
      if (scanner !== null) yield* scanner.scan(checkpoints, opts);
    },
    claudeCodeVersion: () =>
      scanner === null ? Promise.resolve(null) : scanner.claudeCodeVersion(),
    lastLocalActivityAt: () =>
      scanner === null ? Promise.resolve(null) : scanner.lastLocalActivityAt(),
  };

  let deviceInfoCache: Promise<DeviceInfo> | null = null;
  const deviceInfo = (): Promise<DeviceInfo> => {
    deviceInfoCache ??= adapter.deviceInfo().catch((err: unknown) => {
      deviceInfoCache = null;
      throw err;
    });
    return deviceInfoCache;
  };

  const agentInfo = async (): Promise<AgentInfo> => {
    const info = await deviceInfo();
    return {
      device_id: state.get('device_uid') ?? '',
      platform: adapter.id,
      platform_version: info.platformVersion === '' ? null : info.platformVersion.slice(0, 64),
      architecture: info.architecture,
      agent_version: AGENT_VERSION,
      claude_code_version: await scan.claudeCodeVersion(),
      hostname: info.hostname === '' ? null : info.hostname.slice(0, 191),
    };
  };

  const sync = createSyncManager({ api, state, scan, settings, agentInfo, logger });
  const runtime = createAgentRuntime({ sync, api, state, settings, scan, agentInfo, logger });

  const container: AgentContainer = {
    adapter,
    state,
    api,
    runtime,
    source: null,
    logger,
    buildConfig,
    apiBaseUrl: effective.apiBaseUrl,
    paths,
    settings,
    sync,
    counters,
    agentInfo,
    deviceInfo,
    async discover() {
      const found = await discoverClaudeData(
        adapter.claudeDataCandidates(),
        adapter.claudeGlobalConfigCandidates(),
      );
      const changed = found?.dataDir !== container.source?.dataDir;
      if (changed || (found !== null && scanner === null)) {
        scanner =
          found === null
            ? null
            : createClaudeScanner({
                source: found,
                deviceUid: () => state.get('device_uid') ?? '',
              });
        container.source = found;
        logger.info('claude_data_discovery', { found: found !== null });
      }
      return found;
    },
    async syncOnce() {
      if (!runtime.status().running) return sync.runOnce();
      runtime.requestSync();
      while (runtime.status().syncing) {
        await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_MS));
      }
      return null;
    },
    close() {
      state.close();
    },
  };
  return container;
}
