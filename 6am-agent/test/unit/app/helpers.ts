import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type {
  RegisterRequest,
  SyncRequest,
  TrackingSettings,
} from '../../../src/core/contract/index.js';
import { createFakeAdapter, type FakeAdapter } from '../../helpers/fakeAdapter.js';
import { okSyncResponse } from '../../helpers/fakes/apiClient.js';
import { makeSettings } from '../../helpers/fakes/settings.js';

export const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures/claude');
export const DEVICE_ID = 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W';
export const SECRET_TOKEN = 'tok-SECRET-9f8e7d6c5b4a';
export const VALID_CODE = 'K7Q2-M9XD';

export interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A route-based fake of the agent API (sync-api-v1). Records every call. */
export class FakeBackend {
  calls: RecordedCall[] = [];
  settings: TrackingSettings = makeSettings({ initial_sync: { range: 'all', since: null } });
  /** When set, every authenticated call answers 401. */
  revoked = false;

  readonly fetch: typeof fetch = (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    let body: unknown = null;
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    else if (init.body instanceof Uint8Array) {
      body = JSON.parse(gunzipSync(init.body).toString('utf8'));
    }
    const route = url.pathname.replace(/^\/api\/agent\/v1/, '');
    const method = (init.method ?? 'GET').toUpperCase();
    this.calls.push({ method, path: route, headers, body });
    return Promise.resolve(this.respond(method, route, headers, body));
  };

  paths(): string[] {
    return this.calls.map((c) => `${c.method} ${c.path}`);
  }

  count(method: string, route: string): number {
    return this.calls.filter((c) => c.method === method && c.path === route).length;
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
        'x-settings-version': String(this.settings.version),
      },
    });
  }

  private respond(
    method: string,
    route: string,
    headers: Record<string, string>,
    body: unknown,
  ): Response {
    if (method === 'POST' && route === '/register') {
      const req = body as RegisterRequest;
      if (req.pairing_code !== VALID_CODE) {
        return this.json(422, {
          success: false,
          error: {
            code: 'invalid_pairing_code',
            message: 'The pairing code is invalid or has expired.',
            retryable: false,
          },
        });
      }
      return this.json(201, {
        device_id: DEVICE_ID,
        token: SECRET_TOKEN,
        developer: { name: 'Dev Example', email: 'dev@example.com' },
        settings: this.settings,
      });
    }
    if (this.revoked || headers.authorization !== `Bearer ${SECRET_TOKEN}`) {
      return this.json(401, {
        success: false,
        error: { code: 'unauthenticated', message: 'Unauthenticated.', retryable: false },
      });
    }
    if (method === 'GET' && route === '/settings') return this.json(200, this.settings);
    if (method === 'POST' && route === '/heartbeat') {
      return this.json(200, {
        server_time: '2026-09-24T00:00:00Z',
        settings_version: this.settings.version,
        sync_requested: false,
      });
    }
    if (method === 'POST' && route === '/sync') {
      return this.json(200, okSyncResponse(body as SyncRequest));
    }
    if (method === 'POST' && route === '/deregister') return new Response(null, { status: 204 });
    return this.json(404, { success: false, error: { code: 'not_found', message: 'x' } });
  }
}

export interface TestEnv {
  root: string;
  dataDir: string;
  claudeDir: string;
  buildConfigPath: string;
  adapter: FakeAdapter;
  backend: FakeBackend;
  cleanup(): void;
}

/**
 * A temp root with a dev build-config, an app data dir, and a Claude data dir holding the
 * basic-session fixture under projects/ plus `.claude.json`. `claude: false` leaves it empty.
 */
export function makeEnv(o: { channel?: 'dev' | 'stable'; claude?: boolean } = {}): TestEnv {
  const root = mkdtempSync(path.join(tmpdir(), 'h18-app-'));
  const dataDir = path.join(root, 'data');
  const claudeDir = path.join(root, 'claude');
  if (o.claude !== false) {
    const project = path.join(claudeDir, 'projects', '-home-dev-projects-demo-app');
    mkdirSync(project, { recursive: true });
    copyFileSync(
      path.join(FIXTURES, 'basic-session.jsonl'),
      path.join(project, '0b7c1a2e-4f3d-4a8b-9c1d-000000000001.jsonl'),
    );
    copyFileSync(path.join(FIXTURES, 'claude.json'), path.join(claudeDir, '.claude.json'));
  }
  const buildConfigPath = path.join(root, 'build-config.json');
  const channel = o.channel ?? 'dev';
  writeFileSync(
    buildConfigPath,
    JSON.stringify({
      apiBaseUrl: channel === 'dev' ? 'https://dev.monitor.test' : 'https://monitor.test',
      channel,
    }),
  );
  const adapter = createFakeAdapter({
    appDataDir: dataDir,
    claudeDataCandidates: [claudeDir],
    claudeGlobalConfigCandidates: [path.join(claudeDir, '.claude.json')],
  });
  return {
    root,
    dataDir,
    claudeDir,
    buildConfigPath,
    adapter,
    backend: new FakeBackend(),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
