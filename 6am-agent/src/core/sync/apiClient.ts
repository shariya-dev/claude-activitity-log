import { gzipSync } from 'node:zlib';
import type { ZodType } from 'zod';
import type {
  ApiErrorCode,
  HeartbeatRequest,
  HeartbeatResponse,
  RegisterRequest,
  RegisterResponse,
  SyncRequest,
  SyncResponse,
  SyncStatusResponse,
  TrackingSettings,
} from '../contract/index.js';
import {
  ApiErrorSchema,
  HeartbeatResponseSchema,
  RETRYABLE,
  RegisterResponseSchema,
  SyncResponseSchema,
  SyncStatusResponseSchema,
  TrackingSettingsSchema,
} from '../contract/index.js';
import type { Logger } from '../runtime/logger.js';

export interface ApiClient {
  register(req: RegisterRequest): Promise<RegisterResponse>;
  heartbeat(req: HeartbeatRequest): Promise<HeartbeatResponse>;
  settings(): Promise<TrackingSettings>;
  sync(req: SyncRequest): Promise<SyncResponse>;
  syncStatus(): Promise<SyncStatusResponse>;
  deregister(): Promise<void>;
  /** `X-Settings-Version` of the most recent response (success or error), or null when absent. */
  lastSettingsVersion(): number | null;
}

export type ApiErrorKind = ApiErrorCode | 'network' | 'timeout' | 'invalid_response';

/** Every failed API call. The message never contains tokens, prompt text or emails. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ApiErrorKind;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(o: {
    code: ApiErrorKind;
    status: number | null;
    retryable: boolean;
    retryAfterMs?: number | null;
    message?: string;
  }) {
    super(o.message ?? `api error ${o.code}${o.status === null ? '' : ` (${o.status})`}`);
    this.code = o.code;
    this.status = o.status;
    this.retryable = o.retryable;
    this.retryAfterMs = o.retryAfterMs ?? null;
  }
}

/** Bodies larger than this (UTF-8 bytes) MUST be gzipped (contract §1). */
const GZIP_THRESHOLD_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

type Method = 'GET' | 'POST';

interface RawResponse {
  status: number;
  text: string;
  retryAfter: string | null;
}

