/**
 * H23 token validation support: runs the agent's Claude scanner and the independent oracle
 * (`tools/token-audit/token-audit.mjs`, a black-box child process) over the same Claude data
 * dir, and reduces both to comparable per-total/session/day/model/session-day metrics.
 *
 * The agent never computes Actual/Total (invariant 1): the backend's TokenMath is the
 * authority. The sums and the two derived metrics below exist only in the test to compare
 * the agent's raw usage records with the oracle.
 */
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nodeFs } from '../../src/core/claude/fs.js';
import { createClaudeScanner } from '../../src/core/claude/scanner.js';
import {
  SYNC_LIMITS,
  type FileCheckpoint,
  type ScanChunk,
  type ScanOptions,
  type ScanSource,
  type TrackingSettings,
  type UsageRecord,
} from '../../src/core/contract/index.js';

export const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/claude');
export const ORACLE = path.resolve(
  import.meta.dirname,
  '../../../tools/token-audit/token-audit.mjs',
);
export const ORG_TZ = 'Asia/Dhaka';
export const DEVICE_UID = 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W';
export const DEMO_PROJECT = '-home-dev-projects-demo-app';
export const fixtureSid = (n: number) => `0b7c1a2e-4f3d-4a8b-9c1d-00000000000${n}`;

// ---------------------------------------------------------------------------
// Temp Claude data dir
// ---------------------------------------------------------------------------

export interface TempClaudeDir {
  root: string;
  projectsDir: string;
  /** Absolute path of `projects/<project>/<sessionId>.jsonl`. */
  mainFile(project: string, sessionId: string): string;
  /** Absolute path of `projects/<project>/<sessionId>/subagents/<name>.jsonl`. */
  subagentFile(project: string, sessionId: string, name: string): string;
  write(file: string, data: string | Uint8Array): Promise<void>;
  copyFixture(fixture: string, file: string): Promise<void>;
}

export async function makeTempClaudeDir(): Promise<TempClaudeDir> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'h23-claude-'));
  const projectsDir = path.join(root, 'projects');
  await mkdir(projectsDir, { recursive: true });
  return {
    root,
    projectsDir,
    mainFile: (project, sessionId) => path.join(projectsDir, project, `${sessionId}.jsonl`),
    subagentFile: (project, sessionId, name) =>
      path.join(projectsDir, project, sessionId, 'subagents', `${name}.jsonl`),
    async write(file, data) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    },
    async copyFixture(fixture, file) {
      await mkdir(path.dirname(file), { recursive: true });
      await copyFile(path.join(FIXTURES, fixture), file);
    },
  };
}

// ---------------------------------------------------------------------------
// Agent side
// ---------------------------------------------------------------------------

/** Every category ON except Prompt (and Git, which only adds a remote lookup). */
export function validationSettings(): TrackingSettings {
  return {
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
      network: true,
    },
    initial_sync: { range: 'all', since: null },
    sync_interval_seconds: 120,
    heartbeat_interval_seconds: 300,
    min_agent_version: '1.0.0',
  };
}

export function validationOptions(over: Partial<ScanOptions> = {}): ScanOptions {
  return {
    settings: validationSettings(),
    since: null,
    maxUsagePerChunk: SYNC_LIMITS.usage,
    maxSessionsPerChunk: SYNC_LIMITS.sessions,
    maxMessagesPerChunk: SYNC_LIMITS.messages,
    maxBytesPerChunk: SYNC_LIMITS.maxBodyBytes - 64 * 1024,
    ...over,
  };
}

/** The real agent scanner over `root`, on the real filesystem, with no git remote lookups. */
export function agentScanner(root: string): ScanSource {
  return createClaudeScanner({
    source: { dataDir: root, projectsDir: path.join(root, 'projects'), globalConfigPath: null },
    deviceUid: () => DEVICE_UID,
    fs: nodeFs,
    readGitRemote: async () => null,
  });
}

export async function scanAll(
  scanner: ScanSource,
  checkpoints: ReadonlyMap<string, FileCheckpoint> = new Map(),
  opts: ScanOptions = validationOptions(),
): Promise<ScanChunk[]> {
  const chunks: ScanChunk[] = [];
  for await (const chunk of scanner.scan(checkpoints, opts)) chunks.push(chunk);
  return chunks;
}

/** Checkpoints after every chunk was acked (as the sync engine commits them). */
export function committed(
  chunks: ScanChunk[],
  base: ReadonlyMap<string, FileCheckpoint> = new Map(),
): Map<string, FileCheckpoint> {
  const next = new Map(base);
  for (const chunk of chunks) for (const cp of chunk.checkpoints) next.set(cp.path, cp);
  return next;
}

export const usageOf = (chunks: ScanChunk[]): UsageRecord[] =>
  chunks.flatMap((c) => c.records.usage);

/**
 * The backend's usage merge (H06 UpsertUsage): one row per (session, source_message_id),
 * raw token columns by GREATEST, recorded_at kept at the earliest value.
 */
