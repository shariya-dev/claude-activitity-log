import type {
  HeartbeatRequest,
  HeartbeatResponse,
  RegisterRequest,
  RegisterResponse,
  SyncRequest,
  SyncResponse,
  SyncStatusResponse,
  TrackingSettings,
} from '../../../src/core/contract/index.js';
import { HTTP_STATUS, RETRYABLE } from '../../../src/core/contract/index.js';
import type { ApiErrorCode } from '../../../src/core/contract/index.js';
import { ApiError, type ApiClient } from '../../../src/core/sync/apiClient.js';
import { makeSettings } from './settings.js';

type Handler<Req, Res> = (req: Req) => Res | Promise<Res>;

/** Builds the ApiError the real client throws for a contract error code. */
export function apiError(code: ApiErrorCode, retryAfterMs: number | null = null): ApiError {
  return new ApiError({
    code,
    status: HTTP_STATUS[code],
    retryable: RETRYABLE[code],
    retryAfterMs,
  });
}

export const networkError = (): ApiError =>
  new ApiError({ code: 'network', status: null, retryable: true });
export const timeoutError = (): ApiError =>
  new ApiError({ code: 'timeout', status: null, retryable: true });

/** A successful sync response echoing the request, as the backend would. */
export function okSyncResponse(req: SyncRequest, o: Partial<SyncResponse> = {}): SyncResponse {
  const total =
    req.accounts.length +
    req.projects.length +
    req.sessions.length +
    req.usage.length +
    req.messages.length;
  return {
    success: true,
    batch_id: req.sync.batch_id,
    sync: { accepted: total, created: total, updated: 0, rejected: 0 },
    rejected_records: [],
    cursor: `cursor-${req.sync.sequence}`,
    settings_version: req.sync.settings_version,
    server_time: '2026-09-24T00:00:00Z',
    ...o,
  };
}

/**
 * Scriptable ApiClient. Each method has a default behaviour; `queue*` pushes one-shot outcomes
 * (a value, an ApiError to throw, or a handler) that are consumed in order before the default.
 */
export class FakeApiClient implements ApiClient {
  calls: { method: string; req?: unknown }[] = [];
  syncRequests: SyncRequest[] = [];
  heartbeatRequests: HeartbeatRequest[] = [];
  settingsVersionHeader: number | null = null;

  serverSettings: TrackingSettings = makeSettings();
  syncHandler: Handler<SyncRequest, SyncResponse> = (req) => okSyncResponse(req);
  heartbeatHandler: Handler<HeartbeatRequest, HeartbeatResponse> = () => ({
    server_time: '2026-09-24T00:00:00Z',
    settings_version: this.serverSettings.version,
    sync_requested: false,
  });

  private queues = new Map<string, unknown[]>();

  queue(method: 'sync' | 'heartbeat' | 'settings' | 'syncStatus', ...outcomes: unknown[]): this {
    const q = this.queues.get(method) ?? [];
    q.push(...outcomes);
    this.queues.set(method, q);
    return this;
  }

  private async run<Req, Res>(method: string, req: Req, fallback: Handler<Req, Res>): Promise<Res> {
    this.calls.push({ method, req });
    const next = this.queues.get(method)?.shift();
    const outcome = next === undefined ? fallback : next;
    if (outcome instanceof Error) throw outcome;
    if (typeof outcome === 'function') return (outcome as Handler<Req, Res>)(req);
    return outcome as Res;
  }

  register(req: RegisterRequest): Promise<RegisterResponse> {
    return this.run('register', req, () => ({
      device_id: 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W',
      token: 'fake-device-token',
      developer: { name: 'Dev', email: 'dev@example.test' },
      settings: this.serverSettings,
    }));
  }

  heartbeat(req: HeartbeatRequest): Promise<HeartbeatResponse> {
    this.heartbeatRequests.push(req);
    return this.run('heartbeat', req, this.heartbeatHandler);
  }

  settings(): Promise<TrackingSettings> {
    return this.run('settings', undefined, () => this.serverSettings);
  }

  sync(req: SyncRequest): Promise<SyncResponse> {
    this.syncRequests.push(structuredClone(req));
    return this.run('sync', req, this.syncHandler);
  }

  syncStatus(): Promise<SyncStatusResponse> {
    return this.run('syncStatus', undefined, () => ({
      last_batch_id: null,
      cursor: null,
      sequence: 0,
      last_success_at: null,
      sessions_known: 0,
    }));
  }

  deregister(): Promise<void> {
    return this.run('deregister', undefined, () => undefined);
  }

  lastSettingsVersion(): number | null {
    return this.settingsVersionHeader;
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }
}
