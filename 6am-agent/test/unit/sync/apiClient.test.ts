import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type {
  ApiErrorCode,
  HeartbeatRequest,
  RegisterRequest,
  SyncRequest,
} from '../../../src/core/contract/index.js';
import {
  API_ERROR_CODES,
  HTTP_STATUS,
  HeartbeatResponseSchema,
  RETRYABLE,
  RegisterResponseSchema,
  SyncResponseSchema,
  SyncStatusResponseSchema,
  TrackingSettingsSchema,
} from '../../../src/core/contract/index.js';
import { ApiError, createApiClient } from '../../../src/core/sync/apiClient.js';
import type { ApiClient } from '../../../src/core/sync/apiClient.js';
import { createFakeFetch, type FakeFetch } from '../../helpers/fakes/fetch.js';
import { createMemoryLogger } from '../../helpers/fakes/logger.js';
import { EXAMPLES_DIR, listJson, readJson } from '../contract/helpers.js';

const BASE = 'https://monitor.6amtech.com/api/agent/v1';
const TOKEN = '17|Qm3v8ZyP2tLk9WcR4nHs7XbD1fGj6TaE0uVoYiNp';
const UA = '6am-agent/1.2.3 (linux; x64)';

const example = (name: string): unknown => readJson(path.join(EXAMPLES_DIR, name));
const registerReq = example('register.request.json') as RegisterRequest;
const heartbeatReq = example('heartbeat.request.json') as HeartbeatRequest;
const syncReq = example('sync.request.minimal.json') as SyncRequest;
const settingsBody = example('settings.response.json');

function client(
  fetchImpl: FakeFetch,
  o: Partial<Parameters<typeof createApiClient>[0]> = {},
): ApiClient {
  return createApiClient({
    baseUrl: BASE,
    getToken: () => Promise.resolve(TOKEN),
    fetchImpl,
    userAgent: UA,
    ...o,
  });
}

async function caught(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected the call to reject');
}

function errorBody(code: ApiErrorCode): unknown {
  return example(`error.${code}.json`);
}

