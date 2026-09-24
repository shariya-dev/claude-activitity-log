import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startPairingServer,
  type PairingServer,
} from '../../../src/app/pairing/localPairingServer.js';

interface RawResponse {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function raw(
  port: number,
  o: { path: string; method?: string; host?: string; body?: string; origin?: string },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: o.path,
        method: o.method ?? 'GET',
        headers: {
          host: o.host ?? `127.0.0.1:${port}`,
          ...(o.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(o.origin === undefined ? {} : { origin: o.origin }),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d: string) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on('error', reject);
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

describe('localPairingServer', () => {
  let server: PairingServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('binds 127.0.0.1 on a random port and serves the page only under the URL token', async () => {
    server = await startPairingServer({ onCode: vi.fn() });
    expect(server.address).toBe('127.0.0.1');
    expect(server.port).toBeGreaterThan(0);
    const url = new URL(server.url);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.pathname).toMatch(/^\/pair\/[A-Za-z0-9_-]{32,}$/);

    const page = await raw(server.port, { path: url.pathname });
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.body).toContain('<form');
    expect(page.body).not.toMatch(/<script[^>]+src=|<link[^>]+href=|https?:\/\//);
    expect(page.headers['cache-control']).toBe('no-store');
  });

  it('rejects a wrong URL token and unknown paths', async () => {
    server = await startPairingServer({ onCode: vi.fn() });
    expect((await raw(server.port, { path: '/pair/wrong-token' })).status).toBe(404);
    expect((await raw(server.port, { path: '/' })).status).toBe(404);
    const token = new URL(server.url).pathname.split('/')[2] ?? '';
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect((await raw(server.port, { path: `/pair/${tampered}/status` })).status).toBe(404);
  });

  it('rejects a foreign Host header (DNS rebinding) and a foreign Origin on POST', async () => {
    const onCode = vi.fn();
    server = await startPairingServer({ onCode });
    const base = new URL(server.url).pathname;
    expect((await raw(server.port, { path: base, host: 'evil.test' })).status).toBe(403);
    const post = await raw(server.port, {
      path: `${base}/code`,
      method: 'POST',
      body: JSON.stringify({ code: 'K7Q2-M9XD' }),
      origin: 'https://evil.test',
    });
    expect(post.status).toBe(403);
    expect(onCode).not.toHaveBeenCalled();
  });

  it('hands a submitted code to onCode and reports progress on the status endpoint', async () => {
    const onCode = vi.fn();
    server = await startPairingServer({ onCode });
    const base = new URL(server.url).pathname;

    const initial = await raw(server.port, { path: `${base}/status` });
    expect(JSON.parse(initial.body)).toEqual({ phase: 'waiting' });

    const post = await raw(server.port, {
      path: `${base}/code`,
      method: 'POST',
      body: JSON.stringify({ code: '  K7Q2-M9XD ' }),
      origin: `http://127.0.0.1:${server.port}`,
    });
    expect(post.status).toBe(202);
    expect(onCode).toHaveBeenCalledWith('K7Q2-M9XD');
    expect(server.progress()).toEqual({ phase: 'registering' });

    // A second submit while registering is refused.
    const again = await raw(server.port, {
      path: `${base}/code`,
      method: 'POST',
      body: JSON.stringify({ code: 'OTHER' }),
    });
    expect(again.status).toBe(409);

    server.setProgress({ phase: 'syncing', developer: 'Dev Example', sessions: 1, usage: 3 });
    const status = await raw(server.port, { path: `${base}/status` });
    expect(JSON.parse(status.body)).toEqual({
      phase: 'syncing',
      developer: 'Dev Example',
      sessions: 1,
      usage: 3,
    });
  });

  it('accepts a new code after an error and rejects empty or oversized codes', async () => {
    const onCode = vi.fn();
    server = await startPairingServer({ onCode });
    const base = new URL(server.url).pathname;
    server.setProgress({ phase: 'error', message: 'The pairing code is invalid or has expired.' });

    const empty = await raw(server.port, {
      path: `${base}/code`,
      method: 'POST',
      body: JSON.stringify({ code: '   ' }),
    });
    expect(empty.status).toBe(422);
    const long = await raw(server.port, {
      path: `${base}/code`,
      method: 'POST',
      body: JSON.stringify({ code: 'X'.repeat(33) }),
    });
    expect(long.status).toBe(422);

    const ok = await raw(server.port, {
      path: `${base}/code`,
      method: 'POST',
      body: JSON.stringify({ code: 'ABCD' }),
    });
    expect(ok.status).toBe(202);
    expect(onCode).toHaveBeenCalledTimes(1);
  });

  it('close() stops listening', async () => {
    server = await startPairingServer({ onCode: vi.fn() });
    const port = server.port;
    await server.close();
    server = null;
    await expect(raw(port, { path: '/' })).rejects.toThrow();
  });
});
