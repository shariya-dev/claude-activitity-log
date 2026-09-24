/**
 * Contract §8.2 with Account ON (e2e finding F1): a retry re-scans the same data from the same
 * checkpoints, so the chunk — including `AccountRecord.observed_at` — must be byte-identical no
 * matter how much wall-clock time passed, and the sync manager must reuse the batch_id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClaudeScanner } from '../../../src/core/claude/scanner.js';
import type { ScanChunk, SyncRequest } from '../../../src/core/contract/index.js';
import { createSettingsManager } from '../../../src/core/settings/settingsManager.js';
import { openStateStore, type StateStore } from '../../../src/core/state/stateStore.js';
import { createSyncManager } from '../../../src/core/sync/syncManager.js';
import { makeAgentInfo, sequentialUuid } from '../../helpers/fakes/agentInfo.js';
import { FakeApiClient, networkError } from '../../helpers/fakes/apiClient.js';
import { createMemoryLogger } from '../../helpers/fakes/logger.js';
import { makeSettings } from '../../helpers/fakes/settings.js';
import {
  addTranscript,
  collect,
  DEVICE_UID,
  makeClaudeDir,
  scanOptions,
  sid,
  type ClaudeDir,
} from './helpers.js';

const START = new Date('2026-09-24T10:00:00.000Z');

/** Moves the system clock (`Date` only: timers and fs stay real). */
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

async function claudeDir(): Promise<ClaudeDir> {
  const dir = await makeClaudeDir();
  await addTranscript(dir, 'basic-session.jsonl', sid(1));
  await addTranscript(dir, 'multi-model.jsonl', sid(3));
  return dir;
}

const newestLastSeen = (chunk: ScanChunk): string =>
  chunk.records.sessions.map((s) => s.last_seen_at).reduce((a, b) => (b > a ? b : a));

describe('claude scanner — account observed_at is derived from the data (contract §8.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('two scans of unchanged data with the clock moved give identical accounts[]', async () => {
    const dir = await claudeDir();
    const sc = createClaudeScanner({
      source: dir.source,
      deviceUid: () => DEVICE_UID,
      readGitRemote: async () => null,
    });
    const first = await collect(sc);
    advance(3 * 60 * 60 * 1000);
    const second = await collect(sc);

    expect(first.length).toBeGreaterThan(0);
    expect(first.flatMap((c) => c.records.accounts)).toHaveLength(first.length);
    expect(JSON.stringify(second.map((c) => c.records))).toBe(
      JSON.stringify(first.map((c) => c.records)),
    );
  });

  it("stamps each chunk's account with the newest activity among that chunk's sessions", async () => {
    const dir = await claudeDir();
    const sc = createClaudeScanner({
      source: dir.source,
      deviceUid: () => DEVICE_UID,
      readGitRemote: async () => null,
    });
    const chunks = await collect(sc, new Map(), scanOptions({ maxSessionsPerChunk: 1 }));

    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(chunk.records.accounts).toHaveLength(1);
      expect(chunk.records.accounts[0]!.observed_at).toBe(newestLastSeen(chunk));
    }
    expect(chunks[0]!.records.accounts[0]!.observed_at).not.toBe(
      chunks[1]!.records.accounts[0]!.observed_at,
    );
  });

  describe('through the sync manager', () => {
    let state: StateStore;
    afterEach(() => state.close());

    it('a failed sync retried later with unchanged data reuses the batch_id and identical bytes', async () => {
      const dir = await claudeDir();
      const clock = () => new Date();
      const api = new FakeApiClient();
      api.serverSettings = makeSettings({ initial_sync: { range: 'all', since: null } });
      state = openStateStore(':memory:');
      const logger = createMemoryLogger();
      const manager = createSyncManager({
        api,
        state,
        scan: createClaudeScanner({
          source: dir.source,
          deviceUid: () => DEVICE_UID,
          readGitRemote: async () => null,
        }),
        settings: createSettingsManager({ api, state, clock, logger }),
        agentInfo: () => Promise.resolve(makeAgentInfo()),
        clock,
        uuid: sequentialUuid(),
        logger,
      });

      api.queue('sync', networkError());
      expect((await manager.runOnce()).status).toBe('failed');
      advance(90 * 1000);
      expect((await manager.runOnce()).status).toBe('ok');

      const [first, retry] = api.syncRequests as [SyncRequest, SyncRequest];
      expect(first.accounts).toHaveLength(1);
      expect(retry.sync.batch_id).toBe(first.sync.batch_id);
      expect(JSON.stringify(retry)).toBe(JSON.stringify(first));
    });
  });
});
