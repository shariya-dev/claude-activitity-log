import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettingsManager } from '../../../src/core/settings/settingsManager.js';
import { openStateStore, type StateStore } from '../../../src/core/state/stateStore.js';
import { FakeApiClient, apiError, networkError } from '../../helpers/fakes/apiClient.js';
import { createMemoryLogger } from '../../helpers/fakes/logger.js';
import { makeSettings } from '../../helpers/fakes/settings.js';

describe('settingsManager', () => {
  let state: StateStore;
  let api: FakeApiClient;
  let now: Date;

  const manager = (maxAgeMs?: number) =>
    createSettingsManager({
      api,
      state,
      clock: () => now,
      logger: createMemoryLogger(),
      ...(maxAgeMs === undefined ? {} : { maxAgeMs }),
    });

  beforeEach(() => {
    state = openStateStore(':memory:');
    api = new FakeApiClient();
    now = new Date('2026-09-24T10:00:00.000Z');
  });

  afterEach(() => {
    state.close();
  });

  it('current() throws when no settings were ever loaded', () => {
    expect(() => manager().current()).toThrow('tracking settings not loaded');
  });

  it('first load fetches, stores settings + version + sync time in one commit, and returns true', async () => {
    api.serverSettings = makeSettings({ version: 3 });
    const m = manager();
    const commits: unknown[] = [];
    const orig = state.commitBatch.bind(state);
    state.commitBatch = (cps, kv) => {
      commits.push({ cps, kv });
      orig(cps, kv);
    };

    await expect(m.refreshIfNeeded()).resolves.toBe(true);

    expect(api.count('settings')).toBe(1);
    expect(commits).toHaveLength(1);
    expect(m.current().version).toBe(3);
    expect(state.get('settings_version')).toBe(3);
    expect(state.get('last_settings_sync_at')).toBe('2026-09-24T10:00:00.000Z');
  });

  it('does not call the API when settings are fresh and the server version is not newer', async () => {
    const m = manager();
    await m.refreshIfNeeded();
    now = new Date(now.getTime() + 60_000);

    await expect(m.refreshIfNeeded()).resolves.toBe(false);
    await expect(m.refreshIfNeeded(1)).resolves.toBe(false);
    expect(api.count('settings')).toBe(1);
  });

  it('refetches when the server reports a newer version and returns true when it changed', async () => {
    const m = manager();
    await m.refreshIfNeeded();
    api.serverSettings = makeSettings({ version: 2, categories: { device: false } });

    await expect(m.refreshIfNeeded(2)).resolves.toBe(true);
    expect(api.count('settings')).toBe(2);
    expect(m.current().version).toBe(2);
    expect(m.current().categories.device).toBe(false);
  });

  it('returns false when a version-triggered refetch still yields the same version', async () => {
    const m = manager();
    await m.refreshIfNeeded();

    await expect(m.refreshIfNeeded(5)).resolves.toBe(false);
    expect(api.count('settings')).toBe(2);
  });

  it('refetches once the stored settings are older than maxAgeMs (default 15 min)', async () => {
    const m = manager();
    await m.refreshIfNeeded();
    now = new Date(now.getTime() + 15 * 60_000 - 1);
    await expect(m.refreshIfNeeded()).resolves.toBe(false);
    expect(api.count('settings')).toBe(1);

    now = new Date(now.getTime() + 1);
    await expect(m.refreshIfNeeded()).resolves.toBe(false);
    expect(api.count('settings')).toBe(2);
    expect(state.get('last_settings_sync_at')).toBe(now.toISOString());
  });

  it('honours a custom maxAgeMs', async () => {
    const m = manager(1_000);
    await m.refreshIfNeeded();
    now = new Date(now.getTime() + 1_000);
    await m.refreshIfNeeded();
    expect(api.count('settings')).toBe(2);
  });

  it('refetches when settings exist but the sync time is missing', async () => {
    state.set('settings', makeSettings());
    state.set('settings_version', 1);
    const m = manager();

    await expect(m.refreshIfNeeded()).resolves.toBe(false);
    expect(api.count('settings')).toBe(1);
  });

  it('propagates API errors and leaves the stored settings untouched', async () => {
    const m = manager();
    await m.refreshIfNeeded();
    api.queue('settings', apiError('agent_outdated'));

    await expect(m.refreshIfNeeded(9)).rejects.toMatchObject({ code: 'agent_outdated' });
    expect(m.current().version).toBe(1);

    api.queue('settings', networkError());
    await expect(manager().refreshIfNeeded(9)).rejects.toMatchObject({ code: 'network' });
  });

  it('concurrent calls share a single in-flight fetch', async () => {
    let release: () => void = () => undefined;
    api.queue(
      'settings',
      () =>
        new Promise((resolve) => {
          release = () => resolve(makeSettings({ version: 4 }));
        }),
    );
    const m = manager();

    const a = m.refreshIfNeeded();
    const b = m.refreshIfNeeded(4);
    release();

    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(api.count('settings')).toBe(1);

    api.serverSettings = makeSettings({ version: 4 });
    await expect(m.refreshIfNeeded(5)).resolves.toBe(false);
    expect(api.count('settings')).toBe(2);
  });
});