beforeEach(() => {
  vi.stubEnv('AGENT_ALLOW_INSECURE_LOCALHOST', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createApiClient: contract examples round-trip', () => {
  it('register.response.json via POST /register (201)', async () => {
    const body = example('register.response.json');
    const f = createFakeFetch({ status: 201, body });
    await expect(client(f).register(registerReq)).resolves.toEqual(
      RegisterResponseSchema.parse(body),
    );
    expect(f.requests[0]).toMatchObject({ url: `${BASE}/register`, method: 'POST' });
    expect(JSON.parse(f.requests[0]?.body as string)).toEqual(registerReq);
  });

  it('settings.response.json via GET /settings', async () => {
    const f = createFakeFetch({ body: settingsBody });
    await expect(client(f).settings()).resolves.toEqual(TrackingSettingsSchema.parse(settingsBody));
    expect(f.requests[0]).toMatchObject({ url: `${BASE}/settings`, method: 'GET', body: null });
  });

  it('heartbeat.response.json via POST /heartbeat', async () => {
    const body = example('heartbeat.response.json');
    const f = createFakeFetch({ body });
    await expect(client(f).heartbeat(heartbeatReq)).resolves.toEqual(
      HeartbeatResponseSchema.parse(body),
    );
    expect(f.requests[0]).toMatchObject({ url: `${BASE}/heartbeat`, method: 'POST' });
    expect(JSON.parse(f.requests[0]?.body as string)).toEqual(heartbeatReq);
  });

  const syncResponses = listJson(EXAMPLES_DIR).filter((n) => n.startsWith('sync.response.'));

  it('has sync.response examples to test', () => {
    expect(syncResponses.length).toBeGreaterThanOrEqual(5);
  });

  it.each(syncResponses)('%s via POST /sync', async (name) => {
    const body = example(name);
    const f = createFakeFetch({ body });
    await expect(client(f).sync(syncReq)).resolves.toEqual(SyncResponseSchema.parse(body));
    expect(f.requests[0]).toMatchObject({ url: `${BASE}/sync`, method: 'POST' });
    expect(JSON.parse(f.requests[0]?.body as string)).toEqual(syncReq);
  });

  it('sync-status.response.json via GET /sync/status', async () => {
    const body = example('sync-status.response.json');
    const f = createFakeFetch({ body });
    await expect(client(f).syncStatus()).resolves.toEqual(SyncStatusResponseSchema.parse(body));
    expect(f.requests[0]).toMatchObject({ url: `${BASE}/sync/status`, method: 'GET' });
  });

  it('strips a trailing slash from the base URL', async () => {
    const f = createFakeFetch({ body: settingsBody });
    await client(f, { baseUrl: `${BASE}/` }).settings();
    expect(f.requests[0]?.url).toBe(`${BASE}/settings`);
  });
});

describe('createApiClient: error envelopes', () => {
  it.each([...API_ERROR_CODES])(
    'error.%s.json maps to ApiError with its code, status and retryable',
    async (code) => {
      const f = createFakeFetch({ status: HTTP_STATUS[code], body: errorBody(code) });
      const err = await caught(client(f).sync(syncReq));
      expect(err.code).toBe(code);
      expect(err.status).toBe(HTTP_STATUS[code]);
      expect(err.retryable).toBe(RETRYABLE[code]);
    },
  );

  it('takes retryable from the contract table, not the body', async () => {
    const body = {
      success: false,
      error: { code: 'invalid_payload', message: 'x', retryable: true },
    };
    const f = createFakeFetch({ status: 422, body });
    const err = await caught(client(f).sync(syncReq));
    expect(err).toMatchObject({ code: 'invalid_payload', retryable: false });
  });

  it('never copies the server error message into ApiError', async () => {
    const body = {
      success: false,
      error: { code: 'persistence_failed', message: 'db leaked secret-xyz', retryable: true },
    };
    const f = createFakeFetch({ status: 500, body });
    const err = await caught(client(f).sync(syncReq));
    expect(err.message).not.toContain('secret-xyz');
    expect(err.message).toBe('api error persistence_failed (500)');
  });
});

describe('createApiClient: invalid responses are retryable invalid_response', () => {
  it('schema-invalid 200', async () => {
    const f = createFakeFetch({ body: { server_time: 'nope' } });
    const err = await caught(client(f).heartbeat(heartbeatReq));
    expect(err).toMatchObject({ code: 'invalid_response', status: 200, retryable: true });
  });

  it('non-JSON 200', async () => {
    const f = createFakeFetch({ body: 'OK' });
    const err = await caught(client(f).settings());
    expect(err).toMatchObject({ code: 'invalid_response', status: 200, retryable: true });
  });

  it('HTML 502 from a proxy', async () => {
    const f = createFakeFetch({
      status: 502,
      body: '<html><body>Bad Gateway</body></html>',
      headers: { 'content-type': 'text/html' },
    });
    const err = await caught(client(f).sync(syncReq));
    expect(err).toMatchObject({ code: 'invalid_response', status: 502, retryable: true });
  });

  it('truncated JSON error body', async () => {
    const f = createFakeFetch({ status: 500, body: '{"success":false,"error":{"co' });
    const err = await caught(client(f).sync(syncReq));
    expect(err).toMatchObject({ code: 'invalid_response', status: 500, retryable: true });
  });

  it('/sync 200 with success:false or without success', async () => {
    const ok = example('sync.response.minimal.json') as Record<string, unknown>;
    for (const body of [
      { ...ok, success: false },
      { ...ok, success: undefined },
    ]) {
      const err = await caught(client(createFakeFetch({ body })).sync(syncReq));
      expect(err).toMatchObject({ code: 'invalid_response', status: 200, retryable: true });
    }
  });

  it('/sync acknowledged with a non-200 2xx status (contract §7.2 requires 200)', async () => {
    const f = createFakeFetch({ status: 202, body: example('sync.response.minimal.json') });
    const err = await caught(client(f).sync(syncReq));
    expect(err).toMatchObject({ code: 'invalid_response', status: 202, retryable: true });
  });

  it('unknown error code in an otherwise valid envelope', async () => {
    const body = { success: false, error: { code: 'brand_new', message: 'x', retryable: false } };
    const f = createFakeFetch({ status: 400, body });
    const err = await caught(client(f).sync(syncReq));
    expect(err).toMatchObject({ code: 'invalid_response', status: 400, retryable: true });
  });
});

describe('createApiClient: transport failures', () => {
  it('times out as a retryable timeout', async () => {
    const f = createFakeFetch('hang');
    const err = await caught(client(f, { timeoutMs: 10 }).settings());
    expect(err).toMatchObject({ code: 'timeout', status: null, retryable: true });
  });

  it('times out while reading a stalled body', async () => {
    const stalled = new Response(new ReadableStream({ start: () => undefined }), { status: 200 });
    const f = createFakeFetch(stalled);
    const err = await caught(client(f, { timeoutMs: 10 }).settings());
    expect(err).toMatchObject({ code: 'timeout', status: null, retryable: true });
  });

  it('uses a 30 s default timeout', async () => {
    vi.useFakeTimers();
    try {
      const f = createFakeFetch('hang');
      const p = caught(client(f).settings());
      await vi.advanceTimersByTimeAsync(29_999);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await p).code).toBe('timeout');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the timeout timer after a successful request', async () => {
    vi.useFakeTimers();
    try {
      const f = createFakeFetch({ body: settingsBody });
      await client(f).settings();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps a fetch rejection to a retryable network error', async () => {
    const f = createFakeFetch({ error: new TypeError('fetch failed') });
    const err = await caught(client(f).heartbeat(heartbeatReq));
    expect(err).toMatchObject({ code: 'network', status: null, retryable: true });
  });

  it('maps a body stream failure to a network error', async () => {
    const broken = new Response(
      new ReadableStream({ start: (c) => c.error(new Error('socket hang up')) }),
      { status: 200 },
    );
    const f = createFakeFetch(broken);
    const err = await caught(client(f).settings());
    expect(err).toMatchObject({ code: 'network', status: null, retryable: true });
  });
});

describe('createApiClient: 429 Retry-After', () => {
  const rateLimited = (retryAfter: string | null, status = 429) => ({
    status,
    body: errorBody(status === 429 ? 'rate_limited' : 'persistence_failed'),
    headers: (retryAfter === null ? {} : { 'Retry-After': retryAfter }) as Record<string, string>,
  });

  it('reads delta-seconds', async () => {
    const f = createFakeFetch(rateLimited('42'));
    const err = await caught(client(f).sync(syncReq));
    expect(err).toMatchObject({ code: 'rate_limited', status: 429, retryAfterMs: 42_000 });
  });

  it('reads an HTTP-date relative to now', async () => {
    const at = new Date(Date.now() + 120_000).toUTCString();
    const f = createFakeFetch(rateLimited(at));
    const err = await caught(client(f).sync(syncReq));
    expect(err.retryAfterMs).toBeGreaterThan(115_000);
    expect(err.retryAfterMs).toBeLessThanOrEqual(120_000);
  });

  it('floors a past HTTP-date at 0', async () => {
    const f = createFakeFetch(rateLimited('Wed, 21 Oct 2015 07:28:00 GMT'));
    expect((await caught(client(f).sync(syncReq))).retryAfterMs).toBe(0);
  });

  it('is null when missing or unparseable', async () => {
    const f = createFakeFetch(rateLimited(null), rateLimited('soon'));
    expect((await caught(client(f).sync(syncReq))).retryAfterMs).toBeNull();
    expect((await caught(client(f).sync(syncReq))).retryAfterMs).toBeNull();
  });

  it('is ignored on non-429 responses', async () => {
    const f = createFakeFetch(rateLimited('42', 500));
    expect((await caught(client(f).sync(syncReq))).retryAfterMs).toBeNull();
  });
});

describe('createApiClient: transport security', () => {
  const make = (baseUrl: string): ApiClient => client(createFakeFetch(), { baseUrl });

  it('accepts https', () => {
    expect(() => make(BASE)).not.toThrow();
  });

  it('rejects http: for remote hosts even with the env var', () => {
    vi.stubEnv('AGENT_ALLOW_INSECURE_LOCALHOST', '1');
    expect(() => make('http://monitor.6amtech.com/api/agent/v1')).toThrow(/https/);
  });

  it('rejects http://127.0.0.1 without AGENT_ALLOW_INSECURE_LOCALHOST=1', () => {
    expect(() => make('http://127.0.0.1:8000/api/agent/v1')).toThrow(/https/);
    vi.stubEnv('AGENT_ALLOW_INSECURE_LOCALHOST', 'true');
    expect(() => make('http://127.0.0.1:8000/api/agent/v1')).toThrow(/https/);
  });

  it('allows http://127.0.0.1 and http://localhost with AGENT_ALLOW_INSECURE_LOCALHOST=1', async () => {
    vi.stubEnv('AGENT_ALLOW_INSECURE_LOCALHOST', '1');
    const f = createFakeFetch({ body: settingsBody });
    await client(f, { baseUrl: 'http://127.0.0.1:8000/api/agent/v1' }).settings();
    expect(f.requests[0]?.url).toBe('http://127.0.0.1:8000/api/agent/v1/settings');
    expect(() => make('http://localhost/api/agent/v1')).not.toThrow();
  });

  it('allows http loopback (127.0.0.1, localhost, ::1) without the env var when allowInsecureLoopback is set', async () => {
    const dev = (baseUrl: string): ApiClient =>
      client(createFakeFetch({ body: settingsBody }), { baseUrl, allowInsecureLoopback: true });
    expect(() => dev('http://127.0.0.1:8000/api/agent/v1')).not.toThrow();
    expect(() => dev('http://localhost/api/agent/v1')).not.toThrow();
    expect(() => dev('http://[::1]:8000/api/agent/v1')).not.toThrow();
    const f = createFakeFetch({ body: settingsBody });
    await client(f, {
      baseUrl: 'http://127.0.0.1:8000/api/agent/v1',
      allowInsecureLoopback: true,
    }).settings();
    expect(f.requests[0]?.url).toBe('http://127.0.0.1:8000/api/agent/v1/settings');
  });

  it('still rejects http for non-loopback hosts when allowInsecureLoopback is set', () => {
    const dev = (baseUrl: string): ApiClient =>
      client(createFakeFetch(), { baseUrl, allowInsecureLoopback: true });
    expect(() => dev('http://monitor.6amtech.com/api/agent/v1')).toThrow(/https/);
    expect(() => dev('http://127.0.0.2/api/agent/v1')).toThrow(/https/);
    expect(() => dev('http://localhost.evil.test/api/agent/v1')).toThrow(/https/);
    expect(() => dev('http://192.168.1.5/api/agent/v1')).toThrow(/https/);
    expect(() => dev('ftp://localhost/api')).toThrow(/https/);
  });

  it('does not allow loopback http by default (allowInsecureLoopback false or unset)', () => {
    expect(() => make('http://127.0.0.1:8000/api/agent/v1')).toThrow(/https/);
    expect(() =>
      client(createFakeFetch(), {
        baseUrl: 'http://localhost/api/agent/v1',
        allowInsecureLoopback: false,
      }),
    ).toThrow(/https/);
    expect(() => make('http://[::1]/api/agent/v1')).toThrow(/https/);
  });

  it('allows http://[::1] with AGENT_ALLOW_INSECURE_LOCALHOST=1', () => {
    vi.stubEnv('AGENT_ALLOW_INSECURE_LOCALHOST', '1');
    expect(() => make('http://[::1]:8000/api/agent/v1')).not.toThrow();
  });

  it('rejects other protocols', () => {
    vi.stubEnv('AGENT_ALLOW_INSECURE_LOCALHOST', '1');
    expect(() => make('ftp://localhost/api')).toThrow(/https/);
    expect(() => make('file:///tmp/api')).toThrow(/https/);
  });
});

describe('createApiClient: request encoding', () => {
  it('does not gzip bodies up to 64 KB', async () => {
    const f = createFakeFetch({ body: example('sync.response.minimal.json') });
    await client(f).sync(syncReq);
    const req = f.requests[0];
    expect(typeof req?.body).toBe('string');
    expect(req?.headers['content-encoding']).toBeUndefined();
    expect(req?.headers['content-type']).toBe('application/json');
  });

  it('gzips bodies over 64 KB with Content-Encoding: gzip', async () => {
    const big: SyncRequest = {
      ...syncReq,
      agent: { ...syncReq.agent, claude_code_version: 'x'.repeat(70 * 1024) },
    };
    const f = createFakeFetch({ body: example('sync.response.minimal.json') });
    await client(f).sync(big);
    const req = f.requests[0];
    expect(req?.headers['content-encoding']).toBe('gzip');
    expect(req?.headers['content-type']).toBe('application/json');
    expect(Buffer.isBuffer(req?.body)).toBe(true);
    const inflated = gunzipSync(req?.body as Buffer).toString('utf8');
    expect(JSON.parse(inflated)).toEqual(big);
    expect((req?.body as Buffer).byteLength).toBeLessThan(64 * 1024);
  });

  it('measures the 64 KB threshold in UTF-8 bytes, not characters', async () => {
    const multiByte: SyncRequest = {
      ...syncReq,
      agent: { ...syncReq.agent, claude_code_version: 'é'.repeat(40 * 1024) },
    };
    const f = createFakeFetch({ body: example('sync.response.minimal.json') });
    await client(f).sync(multiByte);
    expect(f.requests[0]?.headers['content-encoding']).toBe('gzip');
  });

  it('replaces lone UTF-16 surrogates with U+FFFD in every string sent', async () => {
    const dirty: SyncRequest = {
      ...syncReq,
      agent: { ...syncReq.agent, platform_version: 'a\uD800b', claude_code_version: 'c\uDC00' },
      sessions: syncReq.sessions.map((s) => ({ ...s, source_session_id: 'ok😀' })),
    };
    const f = createFakeFetch({ body: example('sync.response.minimal.json') });
    await client(f).sync(dirty);
    const raw = f.requests[0]?.body as string;
    expect(raw).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
    const sent = JSON.parse(raw) as SyncRequest;
    expect(sent.agent.platform_version).toBe('a�b');
    expect(sent.agent.claude_code_version).toBe('c�');
    expect(sent.sessions[0]?.source_session_id).toBe('ok😀');
  });
});

describe('createApiClient: headers', () => {
  it('sends Accept, User-Agent, X-Agent-Version and Bearer token', async () => {
    const f = createFakeFetch({ body: settingsBody });
    await client(f).settings();
    expect(f.requests[0]?.headers).toEqual({
      accept: 'application/json',
      'user-agent': UA,
      'x-agent-version': '1.2.3',
      authorization: `Bearer ${TOKEN}`,
    });
  });

  it('omits X-Agent-Version when the User-Agent has no version', async () => {
    const f = createFakeFetch({ body: settingsBody });
    await client(f, { userAgent: 'something-else' }).settings();
    expect(f.requests[0]?.headers['x-agent-version']).toBeUndefined();
    expect(f.requests[0]?.headers['user-agent']).toBe('something-else');
  });

  it('/register sends no Authorization and never asks for a token', async () => {
    const getToken = vi.fn(() => Promise.resolve(TOKEN));
    const f = createFakeFetch({ status: 201, body: example('register.response.json') });
    await client(f, { getToken }).register(registerReq);
    expect(f.requests[0]?.headers.authorization).toBeUndefined();
    expect(f.requests[0]?.headers['x-agent-version']).toBe('1.2.3');
    expect(getToken).not.toHaveBeenCalled();
  });

  it('a null token fails with unauthenticated without calling fetch', async () => {
    const f = createFakeFetch();
    const api = client(f, { getToken: () => Promise.resolve(null) });
    for (const call of [
      () => api.settings(),
      () => api.heartbeat(heartbeatReq),
      () => api.sync(syncReq),
      () => api.syncStatus(),
      () => api.deregister(),
    ]) {
      const err = await caught(call());
      expect(err).toMatchObject({ code: 'unauthenticated', status: null, retryable: false });
    }
    expect(f.requests).toHaveLength(0);
  });

  it('propagates a credential store failure unchanged without calling fetch', async () => {
    const boom = new Error('keychain locked');
    const logger = createMemoryLogger();
    const f = createFakeFetch();
    const api = client(f, { getToken: () => Promise.reject(boom), logger });
    await expect(api.settings()).rejects.toBe(boom);
    expect(f.requests).toHaveLength(0);
    expect(logger.entries).toHaveLength(0);
  });

  it('prefers an injected transport over fetchImpl', async () => {
    const f = createFakeFetch();
    const transport = vi.fn(() =>
      Promise.resolve({
        status: 200,
        header: () => null,
        text: () => Promise.resolve(JSON.stringify(settingsBody)),
      }),
    );
    await client(f, { transport }).settings();
    expect(transport).toHaveBeenCalledOnce();
    expect(f.requests).toHaveLength(0);
  });

  it('never puts the token in logs or ApiError messages', async () => {
    const logger = createMemoryLogger();
    const f = createFakeFetch(
      { body: settingsBody },
      { status: 401, body: errorBody('unauthenticated') },
      { error: new TypeError(`fetch failed Bearer ${TOKEN}`) },
      'hang',
    );
    const api = client(f, { logger, timeoutMs: 10 });
    await api.settings();
    const errors = [
      await caught(api.sync(syncReq)),
      await caught(api.heartbeat(heartbeatReq)),
      await caught(api.settings()),
    ];
    expect(f.requests.every((r) => r.headers.authorization === `Bearer ${TOKEN}`)).toBe(true);
    for (const e of errors) {
      expect(e.message).not.toContain(TOKEN);
      expect(e.message).not.toContain('Bearer');
    }
    expect(logger.entries.length).toBeGreaterThanOrEqual(4);
    expect(logger.text()).not.toContain(TOKEN);
    expect(logger.text()).not.toMatch(/authorization|bearer/i);
    expect(logger.text()).not.toContain(syncReq.sync.batch_id);
  });
});

describe('createApiClient: logging', () => {
  it('logs method, path, status and duration for each request, and failures by code', async () => {
    const logger = createMemoryLogger();
    const f = createFakeFetch(
      { body: settingsBody },
      { status: 409, body: errorBody('batch_in_progress') },
    );
    const api = client(f, { logger });
    await api.settings();
    await caught(api.sync(syncReq));
    const fields = logger.entries.map((e) => e.fields);
    expect(fields[0]).toMatchObject({ method: 'GET', path: '/settings', status: 200 });
    expect(typeof fields[0]?.ms).toBe('number');
    expect(fields).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/sync',
        code: 'batch_in_progress',
        status: 409,
      }),
    );
    for (const f2 of fields) {
      expect(
        Object.keys(f2 ?? {}).every((k) => ['method', 'path', 'status', 'ms', 'code'].includes(k)),
      ).toBe(true);
    }
  });
});

