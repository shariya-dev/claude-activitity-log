import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  FileCheckpoint,
  ScanChunk,
  ScanOptions,
  SyncRequest,
  TrackingSettings,
} from '../../../src/core/contract/index.js';
import {
  createSettingsManager,
  type SettingsManager,
} from '../../../src/core/settings/settingsManager.js';
import {
  openStateStore,
  type KvSchema,
  type StateStore,
} from '../../../src/core/state/stateStore.js';
import { ApiError } from '../../../src/core/sync/apiClient.js';
import { createSyncManager } from '../../../src/core/sync/syncManager.js';
import { DEFAULT_CHUNK_LIMITS, type AgentInfo } from '../../../src/core/sync/types.js';
import { makeAgentInfo, sequentialUuid } from '../../helpers/fakes/agentInfo.js';
import {
  FakeApiClient,
  apiError,
  networkError,
  okSyncResponse,
  timeoutError,
} from '../../helpers/fakes/apiClient.js';
import { createMemoryLogger } from '../../helpers/fakes/logger.js';
import { FakeScanSource, emptyRecords, usageRecord } from '../../helpers/fakes/scanSource.js';
import { makeSettings } from '../../helpers/fakes/settings.js';

const NOW = new Date('2026-09-24T10:00:00.000Z');

const records = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => usageRecord(`${prefix}-${i + 1}`));

const sentIds = (reqs: SyncRequest[]) =>
  reqs.flatMap((r) => r.usage.map((u) => u.source_message_id));