/** Contract §1: every string sent is well-formed UTF-16, so the body is valid UTF-8. */
function serialize(body: unknown): string {
  return JSON.stringify(body, (_key, value: unknown) =>
    typeof value === 'string' ? value.replace(LONE_SURROGATE, '\uFFFD') : value,
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function positiveInt(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** `Retry-After` as delta-seconds or an HTTP-date, in ms from now; null when unparseable. */
function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function invalidResponse(status: number | null): ApiError {
  return new ApiError({ code: 'invalid_response', status, retryable: true });
}

/** Maps a non-2xx response to an ApiError. Anything outside the envelope is a transport failure (§9.3). */
function errorFrom(raw: RawResponse): ApiError {
  const envelope = ApiErrorSchema.safeParse(parseJson(raw.text));
  if (!envelope.success) return invalidResponse(raw.status);
  const code = envelope.data.error.code;
  return new ApiError({
    code,
    status: raw.status,
    retryable: RETRYABLE[code],
    retryAfterMs: raw.status === 429 ? parseRetryAfter(raw.retryAfter) : null,
  });
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

function checkedBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const url = new URL(trimmed);
  if (url.protocol === 'https:') return trimmed;
  const localDev =
    url.protocol === 'http:' &&
    process.env.AGENT_ALLOW_INSECURE_LOCALHOST === '1' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (!localDev) throw new Error(`API base URL must use https (got ${url.protocol})`);
  return trimmed;
}

/** Rejects when the signal aborts, so a fetch or body read that ignores the signal still times out. */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

/**
 * HTTP client for Sync API v1 (docs/contracts/sync-api-v1.md). Validates every response with the
 * contract zod schemas, gzips large bodies, and maps every failure to an ApiError. Never logs or
 * throws headers, tokens, bodies or server error text.
 */
export function createApiClient(o: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent: string;
  logger?: Logger;
}): ApiClient {
  const baseUrl = checkedBaseUrl(o.baseUrl);
  const fetchImpl = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const agentVersion = /^6am-agent\/(\S+)/.exec(o.userAgent)?.[1] ?? null;
  let settingsVersion: number | null = null;

  const exchange = async (
    method: Method,
    path: string,
    auth: boolean,
    body: unknown,
  ): Promise<RawResponse> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': o.userAgent,
    };
    if (agentVersion !== null) headers['X-Agent-Version'] = agentVersion;
    if (auth) {
      const token = await o.getToken();
      if (token === null) {
        throw new ApiError({ code: 'unauthenticated', status: null, retryable: false });
      }
      headers.Authorization = `Bearer ${token}`;
    }

    let payload: string | Uint8Array<ArrayBuffer> | undefined;
    if (body !== undefined) {
      const json = serialize(body);
      headers['Content-Type'] = 'application/json';
      if (Buffer.byteLength(json, 'utf8') > GZIP_THRESHOLD_BYTES) {
        payload = new Uint8Array(gzipSync(json));
        headers['Content-Encoding'] = 'gzip';
      } else {
        payload = json;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const aborted = whenAborted(controller.signal);
    aborted.catch(() => undefined);
    const transportError = (): ApiError =>
      controller.signal.aborted
        ? new ApiError({ code: 'timeout', status: null, retryable: true })
        : new ApiError({ code: 'network', status: null, retryable: true });
    try {
      let res: Response;
      try {
        res = await Promise.race([
          fetchImpl(`${baseUrl}${path}`, {
            method,
            headers,
            body: payload,
            signal: controller.signal,
          }),
          aborted,
        ]);
      } catch {
        throw transportError();
      }
      settingsVersion = positiveInt(res.headers.get('x-settings-version'));
      let text: string;
      try {
        text = await Promise.race([res.text(), aborted]);
      } catch {
        throw transportError();
      }
      return { status: res.status, text, retryAfter: res.headers.get('retry-after') };
    } finally {
      clearTimeout(timer);
    }
  };

  const perform = async <T>(
    method: Method,
    path: string,
    opts: { auth: boolean; body?: unknown },
    handle: (raw: RawResponse) => T,
  ): Promise<T> => {
    const started = Date.now();
    try {
      const raw = await exchange(method, path, opts.auth, opts.body);
      o.logger?.debug('api request', {
        method,
        path,
        status: raw.status,
        ms: Date.now() - started,
      });
      return handle(raw);
    } catch (err) {
      if (err instanceof ApiError) {
        o.logger?.debug('api request failed', { method, path, code: err.code, status: err.status });
      }
      throw err;
    }
  };

  const json =
    <T>(schema: ZodType<T>, requiredStatus?: number) =>
    (raw: RawResponse): T => {
      if (!isOk(raw.status)) throw errorFrom(raw);
      if (requiredStatus !== undefined && raw.status !== requiredStatus) {
        throw invalidResponse(raw.status);
      }
      const parsed = schema.safeParse(parseJson(raw.text));
      if (!parsed.success) throw invalidResponse(raw.status);
      return parsed.data;
    };

  return {
    register: (req) =>
      perform('POST', '/register', { auth: false, body: req }, json(RegisterResponseSchema)),
    settings: () => perform('GET', '/settings', { auth: true }, json(TrackingSettingsSchema)),
    heartbeat: (req) =>
      perform('POST', '/heartbeat', { auth: true, body: req }, json(HeartbeatResponseSchema)),
    // Contract §7.2: only `200` + `success: true` acknowledges a batch.
    sync: (req) =>
      perform('POST', '/sync', { auth: true, body: req }, json(SyncResponseSchema, 200)),
    syncStatus: () =>
      perform('GET', '/sync/status', { auth: true }, json(SyncStatusResponseSchema)),
    deregister: () =>
      perform('POST', '/deregister', { auth: true }, (raw) => {
        if (isOk(raw.status) || raw.status === 401) return;
        throw errorFrom(raw);
      }),
    lastSettingsVersion: () => settingsVersion,
  };
}