describe('createApiClient: deregister', () => {
  it('resolves on 204 with an empty body', async () => {
    const f = createFakeFetch({ status: 204 });
    await expect(client(f).deregister()).resolves.toBeUndefined();
    expect(f.requests[0]).toMatchObject({ url: `${BASE}/deregister`, method: 'POST', body: null });
    expect(f.requests[0]?.headers['content-type']).toBeUndefined();
  });

  it('treats 401 as already deregistered (contract §3.6)', async () => {
    const f = createFakeFetch({ status: 401, body: errorBody('unauthenticated') });
    await expect(client(f).deregister()).resolves.toBeUndefined();
  });

  it('still fails on other errors', async () => {
    const f = createFakeFetch({ status: 500, body: errorBody('persistence_failed') });
    expect((await caught(client(f).deregister())).code).toBe('persistence_failed');
  });
});

describe('createApiClient: X-Settings-Version tracking', () => {
  it('is null before any response', () => {
    expect(client(createFakeFetch()).lastSettingsVersion()).toBeNull();
  });

  it('tracks the header on success and error responses, null when absent or invalid', async () => {
    const f = createFakeFetch(
      { body: settingsBody, headers: { 'X-Settings-Version': '7' } },
      { status: 409, body: errorBody('batch_in_progress'), headers: { 'X-Settings-Version': '8' } },
      { status: 502, body: '<html>', headers: { 'X-Settings-Version': '9' } },
      { body: settingsBody },
      { body: settingsBody, headers: { 'X-Settings-Version': 'abc' } },
      { body: settingsBody, headers: { 'X-Settings-Version': '0' } },
      { body: settingsBody, headers: { 'X-Settings-Version': '10' } },
      { error: new TypeError('fetch failed') },
    );
    const api = client(f);
    await api.settings();
    expect(api.lastSettingsVersion()).toBe(7);
    await caught(api.sync(syncReq));
    expect(api.lastSettingsVersion()).toBe(8);
    await caught(api.sync(syncReq));
    expect(api.lastSettingsVersion()).toBe(9);
    await api.settings();
    expect(api.lastSettingsVersion()).toBeNull();
    await api.settings();
    expect(api.lastSettingsVersion()).toBeNull();
    await api.settings();
    expect(api.lastSettingsVersion()).toBeNull();
    await api.settings();
    expect(api.lastSettingsVersion()).toBe(10);
    await caught(api.settings());
    expect(api.lastSettingsVersion()).toBe(10);
  });
});

