import { appendFile, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import {
  AccountRecordSchema,
  MessageRecordSchema,
  ProjectRecordSchema,
  SessionRecordSchema,
  SYNC_LIMITS,
  UsageRecordSchema,
  type FileCheckpoint,
  type ScanChunk,
  type ScanOptions,
  type ScanRecords,
  type ScanSource,
  type TrackingSettings,
} from '../../../src/core/contract/index.js';
import type { ClaudeDataSource } from '../../../src/core/claude/discovery.js';
import { nodeFs, type FsLike } from '../../../src/core/claude/fs.js';

export const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures/claude');
export const PROJECT_DIR = '-home-dev-projects-demo-app';
export const DEVICE_UID = 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W';
export const sid = (n: number) => `0b7c1a2e-4f3d-4a8b-9c1d-00000000000${n}`;

export type Categories = TrackingSettings['categories'];

export const ALL_ON: Categories = {
  session: true,
  usage: true,
  project: true,
  model: true,
  device: true,
  account: true,
  prompt: true,
  git: true,
  network: true,
};

export function settings(categories: Partial<Categories> = {}): TrackingSettings {
  return {
    version: 1,
    categories: { ...ALL_ON, ...categories },
    initial_sync: { range: 'all', since: null },
    sync_interval_seconds: 120,
    heartbeat_interval_seconds: 300,
    min_agent_version: '1.0.0',
  };
}

export function scanOptions(over: Partial<ScanOptions> = {}): ScanOptions {
  return {
    settings: settings(),
    since: null,
    maxUsagePerChunk: SYNC_LIMITS.usage,
    maxSessionsPerChunk: SYNC_LIMITS.sessions,
    maxMessagesPerChunk: SYNC_LIMITS.messages,
    maxBytesPerChunk: SYNC_LIMITS.maxBodyBytes - 64 * 1024,
    ...over,
  };
}

export interface ClaudeDir {
  root: string;
  source: ClaudeDataSource;
  projectDir: string;
}

/** A temp Claude data dir; `.claude.json` is a copy of the given fixture (or absent). */
export async function makeClaudeDir(
  globalConfig: string | null = 'claude.json',
): Promise<ClaudeDir> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'h09-claude-'));
  const projectDir = path.join(root, 'projects', PROJECT_DIR);
  await mkdir(projectDir, { recursive: true });
  let globalConfigPath: string | null = null;
  if (globalConfig !== null) {
    globalConfigPath = path.join(root, '.claude.json');
    await copyFile(path.join(FIXTURES, globalConfig), globalConfigPath);
  }
  return {
    root,
    projectDir,
    source: { dataDir: root, projectsDir: path.join(root, 'projects'), globalConfigPath },
  };
}

/** Copies a fixture transcript into the project dir as `<sessionId>.jsonl`; returns its path. */
export async function addTranscript(dir: ClaudeDir, fixture: string, sessionId: string) {
  const target = path.join(dir.projectDir, `${sessionId}.jsonl`);
  await copyFile(path.join(FIXTURES, fixture), target);
  return target;
}

/** The subagent fixture: main file + `<sid>/subagents/agent-a1fixture.jsonl`. */
export async function addSubagentFixture(dir: ClaudeDir) {
  const id = sid(2);
  const main = await addTranscript(dir, `subagent/${id}.jsonl`, id);
  const subDir = path.join(dir.projectDir, id, 'subagents');
  await mkdir(subDir, { recursive: true });
  const sub = path.join(subDir, 'agent-a1fixture.jsonl');
  await copyFile(path.join(FIXTURES, `subagent/${id}/subagents/agent-a1fixture.jsonl`), sub);
  await copyFile(
    path.join(FIXTURES, `subagent/${id}/subagents/agent-a1fixture.meta.json`),
    path.join(subDir, 'agent-a1fixture.meta.json'),
  );
  return { main, sub };
}

export async function fixtureText(name: string): Promise<string> {
  return readFile(path.join(FIXTURES, name), 'utf8');
}

export async function writeText(file: string, text: string) {
  await writeFile(file, text);
}

export async function appendText(file: string, text: string) {
  await appendFile(file, text);
}

export async function expected(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(FIXTURES, 'expected', name), 'utf8'));
}

