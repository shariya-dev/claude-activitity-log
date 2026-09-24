import { readFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResponseBodyError,
  ResponseTooLargeError,
  createHttpTransport,
  fetchTransport,
  type TransportRequest,
} from '../../../src/core/sync/httpTransport.js';
import { createFakeFetch } from '../../helpers/fakes/fetch.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const TLS = {
  key: readFileSync(path.join(FIXTURES, 'localhost-test.key')),
  cert: readFileSync(path.join(FIXTURES, 'localhost-test.crt')),
};

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

const servers: Server[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void,
  tls = false,
): Promise<{ base: string; received: Received[] }> {
  const received: Received[] = [];
  const listener: RequestListener = (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, res, body);
    });
  };
  const server = tls ? createTlsServer(TLS, listener) : createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `${tls ? 'https' : 'http'}://127.0.0.1:${port}`, received };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }) as (req: IncomingMessage, res: ServerResponse, body: Buffer) => void;

function request(url: string, o: Partial<TransportRequest> = {}): TransportRequest {
  return {
    url,
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: new AbortController().signal,
    ...o,
  };
}

async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a rejection');
}

describe('createHttpTransport: requests', () => {
  it('sends the method, path, headers and a string body byte for byte', async () => {
    const { base, received } = await listen(json(201, { ok: true }));
    const body = JSON.stringify({ name: 'é😀' });
    const res = await createHttpTransport()(
      request(`${base}/api/agent/v1/register`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'User-Agent': '6am-agent/1.2.3 (linux; x64)',
          'X-Agent-Version': '1.2.3',
          'Content-Type': 'application/json',
        },
        body,
      }),
    );
    expect(res.status).toBe(201);
    expect(JSON.parse(await res.text())).toEqual({ ok: true });
    const r = received[0];
    expect(r?.method).toBe('POST');
    expect(r?.url).toBe('/api/agent/v1/register');
    expect(r?.headers).toMatchObject({
      accept: 'application/json',
      'user-agent': '6am-agent/1.2.3 (linux; x64)',
      'x-agent-version': '1.2.3',
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    });
    expect(r?.headers['transfer-encoding']).toBeUndefined();
    expect(r?.headers['accept-encoding']).toBeUndefined();
    expect(r?.body.toString('utf8')).toBe(body);
  });

  it('sends a gzip Uint8Array body unchanged with its Content-Encoding', async () => {
    const { base, received } = await listen(json(200, {}));
    const gz = new Uint8Array(gzipSync(JSON.stringify({ big: 'x'.repeat(100_000) })));
    await createHttpTransport()(
      request(`${base}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
        body: gz,
      }),
    );
    expect(received[0]?.headers['content-encoding']).toBe('gzip');
    expect(received[0]?.headers['content-length']).toBe(String(gz.byteLength));
    expect(Buffer.compare(received[0]?.body ?? Buffer.alloc(0), Buffer.from(gz))).toBe(0);
  });

  it('sends Content-Length: 0 for a POST without a body and none for a GET', async () => {
    const { base, received } = await listen((_q, res) => res.writeHead(204).end());
    const t = createHttpTransport();
    await (await t(request(`${base}/deregister`, { method: 'POST' }))).text();
    await (await t(request(`${base}/settings`))).text();
    expect(received[0]?.headers['content-length']).toBe('0');
    expect(received[1]?.headers['content-length']).toBeUndefined();
    expect(received[1]?.headers['transfer-encoding']).toBeUndefined();
  });
});

describe('createHttpTransport: responses', () => {
  it('exposes status, case-insensitive headers and the UTF-8 text', async () => {
    const { base } = await listen(
      json(409, { msg: 'é' }, { 'X-Settings-Version': '7', 'Retry-After': '42' }),
    );
    const res = await createHttpTransport()(request(`${base}/sync`));
    expect(res.status).toBe(409);
    expect(res.header('x-settings-version')).toBe('7');
    expect(res.header('X-Settings-Version')).toBe('7');
    expect(res.header('retry-after')).toBe('42');
    expect(res.header('x-missing')).toBeNull();
    expect(await res.text()).toBe('{"msg":"é"}');
  });

  it('strips a UTF-8 BOM like fetch Response.text()', async () => {
    const { base } = await listen((_q, res) =>
      res.end(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}')])),
    );
    const res = await createHttpTransport()(request(`${base}/x`));
    expect(await res.text()).toBe('{"a":1}');
  });

  it('decodes a gzip-encoded response body', async () => {
    const { base } = await listen((_q, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      res.end(gzipSync('{"zipped":true}'));
    });
    const res = await createHttpTransport()(request(`${base}/x`));
    expect(await res.text()).toBe('{"zipped":true}');
  });

  it('reads an empty 204 body as ""', async () => {
    const { base } = await listen((_q, res) => res.writeHead(204).end());
    expect(await (await createHttpTransport()(request(`${base}/x`))).text()).toBe('');
  });

  it('rejects a declared Content-Length over the cap', async () => {
    const { base } = await listen((_q, res) => {
      res.writeHead(200, { 'Content-Length': '2048' });
      res.end('x'.repeat(2048));
    });
    const res = await createHttpTransport({ maxResponseBytes: 1024 })(request(`${base}/x`));
    expect(await rejection(res.text())).toBeInstanceOf(ResponseTooLargeError);
  });

  it('rejects a chunked body once it grows over the cap', async () => {
    const { base } = await listen((_q, res) => {
      res.writeHead(200);
      for (let i = 0; i < 8; i += 1) res.write('x'.repeat(512));
      res.end();
    });
    const res = await createHttpTransport({ maxResponseBytes: 1024 })(request(`${base}/x`));
    expect(await rejection(res.text())).toBeInstanceOf(ResponseTooLargeError);
  });

  it('applies the cap to the decoded size of a compressed body', async () => {
    const { base } = await listen((_q, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      res.end(gzipSync('x'.repeat(64 * 1024)));
    });
    const res = await createHttpTransport({ maxResponseBytes: 1024 })(request(`${base}/x`));
    expect(await rejection(res.text())).toBeInstanceOf(ResponseTooLargeError);
  });

  it('rejects an unsupported Content-Encoding with a ResponseBodyError', async () => {
    const { base } = await listen((_q, res) => {
      res.writeHead(200, { 'Content-Encoding': 'zstd' });
      res.end('{}');
    });
    const res = await createHttpTransport()(request(`${base}/x`));
    expect(await rejection(res.text())).toBeInstanceOf(ResponseBodyError);
  });

  it('removes its abort listener once the body is read', async () => {
    const { base } = await listen(json(200, {}));
    const c = new AbortController();
    const remove = vi.spyOn(c.signal, 'removeEventListener');
    const res = await createHttpTransport()(request(`${base}/x`, { signal: c.signal }));
    expect(remove).not.toHaveBeenCalled();
    await res.text();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('rejects the body read when the connection drops mid-body', async () => {
    const { base } = await listen((_q, res) => {
      res.writeHead(200, { 'Content-Length': '100' });
      res.write('{"partial":');
      setTimeout(() => res.socket?.destroy(), 20);
    });
    const res = await createHttpTransport()(request(`${base}/x`));
    const err = await rejection(res.text());
    expect(err).not.toBeInstanceOf(ResponseTooLargeError);
  });
});

describe('createHttpTransport: failures and abort', () => {
  it('rejects when the connection is refused', async () => {
    const { base } = await listen(json(200, {}));
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    servers.length = 0;
    const err = await rejection(createHttpTransport()(request(`${base}/x`)));
    expect(err).toBeInstanceOf(Error);
  });

  it('rejects at once for an already-aborted signal without connecting', async () => {
    const { base, received } = await listen(json(200, {}));
    const c = new AbortController();
    c.abort();
    await rejection(createHttpTransport()(request(`${base}/x`, { signal: c.signal })));
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(0);
  });

  it('aborts a request that hangs before the response and closes the socket', async () => {
    let closed = false;
    const { base } = await listen((req) => {
      req.socket.once('close', () => (closed = true));
    });
    const c = new AbortController();
    const p = createHttpTransport()(request(`${base}/x`, { signal: c.signal }));
    setTimeout(() => c.abort(), 30);
    await rejection(p);
    await new Promise((r) => setTimeout(r, 30));
    expect(closed).toBe(true);
  });

  it('aborts a stalled body read', async () => {
    const { base } = await listen((_q, res) => {
      res.writeHead(200, { 'Content-Length': '100' });
      res.write('{');
    });
    const c = new AbortController();
    const res = await createHttpTransport()(request(`${base}/x`, { signal: c.signal }));
    setTimeout(() => c.abort(), 30);
    await rejection(res.text());
  });
});

describe('createHttpTransport: https', () => {
  it('validates the server certificate against the default CAs', async () => {
    const { base, received } = await listen(json(200, {}), true);
    const err = await rejection(createHttpTransport()(request(`${base}/x`)));
    expect((err as NodeJS.ErrnoException).code).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
    expect(received).toHaveLength(0);
  });

  it('round-trips over TLS when the CA is trusted', async () => {
    const { base, received } = await listen(json(200, { tls: true }), true);
    const t = createHttpTransport({ ca: TLS.cert });
    const gz = new Uint8Array(gzipSync('{"a":1}'));
    const res = await t(
      request(`${base.replace('127.0.0.1', 'localhost')}/sync`, {
        method: 'POST',
        headers: { 'Content-Encoding': 'gzip' },
        body: gz,
      }),
    );
    expect(await res.text()).toBe('{"tls":true}');
    expect(Buffer.compare(received[0]?.body ?? Buffer.alloc(0), Buffer.from(gz))).toBe(0);
  });
});

describe('fetchTransport', () => {
  it('adapts a fetch implementation', async () => {
    const f = createFakeFetch({
      status: 201,
      body: { a: 1 },
      headers: { 'X-Settings-Version': '3' },
    });
    const c = new AbortController();
    const res = await fetchTransport(f)(
      request('https://example.test/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: c.signal,
      }),
    );
    expect(res.status).toBe(201);
    expect(res.header('x-settings-version')).toBe('3');
    expect(await res.text()).toBe('{"a":1}');
    expect(f.requests[0]).toMatchObject({
      url: 'https://example.test/x',
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
  });
});
