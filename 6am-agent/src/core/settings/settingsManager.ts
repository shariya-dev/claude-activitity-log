import type { TrackingSettings } from '../contract/index.js';
import type { Logger } from '../runtime/logger.js';
import type { StateStore } from '../state/stateStore.js';
import type { ApiClient } from '../sync/apiClient.js';

export interface SettingsManager {
  /** The cached settings. Throws when none were ever stored (call `refreshIfNeeded` first). */
  current(): TrackingSettings;
  /** Fetches `GET /settings` when due or when `serverVersion` is newer. Resolves true if the settings changed. */
  refreshIfNeeded(serverVersion?: number): Promise<boolean>;
}

export const DEFAULT_SETTINGS_MAX_AGE_MS = 15 * 60_000;

/**
 * Settings are cached in the state store. `refreshIfNeeded` fetches `GET /settings` when nothing
 * is stored, when the server reports a newer version, or when the cache is older than `maxAgeMs`.
 * API errors propagate to the caller, which maps them to an agent state.
 */
export function createSettingsManager(d: {
  api: ApiClient;
  state: StateStore;
  clock?: () => Date;
  logger: Logger;
  maxAgeMs?: number;
}): SettingsManager {
  const clock = d.clock ?? (() => new Date());
  const maxAgeMs = d.maxAgeMs ?? DEFAULT_SETTINGS_MAX_AGE_MS;
  let inFlight: Promise<boolean> | null = null;

  const storedVersion = (stored: TrackingSettings): number =>
    d.state.get('settings_version') ?? stored.version;

  const isDue = (serverVersion: number | undefined): boolean => {
    const stored = d.state.get('settings');
    if (stored === null) return true;
    if (serverVersion !== undefined && serverVersion > storedVersion(stored)) return true;
    const syncedAt = d.state.get('last_settings_sync_at');
    if (syncedAt === null) return true;
    return clock().getTime() - new Date(syncedAt).getTime() >= maxAgeMs;
  };

  const fetchAndStore = async (): Promise<boolean> => {
    const stored = d.state.get('settings');
    const previous = stored === null ? null : storedVersion(stored);
    const settings = await d.api.settings();
    d.state.commitBatch([], {
      settings,
      settings_version: settings.version,
      last_settings_sync_at: clock().toISOString(),
    });
    const changed = previous === null || previous !== settings.version;
    if (changed) d.logger.info('settings_updated', { version: settings.version });
    return changed;
  };

  return {
    current() {
      const settings = d.state.get('settings');
      if (settings === null) throw new Error('tracking settings not loaded');
      return settings;
    },
    refreshIfNeeded(serverVersion) {
      if (inFlight !== null) return inFlight;
      if (!isDue(serverVersion)) return Promise.resolve(false);
      inFlight = fetchAndStore().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
