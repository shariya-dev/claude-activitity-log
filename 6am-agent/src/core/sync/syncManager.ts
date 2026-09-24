import { createHash, randomUUID } from 'node:crypto';
import type {
  ScanChunk,
  ScanSource,
  SyncAgent,
  SyncRequest,
  TrackingSettings,
} from '../contract/index.js';
import type { Logger } from '../runtime/logger.js';
import type { SettingsManager } from '../settings/settingsManager.js';
import type { StateStore } from '../state/stateStore.js';
import { ApiError, type ApiClient } from './apiClient.js';
import { applyApiErrorState, blocksSync } from './errorPolicy.js';
import { DEFAULT_CHUNK_LIMITS, type AgentInfo, type ChunkLimits } from './types.js';

export interface SyncOutcome {
  status: 'ok' | 'nothing' | 'failed' | 'stopped';
  batches: number;
  accepted: number;
  rejected: number;
  error?: ApiError;
}

export interface SyncManager {
  runOnce(): Promise<SyncOutcome>;
}

/** The last batch sent but not acknowledged: a retry of identical content reuses its identity. */
interface PendingBatch {
  fingerprint: string;
  batchId: string;
  sequence: number;
}

type PassResult = { kind: 'done' } | { kind: 'restart' } | { kind: 'error'; error: ApiError };

const MIN_RECORD_LIMIT = 1;
const MIN_BYTES_LIMIT = 1024;

function halve(limits: ChunkLimits): ChunkLimits {
  const half = (n: number, min: number) => Math.max(min, Math.floor(n / 2));
  return {
    maxUsagePerChunk: half(limits.maxUsagePerChunk, MIN_RECORD_LIMIT),
    maxSessionsPerChunk: half(limits.maxSessionsPerChunk, MIN_RECORD_LIMIT),
    maxMessagesPerChunk: half(limits.maxMessagesPerChunk, MIN_RECORD_LIMIT),
    maxBytesPerChunk: half(limits.maxBytesPerChunk, MIN_BYTES_LIMIT),
  };
}

function isEmptyChunk(chunk: ScanChunk): boolean {
  const r = chunk.records;
  return (
    chunk.checkpoints.length === 0 &&
    r.accounts.length === 0 &&
    r.projects.length === 0 &&
    r.sessions.length === 0 &&
    r.usage.length === 0 &&
    r.messages.length === 0
  );
}

function toSyncAgent(info: AgentInfo): SyncAgent {
  return {
    device_id: info.device_id,
    platform: info.platform,
    platform_version: info.platform_version,
    architecture: info.architecture,
    agent_version: info.agent_version,
    claude_code_version: info.claude_code_version,
  };
}

/** Error name (and errno-style code) only: messages may quote file contents or paths. */
function describeInternalError(err: unknown): Record<string, string> {
  if (!(err instanceof Error)) return { error: typeof err };
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? { error: err.name, code } : { error: err.name };
}

/**
 * One sync cycle (contract §7–§9): scan from the committed checkpoints, send each chunk, and commit
 * its checkpoints together with the server cursor only after a `200 success:true` whose batch_id
 * matches. Any failure stops the run without committing; the runtime schedules the backoff.
 */
