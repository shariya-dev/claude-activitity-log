/**
 * Fault-injecting pass-through between the agent and the backend (H22).
 *
 *   pass           forward the request, return the backend's answer
 *   down           drop the connection without an answer; nothing reaches the backend
 *   500            answer a retryable `persistence_failed` envelope; nothing reaches the backend
 *   slow           forward at once (the backend commits), deliver its answer after `delayMs`
 *   drop-response  forward (the backend commits), then drop the connection: the agent never
 *                  sees the answer. This is the duplicate-sync case (contract §8.2).
 *
 * A fault can be scoped to request paths (`only`) and to a number of requests (`times`), after
 * which the proxy falls back to `pass`. Every request is captured with its decoded body and the
 * backend's answer, so tests can inspect exactly what the agent sent.
 *
 * Standalone: `npm run proxy` (listens on 8766, forwards to 8765).
 */
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';

export type ProxyMode = 'pass' | 'down' | '500' | 'slow' | 'drop-response';

export interface ModeOptions {
  /** Apply the fault only to requests for exactly this path (query ignored); others pass. */
  only?: string;
  /** Apply the fault to this many matching requests, then switch back to `pass`. */
  times?: number;
  /** `slow`: how long the answer is held back. */
  delayMs?: number;
}

export interface Capture {
  id: number;
  at: string;
  method: string;
  path: string;
  requestHeaders: Record<string, string | string[] | undefined>;
  injectedHeaders: Record<string, string>;
  /** Decoded (gunzipped) request body. */
  requestBody: string;
  requestJson: unknown;
  /** The fault applied to this request, or null when it passed through. */
  fault: Exclude<ProxyMode, 'pass'> | null;
  /** The backend's (or the injected 500's) status; null when nothing answered. */
  status: number | null;
  responseBody: string | null;
  responseJson: unknown;
  /** `delaying` while a slow answer is held back; `done` once the proxy handled it. */
  state: 'forwarding' | 'delaying' | 'done';
}

export interface Proxy {
  port: number;
  setMode(mode: ProxyMode, options?: ModeOptions): void;
  mode(): ProxyMode;
  setHeaders(headers: Record<string, string>): void;
  captures(): Capture[];
  /** Back to `pass`, no injected headers, no captures. */
  reset(): void;
  close(): Promise<void>;
}

const PERSISTENCE_FAILED = JSON.stringify({
  success: false,
  error: {
    code: 'persistence_failed',
    message: 'The batch could not be stored. Retry later.',
    retryable: true,
  },
});

function parseJson(text: string | null): unknown {
  if (text === null || text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function decode(body: Buffer, encoding: string | undefined): string {
  if (encoding === 'gzip') {
    try {
      return gunzipSync(body).toString('utf8');
    } catch {
      return '';
    }
  }
  return body.toString('utf8');
}

interface Upstream {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function forward(
  target: URL,
  req: IncomingMessage,
  body: Buffer,
  extra: Record<string, string>,
): Promise<Upstream> {
  return new Promise((resolve, reject) => {
    const headers = { ...req.headers, ...extra, host: target.host };
    delete headers.connection;
    headers['content-length'] = String(body.length);
    const out = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 502,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', reject);
      },
    );
    out.on('error', reject);
    out.end(body);
  });
}

export async function startProxy(o: { port: number; upstream: string }): Promise<Proxy> {
  const target = new URL(o.upstream);
  let mode: ProxyMode = 'pass';
  let options: ModeOptions = {};
  let remaining: number | null = null;
  let injected: Record<string, string> = {};
  let captures: Capture[] = [];
  let nextId = 1;

  /** The fault for this request (consuming one of `times`), or null to pass. */
  const faultFor = (path: string): Capture['fault'] => {
    if (mode === 'pass') return null;
    if (options.only !== undefined && path.split('?')[0] !== options.only) return null;
    const fault = mode;
    if (remaining !== null) {
      remaining -= 1;
      if (remaining <= 0) {
        mode = 'pass';
        options = {};
        remaining = null;
      }
    }
    return fault;
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      const path = req.url ?? '/';
      const requestBody = decode(raw, req.headers['content-encoding'] as string | undefined);
      const delayMs = options.delayMs ?? 0;
      const fault = faultFor(path);
      const capture: Capture = {
        id: nextId++,
        at: new Date().toISOString(),
        method: req.method ?? 'GET',
        path,
        requestHeaders: { ...req.headers },
        injectedHeaders: { ...injected },
        requestBody,
        requestJson: parseJson(requestBody),
        fault,
        status: null,
        responseBody: null,
        responseJson: null,
        state: 'forwarding',
      };
      captures.push(capture);

      if (fault === 'down') {
        capture.state = 'done';
        req.socket.destroy();
        return;
      }
      if (fault === '500') {
        capture.status = 500;
        capture.responseBody = PERSISTENCE_FAILED;
        capture.responseJson = parseJson(PERSISTENCE_FAILED);
        capture.state = 'done';
        res.writeHead(500, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(PERSISTENCE_FAILED),
        });
        res.end(PERSISTENCE_FAILED);
        return;
      }

      let answer: Upstream;
      try {
        answer = await forward(target, req, raw, capture.injectedHeaders);
      } catch {
        capture.state = 'done';
        req.socket.destroy();
        return;
      }
      capture.status = answer.status;
      capture.responseBody = answer.body.toString('utf8');
      capture.responseJson = parseJson(capture.responseBody);

      if (fault === 'drop-response') {
        capture.state = 'done';
        req.socket.destroy();
        return;
      }
      if (fault === 'slow') {
        capture.state = 'delaying';
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const headers = { ...answer.headers };
      delete headers['transfer-encoding'];
      delete headers.connection;
      headers['content-length'] = String(answer.body.length);
      capture.state = 'done';
      if (req.socket.destroyed) return;
      res.writeHead(answer.status, headers);
      res.end(answer.body);
    })().catch(() => {
      req.socket.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, '127.0.0.1', () => resolve());
  });

  return {
    port: (server.address() as AddressInfo).port,
    setMode(next, opts = {}) {
      mode = next;
      options = opts;
      remaining = opts.times ?? null;
    },
    mode: () => mode,
    setHeaders(headers) {
      injected = { ...headers };
    },
    captures: () => captures,
    reset() {
      mode = 'pass';
      options = {};
      remaining = null;
      injected = {};
      captures = [];
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// `npm run proxy`: a standalone pass-through for manual debugging.
if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const port = Number(process.env.E2E_PROXY_PORT ?? 8766);
  const upstream = process.env.E2E_UPSTREAM ?? 'http://127.0.0.1:8765';
  void startProxy({ port, upstream }).then((p) => {
    process.stdout.write(`proxy on 127.0.0.1:${p.port} -> ${upstream} (mode pass)\n`);
  });
}
