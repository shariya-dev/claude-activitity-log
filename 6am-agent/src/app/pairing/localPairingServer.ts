import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PAIRING_PAGE_HTML } from './page.js';

export type PairingProgress =
  | { phase: 'waiting' }
  | { phase: 'registering' }
  | { phase: 'detecting'; developer: string }
  | { phase: 'syncing'; developer: string; sessions: number; usage: number }
  | {
      phase: 'done';
      developer: string;
      claudeFound: boolean;
      sessions: number;
      usage: number;
    }
  | { phase: 'error'; message: string };

export interface PairingServer {
  readonly url: string;
  readonly address: string;
  readonly port: number;
  progress(): PairingProgress;
  setProgress(p: PairingProgress): void;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 1024;
const MAX_CODE_CHARS = 32;

function tokenMatches(given: string, expected: Buffer): boolean {
  const buf = Buffer.from(given);
  return buf.length === expected.length && timingSafeEqual(buf, expected);
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  type = 'application/json; charset=utf-8',
): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value));
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

function parseCode(body: string | null): string | null {
  if (body === null) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const code = (parsed as { code?: unknown }).code;
    if (typeof code !== 'string') return null;
    const trimmed = code.trim();
    return trimmed.length === 0 || trimmed.length > MAX_CODE_CHARS ? null : trimmed;
  } catch {
    return null;
  }
}

/**
 * The one interactive step (PRD §5, §9): a single-page pairing UI on 127.0.0.1 only, under a
 * random one-time URL token. It accepts a code, hands it to `onCode`, and exposes progress as
 * JSON for the page to poll. Requests with a foreign Host (DNS rebinding) or Origin are refused.
 */
export async function startPairingServer(o: {
  onCode: (code: string) => void;
  token?: string;
}): Promise<PairingServer> {
  const token = o.token ?? randomBytes(24).toString('base64url');
  const expected = Buffer.from(token);
  let progress: PairingProgress = { phase: 'waiting' };
  let port = 0;

  const accepting = (): boolean => progress.phase === 'waiting' || progress.phase === 'error';

  const server = createServer((req, res) => {
    void (async () => {
      const allowedHost = `${HOST}:${port}`;
      if (req.headers.host !== allowedHost) {
        send(res, 403, 'forbidden', 'text/plain; charset=utf-8');
        return;
      }
      const url = new URL(req.url ?? '/', `http://${allowedHost}`);
      const match = /^\/pair\/([^/]+)(\/status|\/code)?$/.exec(url.pathname);
      if (match === null || !tokenMatches(match[1] ?? '', expected)) {
        send(res, 404, 'not found', 'text/plain; charset=utf-8');
        return;
      }
      const action = match[2] ?? '';

      if (action === '' && req.method === 'GET') {
        send(res, 200, PAIRING_PAGE_HTML, 'text/html; charset=utf-8');
        return;
      }
      if (action === '/status' && req.method === 'GET') {
        sendJson(res, 200, progress);
        return;
      }
      if (action === '/code' && req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin !== undefined && origin !== `http://${allowedHost}`) {
          send(res, 403, 'forbidden', 'text/plain; charset=utf-8');
          return;
        }
        const code = parseCode(await readBody(req));
        if (code === null) {
          sendJson(res, 422, { message: 'Enter the pairing code shown in the dashboard.' });
          return;
        }
        if (!accepting()) {
          sendJson(res, 409, progress);
          return;
        }
        progress = { phase: 'registering' };
        o.onCode(code);
        sendJson(res, 202, progress);
        return;
      }
      send(res, 405, 'method not allowed', 'text/plain; charset=utf-8');
    })().catch(() => {
      if (!res.headersSent) send(res, 500, 'error', 'text/plain; charset=utf-8');
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const addr = server.address() as AddressInfo;
  port = addr.port;

  let closing: Promise<void> | null = null;
  return {
    url: `http://${HOST}:${port}/pair/${token}`,
    address: addr.address,
    port,
    progress: () => progress,
    setProgress(p) {
      progress = p;
    },
    close() {
      closing ??= new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
