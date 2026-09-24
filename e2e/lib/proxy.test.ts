import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startProxy, type Proxy } from './proxy.js';

/** The proxy's own contract, checked against a throwaway upstream before any scenario relies on it. */
describe('fault-injecting proxy', () => {
  let upstream: Server;
  let proxy: Proxy;
  let upstreamHits: { path: string; body: string; headers: Record<string, unknown> }[] = [];

  const url = (path: string) => `http://127.0.0.1:${proxy.port}${path}`;
  const post = (path: string, body: string) =>
    fetch(url(path), { method: 'POST', body, headers: { 'content-type': 'application/json' } });

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        upstreamHits.push({
          path: req.url ?? '',
          body: Buffer.concat(chunks).toString('utf8'),
          headers: req.headers,
        });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, path: req.url }));
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    proxy = await startProxy({
      port: 0,
      upstream: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    });
  });

  afterAll(async () => {
    await proxy.close();
    await new Promise((resolve) => upstream.close(resolve));
  });

  beforeEach(() => {
    proxy.reset();
    upstreamHits = [];
  });

  it('passes requests through and captures request and response', async () => {
    const res = await post('/api/agent/v1/sync', '{"a":1}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, path: '/api/agent/v1/sync' });
    expect(upstreamHits).toHaveLength(1);
    const [c] = proxy.captures();
    expect(c).toMatchObject({
      method: 'POST',
      path: '/api/agent/v1/sync',
      requestBody: '{"a":1}',
      requestJson: { a: 1 },
      status: 200,
      fault: null,
    });
    expect(c?.responseJson).toEqual({ ok: true, path: '/api/agent/v1/sync' });
  });

  it('decompresses gzip request bodies in captures and forwards them unchanged', async () => {
    const res = await fetch(url('/x'), {
      method: 'POST',
      body: gzipSync('{"big":true}'),
      headers: { 'content-encoding': 'gzip', 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(proxy.captures()[0]?.requestJson).toEqual({ big: true });
    expect(upstreamHits[0]?.headers['content-encoding']).toBe('gzip');
  });

  it('down: the connection is dropped and nothing reaches the backend', async () => {
    proxy.setMode('down');
    await expect(post('/api/agent/v1/sync', '{}')).rejects.toThrow();
    expect(upstreamHits).toHaveLength(0);
    expect(proxy.captures()[0]).toMatchObject({ fault: 'down', status: null });
  });

  it('500: answers a retryable persistence_failed envelope without forwarding', async () => {
    proxy.setMode('500');
    const res = await post('/api/agent/v1/sync', '{}');
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'persistence_failed', retryable: true },
    });
    expect(upstreamHits).toHaveLength(0);
  });

  it('drop-response: the backend processes the request, the client never sees the answer', async () => {
    proxy.setMode('drop-response');
    await expect(post('/api/agent/v1/sync', '{"n":1}')).rejects.toThrow();
    expect(upstreamHits).toHaveLength(1);
    expect(proxy.captures()[0]).toMatchObject({ fault: 'drop-response', status: 200 });
    expect(proxy.captures()[0]?.responseJson).toEqual({ ok: true, path: '/api/agent/v1/sync' });
  });

  it('slow: the backend answers at once, the client gets it after the delay', async () => {
    proxy.setMode('slow', { delayMs: 300 });
    const started = Date.now();
    const pending = post('/y', '{}');
    await new Promise((r) => setTimeout(r, 100));
    expect(upstreamHits).toHaveLength(1);
    expect(proxy.captures()[0]?.state).toBe('delaying');
    const res = await pending;
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
    expect(proxy.captures()[0]?.state).toBe('done');
  });

  it('scopes a fault to one exact path and to a number of requests', async () => {
    proxy.setMode('500', { only: '/api/agent/v1/sync', times: 1 });
    expect((await post('/api/agent/v1/heartbeat', '{}')).status).toBe(200);
    expect((await fetch(url('/api/agent/v1/sync/status'))).status).toBe(200);
    expect((await post('/api/agent/v1/sync', '{}')).status).toBe(500);
    expect((await post('/api/agent/v1/sync', '{}')).status).toBe(200);
    expect(proxy.mode()).toBe('pass');
  });

  it('injects extra request headers (e.g. a forwarded source IP)', async () => {
    proxy.setHeaders({ 'x-forwarded-for': '203.0.113.9' });
    await post('/z', '{}');
    expect(upstreamHits[0]?.headers['x-forwarded-for']).toBe('203.0.113.9');
    expect(proxy.captures()[0]?.injectedHeaders).toEqual({ 'x-forwarded-for': '203.0.113.9' });
  });
});
