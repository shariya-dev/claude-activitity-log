/**
 * Per-scenario harness: an isolated developer + pairing code, temp HOME / CLAUDE_CONFIG_DIR /
 * AGENT_DATA_DIR built from the H02 fixtures, the fault-injecting proxy on :8766, and helpers to
 * drive the real built agent (`agent(cmd)`, `startAgentDaemon()`) and inspect the real database
 * (`sql`, `dbCount`) and the agent's own state.db (`checkpoints`, `kv`).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inject } from 'vitest';
import {
  clearRateLimits,
  createDeveloperWithCode,
  dbCount as backendCount,
  issuePairingCode,
  sql as backendSql,
  updateSettings,
} from './lib/backend.js';
import { startProxy, type Capture, type Proxy } from './lib/proxy.js';

export type { Capture } from './lib/proxy.js';

export const SYNC_PATH = '/api/agent/v1/sync';
export const HEARTBEAT_PATH = '/api/agent/v1/heartbeat';
export const REGISTER_PATH = '/api/agent/v1/register';
/** `subject_type` / `tokenable_type` of a Device (no morph map is configured). */
export const DEVICE_MORPH = 'App\\Models\\Device';

/** Claude Code's project-dir encoding of the fixtures' cwd `/home/dev/projects/demo-app`. */
const PROJECT_DIR_NAME = '-home-dev-projects-demo-app';

/** The H02 fixtures a scenario's Claude data dir is built from: file → session id. */
const FIXTURE_FILES = {
  'basic-session.jsonl': '0b7c1a2e-4f3d-4a8b-9c1d-000000000001',
  'multi-model.jsonl': '0b7c1a2e-4f3d-4a8b-9c1d-000000000003',
  'malformed.jsonl': '0b7c1a2e-4f3d-4a8b-9c1d-000000000004',
  'split-usage-growing.jsonl': '0b7c1a2e-4f3d-4a8b-9c1d-000000000005',
} as const;
const SUBAGENT_SESSION = '0b7c1a2e-4f3d-4a8b-9c1d-000000000002';
const EXPECTED_FILES = [
  'basic-session.json',
  'subagent.json',
  'multi-model.json',
  'malformed.json',
  'split-usage-growing.json',
];

export const SESSION = {
  basic: FIXTURE_FILES['basic-session.jsonl'],
  subagent: SUBAGENT_SESSION,
  multiModel: FIXTURE_FILES['multi-model.jsonl'],
  malformed: FIXTURE_FILES['malformed.jsonl'],
  splitUsage: FIXTURE_FILES['split-usage-growing.jsonl'],
} as const;

export interface TokenTotals {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  actual: number;
  total: number;
}

interface ExpectedFixture {
  sessions: { source_session_id: string }[];
  usage: { source_message_id: string; model: string }[];
  messages: { source_message_id: string; content: string }[];
  projects: { path: string }[];
  tokenSums: TokenTotals;
}

export interface ExpectedDataset {
  sessions: string[];
  usageIds: string[];
  models: string[];
  projectPaths: string[];
  prompts: string[];
  perSession: Record<string, TokenTotals>;
  totals: TokenTotals;
}

/** The fixture contract (H02 `expected/*.json`) summed over the files a scenario starts with. */
export function expectedDataset(fixturesDir: string): ExpectedDataset {
  const fixtures = EXPECTED_FILES.map(
    (f) =>
      JSON.parse(readFileSync(path.join(fixturesDir, 'expected', f), 'utf8')) as ExpectedFixture,
  );
  const zero: TokenTotals = {
    input: 0,
    output: 0,
    cache_creation: 0,
    cache_read: 0,
    actual: 0,
    total: 0,
  };
  const totals = { ...zero };
  const perSession: Record<string, TokenTotals> = {};
  for (const f of fixtures) {
    const sid = f.sessions[0]?.source_session_id ?? '';
    perSession[sid] = { ...f.tokenSums };
    for (const k of Object.keys(totals) as (keyof TokenTotals)[]) totals[k] += f.tokenSums[k];
  }
  return {
    sessions: fixtures.flatMap((f) => f.sessions.map((s) => s.source_session_id)).sort(),
    usageIds: fixtures.flatMap((f) => f.usage.map((u) => u.source_message_id)).sort(),
    models: [...new Set(fixtures.flatMap((f) => f.usage.map((u) => u.model)))].sort(),
    projectPaths: [...new Set(fixtures.flatMap((f) => f.projects.map((p) => p.path)))].sort(),
    prompts: fixtures.flatMap((f) => f.messages.map((m) => m.content)),
    perSession,
    totals,
  };
}