describe('syncManager.runOnce', () => {
  let state: StateStore;
  let api: FakeApiClient;
  let scan: FakeScanSource;
  let settings: SettingsManager;
  let logger: ReturnType<typeof createMemoryLogger>;
  let agentInfo: Mock<() => Promise<AgentInfo>>;
  let manager: ReturnType<typeof createSyncManager>;

  const build = () =>
    createSyncManager({
      api,
      state,
      scan,
      settings,
      agentInfo,
      clock: () => NOW,
      uuid: sequentialUuid(),
      logger,
    });

  const serverSettings = (s: TrackingSettings) => {
    api.serverSettings = s;
  };

  /** Commits that carried an ack (checkpoints + cursor), as opposed to settings/error writes. */
  const ackCommits = (spy: { mock: { calls: [FileCheckpoint[], Partial<KvSchema>][] } }) =>
    spy.mock.calls.filter(([, kv]) => kv.server_cursor !== undefined);

  beforeEach(() => {
    state = openStateStore(':memory:');
    api = new FakeApiClient();
    scan = new FakeScanSource([{ path: '/p/a.jsonl', usage: records('msg_a', 2) }]);
    logger = createMemoryLogger();
    settings = createSettingsManager({ api, state, clock: () => NOW, logger });
    agentInfo = vi.fn<() => Promise<AgentInfo>>(() => Promise.resolve(makeAgentInfo()));
    manager = build();
  });

  afterEach(() => {
    state.close();
  });

  describe('first batch and request shape', () => {
    it('first batch has sequence 1, cursor null, is_initial true and the agent fields without hostname', async () => {
      const outcome = await manager.runOnce();

      expect(outcome).toEqual({ status: 'ok', batches: 1, accepted: 2, rejected: 0 });
      const req = api.syncRequests[0] as SyncRequest;
      expect(req.sync).toEqual({
        batch_id: '00000000-0000-4000-8000-000000000001',
        cursor: null,
        is_initial: true,
        settings_version: 1,
        sequence: 1,
      });
      expect(req.agent).toEqual({
        device_id: 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W',
        platform: 'macos',
        platform_version: '15.6.1',
        architecture: 'arm64',
        agent_version: '1.0.0',
        claude_code_version: '2.1.274',
      });
      expect(req.agent).not.toHaveProperty('hostname');
      expect(sentIds([req])).toEqual(['msg_a-1', 'msg_a-2']);
      expect(req.accounts).toEqual([]);
    });

    it('success stores the cursor, sequence, success time and agent_state ok; next batch echoes them', async () => {
      await manager.runOnce();
      expect(state.get('server_cursor')).toBe('cursor-1');
      expect(state.get('sync_sequence')).toBe(1);
      expect(state.get('last_success_sync_at')).toBe(NOW.toISOString());
      expect(state.get('agent_state')).toBe('ok');

      scan.append('/p/a.jsonl', usageRecord('msg_a-3'));
      await manager.runOnce();
      const second = api.syncRequests[1] as SyncRequest;
      expect(second.sync.sequence).toBe(2);
      expect(second.sync.cursor).toBe('cursor-1');
      expect(second.sync.batch_id).not.toBe(api.syncRequests[0]?.sync.batch_id);
    });

    it('passes settings, the initial-sync since and the default limits to the scanner', async () => {
      await manager.runOnce();
      const opts = scan.scanCalls[0]?.opts as ScanOptions;
      expect(opts.settings.version).toBe(1);
      expect(opts.since).toEqual(new Date('2026-09-10T09:15:42.318Z'));
      expect(opts).toMatchObject(DEFAULT_CHUNK_LIMITS);
    });

    it('initial_sync range all ⇒ since null', async () => {
      serverSettings(makeSettings({ initial_sync: { range: 'all', since: null } }));
      await manager.runOnce();
      expect(scan.scanCalls[0]?.opts.since).toBeNull();
    });

    it('is_initial stays true until the first full pass, then false', async () => {
      scan.append('/p/b.jsonl', ...records('msg_b', 1));
      api.queue('sync', (req: SyncRequest) => okSyncResponse(req), apiError('persistence_failed'));

      await manager.runOnce();
      expect(state.get('initial_sync_done')).toBeNull();
      await manager.runOnce();
      expect(state.get('initial_sync_done')).toBe(true);
      expect(api.syncRequests.map((r) => r.sync.is_initial)).toEqual([true, true, true]);

      scan.append('/p/a.jsonl', usageRecord('msg_a-3'));
      await manager.runOnce();
      expect(api.syncRequests[3]?.sync.is_initial).toBe(false);
    });
  });

  describe('commit rule (AC17)', () => {
    it('success advances exactly the chunk checkpoints and cursor + sequence in ONE commitBatch per acked chunk', async () => {
      scan.append('/p/b.jsonl', ...records('msg_b', 3));
      await settings.refreshIfNeeded();
      const spy = vi.spyOn(state, 'commitBatch');

      await manager.runOnce();

      const acks = ackCommits(spy);
      expect(acks).toHaveLength(2);
      expect(acks[0]?.[0]).toEqual([
        {
          path: '/p/a.jsonl',
          fileIdentity: 'id:/p/a.jsonl',
          size: 2,
          mtimeMs: 1_700_000_000_000,
          offset: 2,
        },
      ]);
      expect(acks[0]?.[1]).toEqual({
        server_cursor: 'cursor-1',
        last_success_sync_at: NOW.toISOString(),
        sync_sequence: 1,
        agent_state: 'ok',
      });
      expect(acks[1]?.[0]).toEqual([
        {
          path: '/p/b.jsonl',
          fileIdentity: 'id:/p/b.jsonl',
          size: 3,
          mtimeMs: 1_700_000_000_000,
          offset: 3,
        },
      ]);
      expect(acks[1]?.[1]).toMatchObject({ server_cursor: 'cursor-2', sync_sequence: 2 });
      expect([...state.checkpoints().values()].map((c) => [c.path, c.offset])).toEqual([
        ['/p/a.jsonl', 2],
        ['/p/b.jsonl', 3],
      ]);
    });

    it.each<[string, () => unknown]>([
      ['500 persistence_failed', () => apiError('persistence_failed')],
      ['timeout', () => timeoutError()],
      ['422 invalid_payload', () => apiError('invalid_payload')],
      ['network error', () => networkError()],
      ['409 batch_in_progress', () => apiError('batch_in_progress')],
      ['429 rate_limited', () => apiError('rate_limited', 7_000)],
      [
        'invalid_response',
        () => new ApiError({ code: 'invalid_response', status: 502, retryable: true }),
      ],
      [
        'batch_id mismatch in a 200',
        () => (req: SyncRequest) =>
          okSyncResponse(req, { batch_id: '11111111-1111-4111-8111-111111111111' }),
      ],
    ])('cursor and checkpoints never advance on %s', async (_name, outcome) => {
      await manager.runOnce();
      const checkpointsBefore = state.checkpoints();
      scan.append('/p/a.jsonl', usageRecord('msg_a-3'));
      api.queue('sync', outcome());
      const spy = vi.spyOn(state, 'commitBatch');

      const result = await manager.runOnce();

      expect(result.status).toBe('failed');
      expect(result.error).toBeInstanceOf(ApiError);
      expect(ackCommits(spy)).toHaveLength(0);
      expect(state.checkpoints()).toEqual(checkpointsBefore);
      expect(state.get('server_cursor')).toBe('cursor-1');
      expect(state.get('sync_sequence')).toBe(1);
      expect(state.get('last_failure_at')).toBe(NOW.toISOString());
      expect(state.get('last_error_code')).toBe(result.error?.code);
    });

    it('batch_id mismatch is reported as a retryable invalid_response', async () => {
      api.queue('sync', (req: SyncRequest) =>
        okSyncResponse(req, { batch_id: '11111111-1111-4111-8111-111111111111' }),
      );
      const result = await manager.runOnce();
      expect(result.error).toMatchObject({ code: 'invalid_response', retryable: true });
      expect(state.checkpoints().size).toBe(0);
    });
  });

  describe('batch_id reuse (contract §8.2)', () => {
    it('a retry of the same chunk reuses the same batch_id, sequence and identical records', async () => {
      api.queue('sync', apiError('persistence_failed'));
      await manager.runOnce();
      await manager.runOnce();

      const [first, retry] = api.syncRequests;
      expect(retry?.sync.batch_id).toBe(first?.sync.batch_id);
      expect(retry?.sync.sequence).toBe(1);
      expect(retry).toEqual(first);
      expect(state.get('sync_sequence')).toBe(1);
    });

    it('new data appended between runs ⇒ a new batch_id (a batch_id never carries different content)', async () => {
      api.queue('sync', networkError());
      await manager.runOnce();
      scan.append('/p/a.jsonl', usageRecord('msg_a-3'));
      await manager.runOnce();

      const [first, second] = api.syncRequests;
      expect(second?.sync.batch_id).not.toBe(first?.sync.batch_id);
      expect(second?.sync.sequence).toBe(1);
      expect(sentIds([second as SyncRequest])).toEqual(['msg_a-1', 'msg_a-2', 'msg_a-3']);
    });

    it('multi-chunk run where chunk 2 fails leaves chunk 1 committed and retries chunk 2 next run with the same batch_id', async () => {
      scan.append('/p/b.jsonl', ...records('msg_b', 2));
      scan.append('/p/c.jsonl', ...records('msg_c', 1));
      api.queue('sync', (req: SyncRequest) => okSyncResponse(req), apiError('persistence_failed'));

      const first = await manager.runOnce();
      expect(first).toMatchObject({ status: 'failed', batches: 1, accepted: 2 });
      expect(api.syncRequests).toHaveLength(2);
      expect([...state.checkpoints().keys()]).toEqual(['/p/a.jsonl']);
      expect(state.get('server_cursor')).toBe('cursor-1');

      const second = await manager.runOnce();
      expect(second).toMatchObject({ status: 'ok', batches: 2 });
      const failed = api.syncRequests[1] as SyncRequest;
      const retried = api.syncRequests[2] as SyncRequest;
      expect(retried.sync.batch_id).toBe(failed.sync.batch_id);
      expect(retried.sync.sequence).toBe(2);
      expect(sentIds([retried])).toEqual(['msg_b-1', 'msg_b-2']);
      expect(api.syncRequests[3]?.sync.sequence).toBe(3);
    });
  });

  describe('413 batch_too_large halving', () => {
    it('discards the chunk, re-scans once from the same checkpoints with halved limits and new batch_ids', async () => {
      api.queue('sync', apiError('batch_too_large'));

      const outcome = await manager.runOnce();

      expect(outcome).toMatchObject({ status: 'ok', batches: 1 });
      expect(scan.scanCalls).toHaveLength(2);
      expect(scan.scanCalls[1]?.checkpoints.size).toBe(0);
      expect(scan.scanCalls[1]?.opts).toMatchObject({
        maxUsagePerChunk: DEFAULT_CHUNK_LIMITS.maxUsagePerChunk / 2,
        maxSessionsPerChunk: DEFAULT_CHUNK_LIMITS.maxSessionsPerChunk / 2,
        maxMessagesPerChunk: DEFAULT_CHUNK_LIMITS.maxMessagesPerChunk / 2,
        maxBytesPerChunk: Math.floor(DEFAULT_CHUNK_LIMITS.maxBytesPerChunk / 2),
      });
      const [tooLarge, part] = api.syncRequests;
      expect(part?.sync.batch_id).not.toBe(tooLarge?.sync.batch_id);

      await manager.runOnce();
      expect(scan.scanCalls[2]?.opts).toMatchObject(DEFAULT_CHUNK_LIMITS);
    });

    it('parts carry their own checkpoints from the re-scan', async () => {
      scan.files = [{ path: '/p/a.jsonl', usage: records('msg_a', 3) }];
      const small = createSyncManager({
        api,
        state,
        scan: {
          scan: (cps, opts) =>
            scan.scan(cps, { ...opts, maxUsagePerChunk: opts.maxUsagePerChunk / 250 }),
          claudeCodeVersion: () => scan.claudeCodeVersion(),
          lastLocalActivityAt: () => scan.lastLocalActivityAt(),
        },
        settings,
        agentInfo,
        clock: () => NOW,
        uuid: sequentialUuid(),
        logger,
      });
      api.queue('sync', apiError('batch_too_large'));

      const outcome = await small.runOnce();

      expect(outcome).toMatchObject({ status: 'ok', batches: 3 });
      expect(api.syncRequests.slice(1).map((r) => sentIds([r]))).toEqual([
        ['msg_a-1'],
        ['msg_a-2'],
        ['msg_a-3'],
      ]);
      expect(new Set(api.syncRequests.map((r) => r.sync.batch_id)).size).toBe(4);
      expect(state.checkpoints().get('/p/a.jsonl')?.offset).toBe(3);
    });

    it('a second 413 in the same run halves again (kept for the next run) and fails', async () => {
      api.queue('sync', apiError('batch_too_large'), apiError('batch_too_large'));

      const outcome = await manager.runOnce();

      expect(outcome.status).toBe('failed');
      expect(outcome.error?.code).toBe('batch_too_large');
      expect(state.checkpoints().size).toBe(0);
      expect(state.get('last_error_code')).toBe('batch_too_large');
      expect(new Set(api.syncRequests.map((r) => r.sync.batch_id)).size).toBe(2);

      await manager.runOnce();
      expect(scan.scanCalls[2]?.opts.maxUsagePerChunk).toBe(
        DEFAULT_CHUNK_LIMITS.maxUsagePerChunk / 4,
      );
      expect(api.syncRequests[2]?.sync.batch_id).not.toBe(api.syncRequests[1]?.sync.batch_id);

      await manager.runOnce();
      expect(scan.scanCalls[3]?.opts).toMatchObject(DEFAULT_CHUNK_LIMITS);
    });

    it('halving never goes below 1 record / 1024 bytes', async () => {
      api.syncHandler = () => {
        throw apiError('batch_too_large');
      };
      for (let i = 0; i < 12; i++) await manager.runOnce();

      const last = scan.scanCalls.at(-1)?.opts as ScanOptions;
      expect(last).toMatchObject({
        maxUsagePerChunk: 1,
        maxSessionsPerChunk: 1,
        maxMessagesPerChunk: 1,
        maxBytesPerChunk: 1024,
      });
    });
  });

  describe('stopping errors (401 / 403 / 426)', () => {
    it.each([
      ['401 unauthenticated', 'unauthenticated', 'needs_repair'],
      ['403 device_disabled', 'device_disabled', 'device_disabled'],
      ['403 device_uninstalled', 'device_uninstalled', 'device_disabled'],
      ['426 agent_outdated', 'agent_outdated', 'update_required'],
    ] as const)('%s ⇒ %s, stopped, checkpoints kept', async (_name, code, agentState) => {
      await manager.runOnce();
      const before = state.checkpoints();
      scan.append('/p/a.jsonl', usageRecord('msg_a-3'));
      api.queue('sync', apiError(code));

      const outcome = await manager.runOnce();

      expect(outcome.status).toBe('stopped');
      expect(outcome.error?.code).toBe(code);
      expect(state.get('agent_state')).toBe(agentState);
      expect(state.checkpoints()).toEqual(before);
      expect(state.get('server_cursor')).toBe('cursor-1');
    });

    it('needs_repair ⇒ stopped immediately without any network call', async () => {
      state.set('agent_state', 'needs_repair');
      const outcome = await manager.runOnce();
      expect(outcome).toEqual({ status: 'stopped', batches: 0, accepted: 0, rejected: 0 });
      expect(api.calls).toHaveLength(0);
    });

    it('401 during the settings refresh ⇒ needs_repair, stopped, no sync', async () => {
      api.queue('settings', apiError('unauthenticated'));
      const outcome = await manager.runOnce();
      expect(outcome.status).toBe('stopped');
      expect(state.get('agent_state')).toBe('needs_repair');
      expect(api.count('sync')).toBe(0);
    });

    it('network error during the settings refresh ⇒ failed with the error, no sync', async () => {
      api.queue('settings', networkError());
      const outcome = await manager.runOnce();
      expect(outcome.status).toBe('failed');
      expect(outcome.error?.code).toBe('network');
      expect(api.count('sync')).toBe(0);
    });
  });

  describe('offline then online (AC14)', () => {
    it('commits nothing while offline, then catches up every record in order', async () => {
      scan.append('/p/b.jsonl', ...records('msg_b', 2));
      await settings.refreshIfNeeded();
      api.syncHandler = () => {
        throw networkError();
      };

      for (let i = 0; i < 3; i++) {
        const outcome = await manager.runOnce();
        expect(outcome.status).toBe('failed');
        if (i === 1) scan.append('/p/a.jsonl', usageRecord('msg_a-3'));
      }
      expect(state.checkpoints().size).toBe(0);
      expect(state.get('server_cursor')).toBeNull();
      expect(state.get('sync_sequence')).toBeNull();

      api.syncHandler = (req) => okSyncResponse(req);
      const sentBefore = api.syncRequests.length;
      const outcome = await manager.runOnce();

      expect(outcome).toMatchObject({ status: 'ok', batches: 2, accepted: 5 });
      expect(sentIds(api.syncRequests.slice(sentBefore))).toEqual([
        'msg_a-1',
        'msg_a-2',
        'msg_a-3',
        'msg_b-1',
        'msg_b-2',
      ]);
      expect(api.syncRequests.slice(sentBefore).map((r) => r.sync.sequence)).toEqual([1, 2]);
      expect(state.checkpoints().get('/p/a.jsonl')?.offset).toBe(3);
      expect(state.checkpoints().get('/p/b.jsonl')?.offset).toBe(2);
      expect(state.get('initial_sync_done')).toBe(true);
    });
  });

  describe('settings', () => {
    it('session category OFF ⇒ no /sync call at all', async () => {
      serverSettings(makeSettings({ categories: { session: false } }));
      const outcome = await manager.runOnce();
      expect(outcome.status).toBe('nothing');
      expect(api.count('sync')).toBe(0);
      expect(scan.scanCalls).toHaveLength(0);
    });

    it('newer settings_version in the sync response body ⇒ refetched before the next chunk, which carries it', async () => {
      scan.append('/p/b.jsonl', ...records('msg_b', 1));
      api.queue('sync', (req: SyncRequest) => {
        serverSettings(makeSettings({ version: 2 }));
        return okSyncResponse(req, { settings_version: 2 });
      });

      const outcome = await manager.runOnce();

      expect(outcome).toMatchObject({ status: 'ok', batches: 2 });
      expect(api.calls.map((c) => c.method)).toEqual(['settings', 'sync', 'settings', 'sync']);
      expect(api.syncRequests.map((r) => r.sync.settings_version)).toEqual([1, 2]);
      expect(scan.scanCalls).toHaveLength(2);
      expect(scan.scanCalls[1]?.opts.settings.version).toBe(2);
      expect(scan.scanCalls[1]?.checkpoints.get('/p/a.jsonl')?.offset).toBe(2);
    });

    it('newer X-Settings-Version header ⇒ refetched before the next chunk', async () => {
      scan.append('/p/b.jsonl', ...records('msg_b', 1));
      api.queue('sync', (req: SyncRequest) => {
        serverSettings(makeSettings({ version: 3 }));
        api.settingsVersionHeader = 3;
        return okSyncResponse(req);
      });

      await manager.runOnce();

      expect(api.syncRequests.map((r) => r.sync.settings_version)).toEqual([1, 3]);
    });

    it('settings turning session OFF mid-run stops before the next chunk', async () => {
      scan.append('/p/b.jsonl', ...records('msg_b', 1));
      api.queue('sync', (req: SyncRequest) => {
        serverSettings(makeSettings({ version: 2, categories: { session: false } }));
        return okSyncResponse(req, { settings_version: 2 });
      });

      const outcome = await manager.runOnce();

      expect(outcome).toMatchObject({ status: 'ok', batches: 1 });
      expect(api.count('sync')).toBe(1);
      expect(state.get('initial_sync_done')).toBeNull();
    });

    it('a version bump that yields the same settings version does not restart the scan', async () => {
      scan.append('/p/b.jsonl', ...records('msg_b', 1));
      api.queue('sync', (req: SyncRequest) => okSyncResponse(req, { settings_version: 2 }));

      await manager.runOnce();

      expect(scan.scanCalls).toHaveLength(1);
      expect(api.count('settings')).toBe(2);
      expect(api.count('sync')).toBe(2);
    });

    it('newer header on an error response ⇒ settings refetched, run still fails', async () => {
      api.queue('sync', () => {
        api.settingsVersionHeader = 2;
        serverSettings(makeSettings({ version: 2 }));
        throw apiError('persistence_failed');
      });

      const outcome = await manager.runOnce();

      expect(outcome.status).toBe('failed');
      expect(settings.current().version).toBe(2);
    });

    it('a failing refetch after an error response keeps the original error', async () => {
      api.queue('sync', () => {
        api.settingsVersionHeader = 2;
        throw apiError('persistence_failed');
      });
      api.queue('settings', makeSettings(), networkError());

      const outcome = await manager.runOnce();

      expect(outcome.error?.code).toBe('persistence_failed');
      expect(state.get('last_error_code')).toBe('persistence_failed');
    });

    it('a failing refetch after a success keeps the committed chunk and fails the run', async () => {
      scan.append('/p/b.jsonl', ...records('msg_b', 1));
      api.queue('sync', (req: SyncRequest) => okSyncResponse(req, { settings_version: 2 }));
      api.queue('settings', makeSettings(), apiError('agent_outdated'));

      const outcome = await manager.runOnce();

      expect(outcome).toMatchObject({ status: 'stopped', batches: 1 });
      expect(state.get('agent_state')).toBe('update_required');
      expect([...state.checkpoints().keys()]).toEqual(['/p/a.jsonl']);
    });
  });

  describe('results and failures', () => {
    it('zero-change scan ⇒ nothing, no sync call, initial sync marked done', async () => {
      scan.files = [];
      const outcome = await manager.runOnce();
      expect(outcome).toEqual({ status: 'nothing', batches: 0, accepted: 0, rejected: 0 });
      expect(api.count('sync')).toBe(0);
      expect(state.get('initial_sync_done')).toBe(true);
    });

    it('skips chunks with no records and no checkpoints but sends checkpoint-only chunks', async () => {
      const cp: FileCheckpoint = {
        path: '/p/old.jsonl',
        fileIdentity: 'id-old',
        size: 10,
        mtimeMs: 1,
        offset: 10,
      };
      const stats = { filesRead: 0, linesRead: 0, linesSkipped: 0 };
      const chunks: ScanChunk[] = [
        { records: emptyRecords(), checkpoints: [], stats },
        { records: emptyRecords(), checkpoints: [cp], stats },
      ];
      manager = createSyncManager({
        api,
        state,
        scan: {
          async *scan() {
            yield* chunks;
          },
          claudeCodeVersion: () => Promise.resolve(null),
          lastLocalActivityAt: () => Promise.resolve(null),
        },
        settings,
        agentInfo,
        clock: () => NOW,
        logger,
      });

      const outcome = await manager.runOnce();

      expect(outcome).toMatchObject({ status: 'ok', batches: 1, accepted: 0 });
      expect(api.count('sync')).toBe(1);
      expect(state.checkpoints().get('/p/old.jsonl')?.offset).toBe(10);
      expect(api.syncRequests[0]?.sync.batch_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('rejected counts are summed and logged as a count only', async () => {
      scan.append('/p/b.jsonl', ...records('msg_b', 1));
      api.syncHandler = (req) =>
        okSyncResponse(req, {
          sync: { accepted: 1, created: 1, updated: 0, rejected: 2 },
          rejected_records: [
            {
              type: 'usage',
              source_id: req.usage[0]?.source_message_id ?? '',
              reason: 'invalid_value',
            },
          ],
        });

      const outcome = await manager.runOnce();

      expect(outcome).toMatchObject({ status: 'ok', batches: 2, accepted: 2, rejected: 4 });
      const warns = logger.entries.filter((e) => e.msg === 'sync_records_rejected');
      expect(warns).toHaveLength(2);
      expect(warns[0]?.level).toBe('warn');
      expect(warns[0]?.fields).toMatchObject({ rejected: 2 });
    });

    it('422 invalid_payload logs contract_violation', async () => {
      api.queue('sync', apiError('invalid_payload'));
      await manager.runOnce();
      const entry = logger.entries.find((e) => e.msg === 'contract_violation');
      expect(entry?.level).toBe('warn');
      expect(entry?.fields).toEqual({ code: 'invalid_payload', status: 422 });
    });

    it('scanner throws ⇒ failed with internal_error, no error object, nothing committed', async () => {
      scan.failWith = new Error('boom at /Users/dev/secret-prompt-text');
      const outcome = await manager.runOnce();

      expect(outcome).toEqual({ status: 'failed', batches: 0, accepted: 0, rejected: 0 });
      expect(state.get('last_error_code')).toBe('internal_error');
      expect(state.get('last_failure_at')).toBe(NOW.toISOString());
      expect(state.checkpoints().size).toBe(0);
      expect(logger.entries.some((e) => e.level === 'error')).toBe(true);
      expect(logger.text()).not.toContain('secret-prompt-text');
    });

    it('agentInfo throws ⇒ failed with internal_error', async () => {
      agentInfo.mockRejectedValueOnce('not an error object');
      const outcome = await manager.runOnce();
      expect(outcome.status).toBe('failed');
      expect(state.get('last_error_code')).toBe('internal_error');
    });

    it('a broken state store while recording an internal error still resolves failed', async () => {
      scan.failWith = new Error('scan failed');
      await settings.refreshIfNeeded();
      vi.spyOn(state, 'commitBatch').mockImplementation(() => {
        throw new Error('disk I/O error');
      });
      await expect(manager.runOnce()).resolves.toMatchObject({ status: 'failed' });
    });

    it('logs never contain record ids, record content or the device token', async () => {
      scan.files = [{ path: '/p/a.jsonl', usage: records('msg_secret', 2) }];
      api.queue('sync', apiError('invalid_payload'), networkError(), (req: SyncRequest) =>
        okSyncResponse(req, {
          sync: { accepted: 1, created: 1, updated: 0, rejected: 1 },
          rejected_records: [{ type: 'usage', source_id: 'msg_secret-1', reason: 'invalid_value' }],
        }),
      );
      await manager.runOnce();
      await manager.runOnce();
      await manager.runOnce();

      const text = logger.text();
      expect(text).not.toContain('msg_secret');
      expect(text).not.toContain('claude-opus');
      expect(text).not.toContain('fake-device-token');
      expect(text).not.toMatch(/token/i);
    });
  });
});