describe('createApiClient: default node:http transport', () => {
  interface Seen {
    method: string;
    url: string;
    headers: IncomingMessage['headers'];
    body: Buffer;
  }
  let server: Server | null = null;

  afterEach(async () => {
    const s = server;
    server = null;
    if (s === null) return;
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  });

  async function serve(
    handler: (res: ServerResponse) => void,
  ): Promise<{ base: string; seen: Seen[] }> {
    const seen: Seen[] = [];
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks),
        });
        handler(res);
      });
    });
    const s = server;
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
    const { port } = s.address() as AddressInfo;
    return { base: `http://127.0.0.1:${port}/api/agent/v1`, seen };
  }

  const reply =
    (status: number, body: unknown, headers: Record<string, string> = {}) =>
    (res: ServerResponse) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };

  const local = (base: string, o: Partial<Parameters<typeof createApiClient>[0]> = {}) =>
    createApiClient({
      baseUrl: base,
      getToken: () => Promise.resolve(TOKEN),
      userAgent: UA,
      allowInsecureLoopback: true,
      ...o,
    });

  it('is used instead of the global fetch and sends the contract headers', async () => {
    const globalFetch = vi.fn(() => Promise.reject(new Error('global fetch used')));
    vi.stubGlobal('fetch', globalFetch);
    try {
      const { base, seen } = await serve(reply(200, settingsBody, { 'X-Settings-Version': '4' }));
      const api = local(base);
      await expect(api.settings()).resolves.toEqual(TrackingSettingsSchema.parse(settingsBody));
      expect(api.lastSettingsVersion()).toBe(4);
      expect(globalFetch).not.toHaveBeenCalled();
      expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/agent/v1/settings' });
      expect(seen[0]?.headers).toMatchObject({
        accept: 'application/json',
        'user-agent': UA,
        'x-agent-version': '1.2.3',
        authorization: `Bearer ${TOKEN}`,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends small bodies as JSON and large bodies gzipped', async () => {
    const ok = example('sync.response.minimal.json');
    const { base, seen } = await serve(reply(200, ok));
    const api = local(base);
    await api.sync(syncReq);
    const big: SyncRequest = {
      ...syncReq,
      agent: { ...syncReq.agent, claude_code_version: 'x'.repeat(70 * 1024) },
    };
    await api.sync(big);
    expect(seen[0]?.headers['content-type']).toBe('application/json');
    expect(seen[0]?.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(seen[0]?.body.toString('utf8') ?? '')).toEqual(syncReq);
    expect(seen[1]?.headers['content-encoding']).toBe('gzip');
    expect(seen[1]?.headers['content-length']).toBe(String(seen[1]?.body.byteLength));
    expect(JSON.parse(gunzipSync(seen[1]?.body ?? Buffer.alloc(0)).toString('utf8'))).toEqual(big);
  });

  it('maps error envelopes and 429 Retry-After', async () => {
    const { base } = await serve(reply(429, errorBody('rate_limited'), { 'Retry-After': '7' }));
    const err = await caught(local(base).sync(syncReq));
    expect(err).toMatchObject({ code: 'rate_limited', status: 429, retryAfterMs: 7000 });
  });

  it('maps a proxy HTML page to invalid_response', async () => {
    const { base } = await serve((res) => {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end('<html>Bad Gateway</html>');
    });
    const err = await caught(local(base).sync(syncReq));
    expect(err).toMatchObject({ code: 'invalid_response', status: 502, retryable: true });
  });

  it('maps a body in an unsupported Content-Encoding to invalid_response', async () => {
    const { base } = await serve((res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'zstd' });
      res.end('{}');
    });
    const err = await caught(local(base).settings());
    expect(err).toMatchObject({ code: 'invalid_response', status: 200, retryable: true });
  });

  it('maps an oversized response body to invalid_response', async () => {
    const { base } = await serve((res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(`"${'x'.repeat(5 * 1024 * 1024)}"`);
    });
    const err = await caught(local(base).settings());
    expect(err).toMatchObject({ code: 'invalid_response', status: 200, retryable: true });
  });

  it('times out a server that never answers', async () => {
    const { base } = await serve(() => undefined);
    const err = await caught(local(base, { timeoutMs: 50 }).settings());
    expect(err).toMatchObject({ code: 'timeout', status: null, retryable: true });
  });

  it('maps a refused connection to a retryable network error', async () => {
    const { base } = await serve(() => undefined);
    const s = server;
    server = null;
    await new Promise<void>((resolve) => s?.close(() => resolve()));
    const err = await caught(local(base).heartbeat(heartbeatReq));
    expect(err).toMatchObject({ code: 'network', status: null, retryable: true });
  });

  it('maps an unresolvable host to a retryable transport failure', async () => {
    const api = createApiClient({
      baseUrl: 'https://agent-h33.invalid/api/agent/v1',
      getToken: () => Promise.resolve(TOKEN),
      userAgent: UA,
      timeoutMs: 1500,
    });
    const err = await caught(api.settings());
    // NXDOMAIN is `network`; a resolver that never answers ends as `timeout`. Both retry (§9.3).
    expect(['network', 'timeout']).toContain(err.code);
    expect(err).toMatchObject({ status: null, retryable: true });
  });
});
