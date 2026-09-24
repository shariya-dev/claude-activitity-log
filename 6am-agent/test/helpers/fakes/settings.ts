import type { TrackingSettings } from '../../../src/core/contract/index.js';

type SettingsOverrides = Partial<Omit<TrackingSettings, 'categories'>> & {
  categories?: Partial<TrackingSettings['categories']>;
};

/** Contract-default tracking settings (docs/contracts/examples/settings.response.json). */
export function makeSettings(o: SettingsOverrides = {}): TrackingSettings {
  const { categories, ...rest } = o;
  return {
    version: 1,
    initial_sync: { range: '7d', since: '2026-09-10T09:15:42.318Z' },
    sync_interval_seconds: 120,
    heartbeat_interval_seconds: 300,
    min_agent_version: '1.0.0',
    ...rest,
    categories: {
      session: true,
      usage: true,
      project: true,
      model: true,
      device: true,
      account: true,
      prompt: false,
      git: false,
      network: false,
      ...categories,
    },
  };
}