export interface AgentResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface Daemon {
  pid: number;
  output(): string;
  exited: Promise<AgentResult>;
  /** Graceful stop (SIGTERM), as the service manager does. */
  stop(): Promise<AgentResult>;
  /** `kill -9`. */
  kill(): Promise<AgentResult>;
}

export interface Checkpoint {
  path: string;
  file_identity: string;
  size: number;
  mtime_ms: number;
  offset: number;
}

export async function waitFor<T>(
  what: string,
  fn: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  o: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + (o.timeoutMs ?? 30_000);
  let last: unknown = null;
  for (;;) {
    try {
      const value = await fn();
      if (value !== null && value !== undefined && value !== false) return value;
    } catch (err) {
      last = err;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for ${what}${last === null ? '' : ` (last error: ${String(last)})`}`,
      );
    }
    await new Promise((r) => setTimeout(r, o.intervalMs ?? 200));
  }
}

export function appendLines(file: string, lines: unknown[]): void {
  appendFileSync(file, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
}

/** Fails loudly unless `dir` is inside the OS temp dir and is not the developer's real Claude dir. */
export function assertTempClaudeDir(dir: string): void {
  const real = realpathSync(dir);
  const tmp = realpathSync(tmpdir());
  if (!real.startsWith(`${tmp}${path.sep}`)) {
    throw new Error(`CLAUDE_CONFIG_DIR ${real} is not under the temp dir ${tmp}`);
  }
  const home = homedir();
  for (const forbidden of [path.join(home, '.claude'), path.join(home, '.config', 'claude')]) {
    if (existsSync(forbidden) && real === realpathSync(forbidden)) {
      throw new Error(`CLAUDE_CONFIG_DIR resolves to the real Claude data dir ${forbidden}`);
    }
  }
}

export type Scenario = Awaited<ReturnType<typeof createScenario>>;

/** Agent processes still running in this worker: killed if the worker exits early (crash, timeout). */
const liveChildren = new Set<ChildProcess>();
process.on('exit', () => {
  for (const child of liveChildren) child.kill('SIGKILL');
});

export async function createScenario(name: string) {
  const ctx = inject('e2e');
  const backend = ctx.backend;
  // Every scenario starts from the same settings and fresh rate limits, whatever ran before.
  await updateSettings(backend);
  await clearRateLimits(backend);

  const root = path.join(ctx.runDir, name);
  const dirs = {
    root,
    home: path.join(root, 'home'),
    claudeDir: path.join(root, 'claude'),
    dataDir: path.join(root, 'agent-data'),
    projectDir: path.join(root, 'claude', 'projects', PROJECT_DIR_NAME),
  };
  mkdirSync(dirs.home, { recursive: true });
  mkdirSync(dirs.projectDir, { recursive: true });
  for (const [file, sid] of Object.entries(FIXTURE_FILES)) {
    cpSync(path.join(ctx.fixturesDir, file), path.join(dirs.projectDir, `${sid}.jsonl`));
  }
  cpSync(path.join(ctx.fixturesDir, 'subagent'), dirs.projectDir, { recursive: true });
  cpSync(path.join(ctx.fixturesDir, 'claude.json'), path.join(dirs.claudeDir, '.claude.json'));
  assertTempClaudeDir(dirs.claudeDir);

  const developer = await createDeveloperWithCode(backend, `e2e-${name}-${Date.now()}`);
  const proxy: Proxy = await startProxy({ port: ctx.proxyPort, upstream: ctx.backendUrl });
  /** Every agent process this scenario started (one-shot commands and daemons). */
  const children = new Set<ChildProcess>();

  /** The agent's environment: temp HOME and dirs only, so nothing real is reachable. */
  const agentEnv = (): NodeJS.ProcessEnv => ({
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    LANG: 'en_US.UTF-8',
    HOME: dirs.home,
    CLAUDE_CONFIG_DIR: dirs.claudeDir,
    AGENT_DATA_DIR: dirs.dataDir,
    AGENT_CREDENTIAL_BACKEND: 'file',
    AGENT_API_BASE_URL: `http://127.0.0.1:${ctx.proxyPort}`,
    AGENT_ALLOW_INSECURE_LOCALHOST: '1',
  });

  const launch = (args: string[]): ChildProcess => {
    const child = spawn(ctx.agentNode, [ctx.agentEntry, ...args], {
      cwd: dirs.root,
      env: agentEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    liveChildren.add(child);
    child.on('exit', () => {
      children.delete(child);
      liveChildren.delete(child);
    });
    return child;
  };

  const collect = (child: ChildProcess) => {
    let out = '';
    let err = '';
    child.stdout?.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr?.on('data', (c: Buffer) => (err += c.toString()));
    const exited = new Promise<AgentResult>((resolve) => {
      child.on('exit', (code, signal) => {
        // Let the pipes drain before reporting.
        setImmediate(() => resolve({ code, signal, stdout: out, stderr: err }));
      });
    });
    return { exited, output: () => out + err };
  };

  const scn = {
    ctx,
    name,
    dirs,
    developer,
    proxy,
    expected: expectedDataset(ctx.fixturesDir),

    sessionFile(sessionId: string): string {
      return path.join(dirs.projectDir, `${sessionId}.jsonl`);
    },

    /** Runs one agent CLI command to completion (e.g. `pair <code>`, `sync-now`, `status --json`). */
    async agent(args: string[], o: { timeoutMs?: number } = {}): Promise<AgentResult> {
      const child = launch(args);
      const { exited } = collect(child);
      const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 60_000);
      const result = await exited;
      clearTimeout(timer);
      return result;
    },

    async pair(code = developer.code): Promise<AgentResult> {
      const result = await scn.agent(['pair', code]);
      if (result.code !== 0) throw new Error(`pair failed (${result.code}): ${result.stderr}`);
      return result;
    },

    async status(): Promise<Record<string, unknown>> {
      const result = await scn.agent(['status', '--json']);
      if (result.code !== 0) throw new Error(`status failed: ${result.stderr}`);
      return JSON.parse(result.stdout) as Record<string, unknown>;
    },

    /** `node agent.cjs run`, what the OS service launches. Refuses to start an unpaired agent. */
    async startAgentDaemon(): Promise<Daemon> {
      if ((await scn.status()).paired !== true) {
        throw new Error('startAgentDaemon: pair first (an unpaired daemon would open a browser)');
      }
      const child = launch(['run']);
      const { exited, output } = collect(child);
      const pid = child.pid ?? -1;
      const end = async (signal: NodeJS.Signals): Promise<AgentResult> => {
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
        const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
        const result = await exited;
        clearTimeout(timer);
        return result;
      };
      return { pid, output, exited, stop: () => end('SIGTERM'), kill: () => end('SIGKILL') };
    },

    async sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
      return backendSql<T>(backend, query, params);
    },

    async dbCount(table: string, where?: string, params?: unknown[]): Promise<number> {
      return backendCount(backend, table, where, params);
    },

    /** This scenario's device rows (one developer ⇒ normally exactly one). */
    async devices(): Promise<Record<string, unknown>[]> {
      return backendSql(backend, 'SELECT * FROM devices WHERE developer_id = ? ORDER BY id', [
        developer.developerId,
      ]);
    },

    async deviceId(): Promise<number> {
      const rows = await scn.devices();
      if (rows.length !== 1) throw new Error(`expected one device, found ${rows.length}`);
      return Number(rows[0]?.id);
    },

    /** Row count of a device-scoped table (claude_sessions, session_usage, sync_batches…) for this device. */
    async deviceCount(table: string): Promise<number> {
      return backendCount(backend, table, 'device_id = ?', [await scn.deviceId()]);
    },

    async messageCount(): Promise<number> {
      const rows = await backendSql<{ n: number }>(
        backend,
        `SELECT COUNT(*) AS n FROM session_messages m JOIN claude_sessions s ON s.id = m.claude_session_id
         WHERE s.device_id = ?`,
        [await scn.deviceId()],
      );
      return Number(rows[0]?.n ?? 0);
    },

    /** Sums of the stored token columns for this device (backend TokenMath output). */
    async usageTotals(where = '1 = 1', params: unknown[] = []): Promise<TokenTotals> {
      const [row] = await backendSql<Record<string, string | number | null>>(
        backend,
        `SELECT COALESCE(SUM(input_tokens),0) AS input, COALESCE(SUM(output_tokens),0) AS output,
                COALESCE(SUM(cache_creation_tokens),0) AS cache_creation, COALESCE(SUM(cache_read_tokens),0) AS cache_read,
                COALESCE(SUM(actual_consumed_tokens),0) AS actual, COALESCE(SUM(total_token_activity),0) AS total
         FROM session_usage WHERE device_id = ? AND ${where}`,
        [await scn.deviceId(), ...params],
      );
      return {
        input: Number(row?.input),
        output: Number(row?.output),
        cache_creation: Number(row?.cache_creation),
        cache_read: Number(row?.cache_read),
        actual: Number(row?.actual),
        total: Number(row?.total),
      };
    },

    /** Per-session totals as stored on `claude_sessions` (recomputed by the backend). */
    async sessionTotals(): Promise<Record<string, TokenTotals & { activity_count: number }>> {
      const rows = await backendSql<Record<string, string | number>>(
        backend,
        `SELECT source_session_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
                actual_consumed_tokens, total_token_activity, activity_count
         FROM claude_sessions WHERE device_id = ?`,
        [await scn.deviceId()],
      );
      return Object.fromEntries(
        rows.map((r) => [
          String(r.source_session_id),
          {
            input: Number(r.input_tokens),
            output: Number(r.output_tokens),
            cache_creation: Number(r.cache_creation_tokens),
            cache_read: Number(r.cache_read_tokens),
            actual: Number(r.actual_consumed_tokens),
            total: Number(r.total_token_activity),
            activity_count: Number(r.activity_count),
          },
        ]),
      );
    },

    /** The agent's committed file checkpoints (state.db), keyed by file path. */
    checkpoints(): Map<string, Checkpoint> {
      const file = path.join(dirs.dataDir, 'state.db');
      if (!existsSync(file)) return new Map();
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const rows = db
          .prepare('SELECT path, file_identity, size, mtime_ms, offset FROM file_checkpoints')
          .all() as unknown as Checkpoint[];
        return new Map(rows.map((r) => [r.path, { ...r }]));
      } finally {
        db.close();
      }
    },

    /** A kv value from state.db (JSON-decoded), or null. */
    kv(key: string): unknown {
      const file = path.join(dirs.dataDir, 'state.db');
      if (!existsSync(file)) return null;
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
          { value: string } | undefined;
        return row === undefined ? null : (JSON.parse(row.value) as unknown);
      } finally {
        db.close();
      }
    },

    /** Captured requests, optionally only those for exactly `requestPath` (query ignored). */
    captures(requestPath?: string): Capture[] {
      return proxy
        .captures()
        .filter((c) => requestPath === undefined || c.path.split('?')[0] === requestPath);
    },

    /** `/sync` requests the backend acknowledged with 200 and that reached the agent. */
    acknowledgedSyncs(): Capture[] {
      return scn
        .captures(SYNC_PATH)
        .filter(
          (c) =>
            c.fault === null &&
            c.status === 200 &&
            c.state === 'done' &&
            (c.responseJson as { success?: unknown } | null)?.success === true,
        );
    },

    /**
     * Waits until the agent committed `ack` locally (its cursor is in state.db). The proxy marks a
     * capture done as it answers, a moment before the agent parses the answer and commits.
     */
    async waitForCommit(ack: Capture): Promise<void> {
      const cursor = (ack.responseJson as { cursor: string }).cursor;
      await waitFor(
        'the agent to commit the acknowledged batch',
        () => scn.kv('server_cursor') === cursor,
      );
    },

    issueCode(purpose: 'pair' | 'repair' = 'pair'): Promise<string> {
      return issuePairingCode(backend, developer.developerId, purpose);
    },

    /** The agent's JSON-lines logs, for failure messages. */
    agentLogs(): string {
      const dir = path.join(dirs.dataDir, 'logs');
      if (!existsSync(dir)) return '';
      return readdirSync(dir)
        .map((f) => readFileSync(path.join(dir, f), 'utf8'))
        .join('\n')
        .slice(-8_000);
    },

    async cleanup(): Promise<void> {
      await Promise.all(
        [...children].map(
          (child) =>
            new Promise<void>((resolve) => {
              if (child.exitCode !== null || child.signalCode !== null) return resolve();
              child.once('exit', () => resolve());
              child.kill('SIGKILL');
            }),
        ),
      );
      await proxy.close();
      if (process.env.E2E_KEEP !== '1') rmSync(root, { recursive: true, force: true });
    },
  };
  return scn;
}

/** Records of one request body (the five arrays of a `/sync` payload). */
export function payload(c: Capture): {
  sync: {
    batch_id: string;
    cursor: string | null;
    is_initial: boolean;
    settings_version: number;
    sequence: number;
  };
  accounts: unknown[];
  projects: { path: string }[];
  sessions: { source_session_id: string }[];
  usage: { source_message_id: string }[];
  messages: { source_message_id: string; content: string }[];
} {
  return c.requestJson as ReturnType<typeof payload>;
}