export async function collect(
  scanner: ScanSource,
  checkpoints: ReadonlyMap<string, FileCheckpoint> = new Map(),
  opts: ScanOptions = scanOptions(),
): Promise<ScanChunk[]> {
  const chunks: ScanChunk[] = [];
  for await (const chunk of scanner.scan(checkpoints, opts)) chunks.push(chunk);
  return chunks;
}

/** Applies every chunk's checkpoints in order, as the sync engine does after each ack. */
export function commit(
  base: ReadonlyMap<string, FileCheckpoint>,
  chunks: ScanChunk[],
): Map<string, FileCheckpoint> {
  const next = new Map(base);
  for (const chunk of chunks) for (const cp of chunk.checkpoints) next.set(cp.path, cp);
  return next;
}

/** Validates each chunk against the H03 zod record schemas and the referential rule. */
export function assertValidChunk(chunk: ScanChunk) {
  const r = chunk.records;
  AccountRecordSchema.array().max(SYNC_LIMITS.accounts).parse(r.accounts);
  ProjectRecordSchema.array().max(SYNC_LIMITS.projects).parse(r.projects);
  SessionRecordSchema.array().max(SYNC_LIMITS.sessions).parse(r.sessions);
  UsageRecordSchema.array().max(SYNC_LIMITS.usage).parse(r.usage);
  MessageRecordSchema.array().max(SYNC_LIMITS.messages).parse(r.messages);
  const sessions = new Set(r.sessions.map((s) => s.source_session_id));
  const projects = new Set(r.projects.map((p) => p.project_key));
  const accounts = new Set(r.accounts.map((a) => a.account_key));
  for (const u of r.usage) if (!sessions.has(u.source_session_id)) throw new Error('usage ref');
  for (const m of r.messages) if (!sessions.has(m.source_session_id)) throw new Error('msg ref');
  for (const s of r.sessions) {
    if (s.project_key !== null && !projects.has(s.project_key)) throw new Error('project ref');
    if (s.account_key !== null && !accounts.has(s.account_key)) throw new Error('account ref');
  }
}

export function merged(chunks: ScanChunk[]): ScanRecords {
  const out: ScanRecords = { accounts: [], projects: [], sessions: [], usage: [], messages: [] };
  for (const c of chunks) {
    for (const k of Object.keys(out) as (keyof ScanRecords)[]) {
      (out[k] as unknown[]).push(...c.records[k]);
    }
  }
  return out;
}

const byTime = <T extends { recorded_at: string; source_message_id: string }>(a: T, b: T) =>
  a.recorded_at.localeCompare(b.recorded_at) ||
  a.source_message_id.localeCompare(b.source_message_id);

/** Converts one scan's records to the shape of `test/fixtures/claude/expected/*.json`. */
export function normalized(chunks: ScanChunk[]) {
  const r = merged(chunks);
  const pathByKey = new Map(r.projects.map((p) => [p.project_key, p.path]));
  return {
    projects: r.projects
      .map((p) => ({ path: p.path, first_seen_at: p.first_seen_at, last_seen_at: p.last_seen_at }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    sessions: r.sessions.map((s) => ({
      source_session_id: s.source_session_id,
      first_seen_at: s.first_seen_at,
      last_seen_at: s.last_seen_at,
      ended_at: s.ended_at,
      claude_code_version: s.claude_code_version,
      entrypoint: s.entrypoint,
      git_branch: s.git_branch,
      model: s.model,
      project_path: s.project_key === null ? null : (pathByKey.get(s.project_key) ?? 'MISSING'),
    })),
    usage: [...r.usage].sort(byTime),
    messages: [...r.messages].sort(byTime),
  };
}

export function pick(exp: Record<string, unknown>) {
  return {
    projects: exp.projects,
    sessions: exp.sessions,
    usage: exp.usage,
    messages: exp.messages,
  };
}

/** An FsLike that records every call; `open` counts files actually opened. */
export function spyFs(base: FsLike = nodeFs) {
  return {
    readdir: vi.fn(base.readdir),
    stat: vi.fn(base.stat),
    open: vi.fn(base.open),
    readFile: vi.fn(base.readFile),
  } satisfies FsLike;
}