export function serverMerge(records: UsageRecord[]): UsageRecord[] {
  const rows = new Map<string, UsageRecord>();
  for (const r of records) {
    const key = `${r.source_session_id}\n${r.source_message_id}`;
    const row = rows.get(key);
    if (row === undefined) {
      rows.set(key, { ...r });
      continue;
    }
    row.input_tokens = Math.max(row.input_tokens, r.input_tokens);
    row.output_tokens = Math.max(row.output_tokens, r.output_tokens);
    row.cache_creation_tokens = Math.max(row.cache_creation_tokens, r.cache_creation_tokens);
    row.cache_read_tokens = Math.max(row.cache_read_tokens, r.cache_read_tokens);
    if (r.recorded_at < row.recorded_at) row.recorded_at = r.recorded_at;
    row.model ??= r.model;
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface Metrics {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  actual_consumed_tokens: number;
  total_token_activity: number;
  message_count: number;
}

export interface Breakdown {
  totals: Metrics;
  sessions: Record<string, Metrics>;
  days: Record<string, Metrics>;
  models: Record<string, Metrics>;
  sessionDays: Record<string, Metrics>;
}

const RAW = [
  'input_tokens',
  'output_tokens',
  'cache_creation_tokens',
  'cache_read_tokens',
] as const;

function sum(records: UsageRecord[]): Metrics {
  const m = { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 };
  for (const r of records) for (const k of RAW) m[k] += r[k];
  // Test-side only, mirroring PRD §20; the backend (App\Support\TokenMath) is the authority.
  const actual = m.input_tokens + m.output_tokens + m.cache_creation_tokens;
  return {
    ...m,
    actual_consumed_tokens: actual,
    total_token_activity: actual + m.cache_read_tokens,
    message_count: records.length,
  };
}

export function dayFormatter(tz: string = ORG_TZ): (iso: string) => string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (iso) => fmt.format(new Date(iso));
}

function groupBy(records: UsageRecord[], key: (r: UsageRecord) => string) {
  const groups = new Map<string, UsageRecord[]>();
  for (const r of records) {
    const k = key(r);
    const g = groups.get(k);
    if (g === undefined) groups.set(k, [r]);
    else g.push(r);
  }
  return Object.fromEntries([...groups].map(([k, g]) => [k, sum(g)]));
}

export const sessionDayKey = (sessionId: string | null, date: string | null) =>
  `${sessionId}|${date}`;

/** Agent usage records (already merged per message) reduced to the oracle's breakdowns. */
export function agentBreakdown(records: UsageRecord[], tz: string = ORG_TZ): Breakdown {
  const day = dayFormatter(tz);
  return {
    totals: sum(records),
    sessions: groupBy(records, (r) => r.source_session_id),
    days: groupBy(records, (r) => day(r.recorded_at)),
    models: groupBy(records, (r) => String(r.model)),
    sessionDays: groupBy(records, (r) => sessionDayKey(r.source_session_id, day(r.recorded_at))),
  };
}

// ---------------------------------------------------------------------------
// Oracle side (black box)
// ---------------------------------------------------------------------------

type Row = Metrics & Record<string, unknown>;

export interface OracleReport {
  diagnostics: Record<string, number>;
  totals: Metrics;
  sessions: (Row & { session_id: string | null })[];
  days: (Row & { date: string | null })[];
  models: (Row & { model: string | null })[];
  sessionDays: (Row & { session_id: string | null; date: string | null })[];
}

export interface OracleArgs {
  sessions?: string[];
  since?: string;
  tz?: string;
}

export function runOracle(dir: string, args: OracleArgs = {}): OracleReport {
  const argv = [ORACLE, '--dir', dir, '--json', '--tz', args.tz ?? ORG_TZ];
  for (const s of args.sessions ?? []) argv.push('--session', s);
  if (args.since !== undefined) argv.push('--since', args.since);
  const out = execFileSync(process.execPath, argv, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  return JSON.parse(out) as OracleReport;
}

function metricsOf(row: Row): Metrics {
  return {
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    cache_creation_tokens: row.cache_creation_tokens,
    cache_read_tokens: row.cache_read_tokens,
    actual_consumed_tokens: row.actual_consumed_tokens,
    total_token_activity: row.total_token_activity,
    message_count: row.message_count,
  };
}

const keyed = <T extends Row>(rows: T[], key: (r: T) => string) =>
  Object.fromEntries(rows.filter((r) => r.message_count > 0).map((r) => [key(r), metricsOf(r)]));

/** The oracle report in the same shape as `agentBreakdown` (sessions without usage dropped). */
export function oracleBreakdown(report: OracleReport): Breakdown {
  return {
    totals: metricsOf(report.totals as Row),
    sessions: keyed(report.sessions, (r) => String(r.session_id)),
    days: keyed(report.days, (r) => String(r.date)),
    models: keyed(report.models, (r) => String(r.model)),
    sessionDays: keyed(report.sessionDays, (r) => sessionDayKey(r.session_id, r.date)),
  };
}

/** `expected/*.json` tokenSums in the Metrics field names (no message count there). */
export function tokenSumsOf(exp: Record<string, unknown>) {
  const t = exp.tokenSums as Record<string, number>;
  return {
    input_tokens: t.input,
    output_tokens: t.output,
    cache_creation_tokens: t.cache_creation,
    cache_read_tokens: t.cache_read,
    actual_consumed_tokens: t.actual,
    total_token_activity: t.total,
  };
}

export function withoutCount(m: Metrics): Omit<Metrics, 'message_count'> {
  const rest: Partial<Metrics> = { ...m };
  delete rest.message_count;
  return rest as Omit<Metrics, 'message_count'>;
}
