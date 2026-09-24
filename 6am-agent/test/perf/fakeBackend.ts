/**
 * Minimal Sync API v1 backend for the H31 perf run (docs/contracts/sync-api-v1.md). It answers
 * register, settings, heartbeat and sync per the contract, enforces the §6.1 envelope limits,
 * validates every sync body with the agent-strict zod schema, and digests the bodies so two runs
 * can prove the agent sent the same payload bytes.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';
import {
  SYNC_LIMITS,
  SyncRequestSchema,
  type TrackingSettings,
} from '../../src/core/contract/index.js';

export const PERF_DEVICE_ID = 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W';
export const PERF_PAIRING_CODE = 'PERF-H31';

export interface SyncTotals {
  batches: number;
  bodyBytes: number;
  wireBytes: number;
  maxBodyBytes: number;
  sessions: number;
  usage: number;
  projects: number;
  accounts: number;
  messages: number;
  /** sha256 over every body with its per-run values (batch_id, observed_at) blanked. */
  digest: string;
  errors: string[];
}

export interface FakeBackend {
  url: string;
  totals(): SyncTotals;
  close(): Promise<void>;
}

const DEFAULT_SETTINGS: TrackingSettings = {
  version: 1,
  categories: {
    session: true,
    usage: true,
    project: true,
    model: true,
    device: true,
    account: true,
    prompt: false,
    git: false,
    network: false,
  },
  initial_sync: { range: 'all', since: null },
  sync_interval_seconds: 120,
  heartbeat_interval_seconds: 300,
  min_agent_version: '0.0.1',
};

const now = () => new Date().toISOString();

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Settings-Version': String(DEFAULT_SETTINGS.version),
  });
  res.end(text);
}

function fail(res: ServerResponse, status: number, code: string, message: string): void {
  send(res, status, { success: false, error: { code, message, retryable: false } });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  return Buffer.concat(parts);
}

/** Settings: the contract defaults except `initial_sync: all`; `prompt` turns Prompt tracking ON. */
export function startFakeBackend(port: number, o: { prompt?: boolean } = {}): Promise<FakeBackend> {
  const settings: TrackingSettings = {
    ...DEFAULT_SETTINGS,
    categories: { ...DEFAULT_SETTINGS.categories, prompt: o.prompt === true },
  };
  const digest = createHash('sha256');
  const t: Omit<SyncTotals, 'digest'> = {
    batches: 0,
    bodyBytes: 0,
    wireBytes: 0,
    maxBodyBytes: 0,
    sessions: 0,
    usage: 0,
    projects: 0,
    accounts: 0,
    messages: 0,
    errors: [],
  };
  let cursor = 0;

  const sync = (wire: Buffer, gzip: boolean, res: ServerResponse): void => {
    const body = gzip ? gunzipSync(wire) : wire;
    if (body.length > SYNC_LIMITS.maxBodyBytes) {
      t.errors.push(`body ${body.length} > 2 MB`);
      fail(res, 413, 'batch_too_large', 'Body too large.');
      return;
    }
    const parsed = SyncRequestSchema.safeParse(JSON.parse(body.toString('utf8')));
    if (!parsed.success) {
      t.errors.push(`invalid payload: ${parsed.error.issues[0]?.message ?? '?'}`);
      fail(res, 422, 'invalid_payload', 'Invalid payload.');
      return;
    }
    const req = parsed.data;
    t.batches += 1;
    t.bodyBytes += body.length;
    t.wireBytes += wire.length;
    t.maxBodyBytes = Math.max(t.maxBodyBytes, body.length);
    t.sessions += req.sessions.length;
    t.usage += req.usage.length;
    t.projects += req.projects.length;
    t.accounts += req.accounts.length;
    t.messages += req.messages.length;
    // The exact body bytes, minus the two values that differ on every run.
    digest.update(
      body
        .toString('utf8')
        .replace(/"batch_id":"[^"]*"/g, '"batch_id":""')
        .replace(/"observed_at":"[^"]*"/g, '"observed_at":""'),
    );
    const records =
      req.accounts.length +
      req.projects.length +
      req.sessions.length +
      req.usage.length +
      req.messages.length;
    cursor += 1;
    send(res, 200, {
      success: true,
      batch_id: req.sync.batch_id,
      sync: { accepted: records, created: records, updated: 0, rejected: 0 },
      rejected_records: [],
      cursor: `perf-cursor-${cursor}`,
      settings_version: settings.version,
      server_time: now(),
    });
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const route = `${req.method ?? ''} ${(req.url ?? '').replace(/^\/api\/agent\/v1/, '')}`;
    const wire = await readBody(req);
    switch (route) {
      case 'POST /register':
        send(res, 200, {
          device_id: PERF_DEVICE_ID,
          token: 'perf-token',
          developer: { name: 'Perf Developer', email: 'perf.developer@example.com' },
          settings,
        });
        return;
      case 'GET /settings':
        send(res, 200, settings);
        return;
      case 'POST /heartbeat':
        send(res, 200, {
          server_time: now(),
          settings_version: settings.version,
          sync_requested: false,
        });
        return;
      case 'POST /sync':
        sync(wire, req.headers['content-encoding'] === 'gzip', res);
        return;
      default:
        fail(res, 422, 'invalid_payload', 'Unknown route.');
    }
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      t.errors.push(err instanceof Error ? err.message : String(err));
      fail(res, 500, 'persistence_failed', 'Server error.');
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        totals: () => ({ ...t, errors: [...t.errors], digest: digest.copy().digest('hex') }),
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