export function createSyncManager(d: {
  api: ApiClient;
  state: StateStore;
  scan: ScanSource;
  settings: SettingsManager;
  agentInfo: () => Promise<AgentInfo>;
  clock?: () => Date;
  uuid?: () => string;
  logger: Logger;
}): SyncManager {
  const clock = d.clock ?? (() => new Date());
  const uuid = d.uuid ?? randomUUID;
  let limits: ChunkLimits = { ...DEFAULT_CHUNK_LIMITS };
  let pending: PendingBatch | null = null;

  /** Refetches settings when `version` is newer than the cached one. True if they changed. */
  const refreshIfNewer = async (version: number): Promise<boolean> => {
    if (version <= d.settings.current().version) return false;
    return d.settings.refreshIfNeeded(version);
  };

  const refreshAfterError = async (): Promise<void> => {
    try {
      await refreshIfNewer(d.api.lastSettingsVersion() ?? 0);
    } catch (err) {
      d.logger.warn('settings_refresh_failed', {
        code: err instanceof ApiError ? err.code : 'internal_error',
      });
    }
  };

  const identify = (req: SyncRequest, chunk: ScanChunk): { batchId: string; sequence: number } => {
    const { cursor, is_initial, settings_version } = req.sync;
    const meta = { cursor, is_initial, settings_version };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ ...req, sync: meta, checkpoints: chunk.checkpoints }))
      .digest('hex');
    if (pending?.fingerprint === fingerprint) return pending;
    const next: PendingBatch = {
      fingerprint,
      batchId: uuid(),
      sequence: (d.state.get('sync_sequence') ?? 0) + 1,
    };
    pending = next;
    return next;
  };

  return {
    async runOnce() {
      const totals = { batches: 0, accepted: 0, rejected: 0 };
      const result = (status: SyncOutcome['status'], error?: ApiError): SyncOutcome =>
        error === undefined ? { status, ...totals } : { status, ...totals, error };
      const finished = () => result(totals.batches > 0 ? 'ok' : 'nothing');

      const sendChunk = async (
        chunk: ScanChunk,
        settings: TrackingSettings,
        agent: SyncAgent,
      ): Promise<PassResult | null> => {
        // Settings changed since this pass was scanned (e.g. by a heartbeat): discard the chunk
        // unsent and re-scan with the new settings (contract §5: settings apply at scan time).
        if (d.settings.current().version !== settings.version) return { kind: 'restart' };
        const req: SyncRequest = {
          agent,
          sync: {
            batch_id: '',
            cursor: d.state.get('server_cursor'),
            is_initial: d.state.get('initial_sync_done') !== true,
            settings_version: settings.version,
            sequence: 0,
          },
          accounts: chunk.records.accounts,
          projects: chunk.records.projects,
          sessions: chunk.records.sessions,
          usage: chunk.records.usage,
          messages: chunk.records.messages,
        };
        const { batchId, sequence } = identify(req, chunk);
        req.sync.batch_id = batchId;
        req.sync.sequence = sequence;

        let resp;
        try {
          resp = await d.api.sync(req);
          if (resp.batch_id !== batchId) {
            throw new ApiError({
              code: 'invalid_response',
              status: 200,
              retryable: true,
              message: 'sync response batch_id does not match the request',
            });
          }
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          if (err.code === 'batch_too_large') pending = null;
          await refreshAfterError();
          return { kind: 'error', error: err };
        }

        d.state.commitBatch(chunk.checkpoints, {
          server_cursor: resp.cursor,
          last_success_sync_at: clock().toISOString(),
          sync_sequence: sequence,
        });
        pending = null;
        totals.batches += 1;
        totals.accepted += resp.sync.accepted;
        totals.rejected += resp.sync.rejected;
        if (resp.sync.rejected > 0) {
          d.logger.warn('sync_records_rejected', {
            batch_id: batchId,
            rejected: resp.sync.rejected,
          });
        }

        const version = Math.max(resp.settings_version, d.api.lastSettingsVersion() ?? 0);
        await refreshIfNewer(version);
        return d.settings.current().version === settings.version ? null : { kind: 'restart' };
      };

      const pass = async (settings: TrackingSettings, agent: SyncAgent): Promise<PassResult> => {
        const { range, since } = settings.initial_sync;
        const chunks = d.scan.scan(d.state.checkpoints(), {
          settings,
          since: range === 'all' || since === null ? null : new Date(since),
          ...limits,
        });
        for await (const chunk of chunks) {
          if (isEmptyChunk(chunk)) continue;
          const outcome = await sendChunk(chunk, settings, agent);
          if (outcome !== null) return outcome;
        }
        return { kind: 'done' };
      };

      const onApiError = (err: ApiError): SyncOutcome => {
        if (err.code === 'invalid_payload') {
          d.logger.warn('contract_violation', { code: err.code, status: err.status });
        } else {
          d.logger.warn('sync_failed', { code: err.code, status: err.status });
        }
        return result(applyApiErrorState(d.state, err, clock()), err);
      };

      try {
        if (blocksSync(d.state.get('agent_state'))) return result('stopped');
        await d.settings.refreshIfNeeded();
        const agent = toSyncAgent(await d.agentInfo());
        let retriedTooLarge = false;

        for (;;) {
          const settings = d.settings.current();
          if (!settings.categories.session) return finished();

          const outcome = await pass(settings, agent);
          if (outcome.kind === 'restart') continue;
          if (outcome.kind === 'done') {
            if (d.state.get('initial_sync_done') !== true) d.state.set('initial_sync_done', true);
            limits = { ...DEFAULT_CHUNK_LIMITS };
            return finished();
          }
          if (outcome.error.code === 'batch_too_large') {
            limits = halve(limits);
            d.logger.warn('sync_batch_too_large', { maxBytesPerChunk: limits.maxBytesPerChunk });
            if (!retriedTooLarge) {
              retriedTooLarge = true;
              continue;
            }
          }
          return onApiError(outcome.error);
        }
      } catch (err) {
        if (err instanceof ApiError) return onApiError(err);
        d.logger.error('sync_internal_error', describeInternalError(err));
        try {
          d.state.commitBatch([], {
            last_failure_at: clock().toISOString(),
            last_error_code: 'internal_error',
          });
        } catch (stateErr) {
          d.logger.error('state_write_failed', describeInternalError(stateErr));
        }
        return result('failed');
      }
    },
  };
}
