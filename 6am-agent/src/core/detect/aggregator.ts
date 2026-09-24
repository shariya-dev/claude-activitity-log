/**
 * Normalizes parsed transcript lines into contract records (claude-data-contract §5–7) and
 * cuts them into chunks that respect the sync limits.
 *
 * Session and project state is cumulative over the whole scan, so a session that reappears
 * in a later chunk is re-sent with everything seen so far (the backend merges LEAST/GREATEST
 * and latest non-null). Usage and messages are per chunk: usage is deduplicated by message
 * key with a per-field max, the only arithmetic the agent does on tokens.
 */
import type {
  AccountRecord,
  FileCheckpoint,
  MessageRecord,
  ProjectRecord,
  ScanChunk,
  SessionRecord,
  UsageRecord,
} from '../contract/index.js';
import type { ParsedLine } from '../claude/lineParser.js';

export interface ProjectIdentity {
  projectKey: string;
  name: string;
  gitRemote: string | null;
}

export interface ChunkLimits {
  usage: number;
  sessions: number;
  messages: number;
  projects: number;
  bytes: number;
}

export interface AggregatorOptions {
  usage: boolean;
  account: AccountRecord | null;
  limits: ChunkLimits;
}

/** A line that is in range (has sessionId + timestamp, not before `since`). */
export type RecordLine = ParsedLine & { sessionId: string; timestampMs: number };

interface Stamped {
  value: string;
  ms: number;
}

interface SessionState {
  id: string;
  firstMs: number;
  lastMs: number;
  version: Stamped | null;
  entrypoint: Stamped | null;
  gitBranch: Stamped | null;
  mainModel: Stamped | null;
  sideModel: Stamped | null;
}

interface Launch {
  cwd: string;
  /** null when the Project category is OFF. */
  identity: ProjectIdentity | null;
}

interface ProjectState {
  cwd: string;
  identity: ProjectIdentity;
  firstMs: number;
  lastMs: number;
}

/** Upper bound for one serialized session record (every string at its max length, escaped). */
const SESSION_BYTES = 4096;
/** Room for token counts that grow while duplicates are merged. */
const USAGE_SLACK_BYTES = 64;
const PROJECT_SLACK_BYTES = 16;

const iso = (ms: number) => new Date(ms).toISOString();
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value)) + 1;

function latest(current: Stamped | null, value: string | null, ms: number): Stamped | null {
  if (value === null) return current;
  return current === null || ms >= current.ms ? { value, ms } : current;
}

export class ScanAggregator {
  private readonly sessions = new Map<string, SessionState>();
  private readonly launch = new Map<string, Launch>();
  private readonly projects = new Map<string, ProjectState>();

  private chunkSessions = new Set<string>();
  private chunkCwds = new Set<string>();
  private chunkUsage = new Map<string, UsageRecord>();
  private chunkMessages: MessageRecord[] = [];
  private chunkBytes = 0;
  private checkpoints = new Map<string, FileCheckpoint>();
  private filesRead = new Set<string>();
  private linesRead = 0;
  private linesSkipped = 0;

  constructor(private readonly opts: AggregatorOptions) {}

  /**
   * The first line with a cwd in a main file read from offset 0 (even before `since`). Only
   * the cwd is kept: a pre-`since` line's timestamp is never sent.
   */
  observeLaunch(sessionId: string, cwd: string, identity: ProjectIdentity | null): void {
    if (!this.launch.has(sessionId)) this.launch.set(sessionId, { cwd, identity });
  }

  /** Projects `line` would add to the chunk: its own cwd and its session's launch cwd. */
  private newProjects(
    line: RecordLine,
    identity: ProjectIdentity | null,
  ): [string, ProjectIdentity][] {
    const out: [string, ProjectIdentity][] = [];
    if (identity !== null && line.cwd !== null && !this.chunkCwds.has(line.cwd)) {
      out.push([line.cwd, identity]);
    }
    const launch = this.launch.get(line.sessionId);
    if (
      launch !== undefined &&
      launch.identity !== null &&
      launch.cwd !== line.cwd &&
      !this.chunkCwds.has(launch.cwd)
    ) {
      out.push([launch.cwd, launch.identity]);
    }
    return out;
  }

  private projectBytes(cwd: string, identity: ProjectIdentity, ms: number): number {
    const known = this.projects.get(cwd);
    const record =
      known === undefined ? this.projectRecord(cwd, identity, ms, ms) : this.toProjectRecord(known);
    return jsonBytes(record) + PROJECT_SLACK_BYTES;
  }

  /** Whether adding `line` keeps the current chunk within every limit. */
  fits(line: RecordLine, identity: ProjectIdentity | null): boolean {
    const { limits } = this.opts;
    let bytes = this.chunkBytes;
    let sessions = this.chunkSessions.size;
    let projects = this.chunkCwds.size;
    if (!this.chunkSessions.has(line.sessionId)) {
      sessions += 1;
      bytes += SESSION_BYTES;
      if (sessions === 1 && this.opts.account !== null) bytes += jsonBytes(this.opts.account);
    }
    for (const [cwd, id] of this.newProjects(line, identity)) {
      projects += 1;
      bytes += this.projectBytes(cwd, id, line.timestampMs);
    }
    const usage = this.usageRecordFor(line);
    let usageCount = this.chunkUsage.size;
    if (usage !== null && !this.chunkUsage.has(this.usageKey(line.sessionId, usage))) {
      usageCount += 1;
      bytes += jsonBytes(usage) + USAGE_SLACK_BYTES;
    }
    const message = this.messageRecordFor(line);
    let messages = this.chunkMessages.length;
    if (message !== null) {
      messages += 1;
      bytes += jsonBytes(message);
    }
    return (
      sessions <= limits.sessions &&
      projects <= limits.projects &&
      usageCount <= limits.usage &&
      messages <= limits.messages &&
      bytes <= limits.bytes
    );
  }

  add(line: RecordLine, identity: ProjectIdentity | null): void {
    const ms = line.timestampMs;
    const added = this.newProjects(line, identity);
    const session = this.touchSession(line);
    if (!this.chunkSessions.has(session.id)) {
      this.chunkSessions.add(session.id);
      this.chunkBytes += SESSION_BYTES;
      if (this.chunkSessions.size === 1 && this.opts.account !== null) {
        this.chunkBytes += jsonBytes(this.opts.account);
      }
    }
    for (const [cwd, id] of added) {
      this.chunkBytes += this.projectBytes(cwd, id, ms);
      this.chunkCwds.add(cwd);
      // A launch project first seen through another cwd's line starts at this in-range time.
      if (!this.projects.has(cwd)) this.touchProject(cwd, id, ms);
    }
    if (identity !== null && line.cwd !== null) this.touchProject(line.cwd, identity, ms);
    const usage = this.usageRecordFor(line);
    if (usage !== null) {
      const key = this.usageKey(line.sessionId, usage);
      const existing = this.chunkUsage.get(key);
      if (existing === undefined) {
        this.chunkUsage.set(key, usage);
        this.chunkBytes += jsonBytes(usage) + USAGE_SLACK_BYTES;
      } else {
        // Split lines of one API message repeat (or grow) the usage: per-field max, never a sum.
        existing.input_tokens = Math.max(existing.input_tokens, usage.input_tokens);
        existing.output_tokens = Math.max(existing.output_tokens, usage.output_tokens);
        existing.cache_creation_tokens = Math.max(
          existing.cache_creation_tokens,
          usage.cache_creation_tokens,
        );
        existing.cache_read_tokens = Math.max(existing.cache_read_tokens, usage.cache_read_tokens);
      }
    }
    const message = this.messageRecordFor(line);
    if (message !== null) {
      this.chunkMessages.push(message);
      this.chunkBytes += jsonBytes(message);
    }
  }

  countLine(file: string, skipped: boolean): void {
    this.filesRead.add(file);
    this.linesRead += 1;
    if (skipped) this.linesSkipped += 1;
  }

  setCheckpoint(checkpoint: FileCheckpoint): void {
    this.checkpoints.set(checkpoint.path, checkpoint);
  }

  hasRecords(): boolean {
    return this.chunkSessions.size > 0;
  }

  isEmpty(): boolean {
    return this.chunkSessions.size === 0 && this.checkpoints.size === 0 && this.linesRead === 0;
  }

  takeChunk(): ScanChunk {
    const sessions = [...this.chunkSessions].map((id) => this.toSessionRecord(id));
    const chunk: ScanChunk = {
      records: {
        accounts: sessions.length > 0 && this.opts.account !== null ? [this.opts.account] : [],
        projects: [...this.chunkCwds].map((cwd) => this.toProjectRecord(this.projects.get(cwd)!)),
        sessions,
        usage: [...this.chunkUsage.values()],
        messages: this.chunkMessages,
      },
      checkpoints: [...this.checkpoints.values()],
      stats: {
        filesRead: this.filesRead.size,
        linesRead: this.linesRead,
        linesSkipped: this.linesSkipped,
      },
    };
    this.chunkSessions = new Set();
    this.chunkCwds = new Set();
    this.chunkUsage = new Map();
    this.chunkMessages = [];
    this.chunkBytes = 0;
    this.checkpoints = new Map();
    this.filesRead = new Set();
    this.linesRead = 0;
    this.linesSkipped = 0;
    return chunk;
  }

  private touchSession(line: RecordLine): SessionState {
    const ms = line.timestampMs;
    let s = this.sessions.get(line.sessionId);
    if (s === undefined) {
      s = {
        id: line.sessionId,
        firstMs: ms,
        lastMs: ms,
        version: null,
        entrypoint: null,
        gitBranch: null,
        mainModel: null,
        sideModel: null,
      };
      this.sessions.set(s.id, s);
    }
    s.firstMs = Math.min(s.firstMs, ms);
    s.lastMs = Math.max(s.lastMs, ms);
    s.version = latest(s.version, line.version, ms);
    s.entrypoint = latest(s.entrypoint, line.entrypoint, ms);
    s.gitBranch = latest(s.gitBranch, line.gitBranch, ms);
    if (line.usage !== null && !line.usage.synthetic) {
      if (line.isSidechain) s.sideModel = latest(s.sideModel, line.model, ms);
      else s.mainModel = latest(s.mainModel, line.model, ms);
    }
    return s;
  }

  private touchProject(cwd: string, identity: ProjectIdentity, ms: number): ProjectState {
    let p = this.projects.get(cwd);
    if (p === undefined) {
      p = { cwd, identity, firstMs: ms, lastMs: ms };
      this.projects.set(cwd, p);
    }
    p.firstMs = Math.min(p.firstMs, ms);
    p.lastMs = Math.max(p.lastMs, ms);
    return p;
  }

  private usageKey(sessionId: string, usage: UsageRecord): string {
    return `${sessionId}\n${usage.source_message_id}`;
  }

  private usageRecordFor(line: RecordLine): UsageRecord | null {
    const u = line.usage;
    if (!this.opts.usage || u === null || u.synthetic) return null;
    return {
      source_message_id: u.key,
      source_session_id: line.sessionId,
      request_id: u.requestId,
      model: line.model,
      is_sidechain: line.isSidechain,
      recorded_at: iso(line.timestampMs),
      input_tokens: u.input,
      output_tokens: u.output,
      cache_creation_tokens: u.cacheCreation,
      cache_read_tokens: u.cacheRead,
    };
  }

  private messageRecordFor(line: RecordLine): MessageRecord | null {
    if (line.prompt === null || line.uuid === null) return null;
    return {
      source_message_id: line.uuid,
      source_session_id: line.sessionId,
      role: 'user',
      content: line.prompt,
      recorded_at: iso(line.timestampMs),
    };
  }

  private projectRecord(
    cwd: string,
    identity: ProjectIdentity,
    firstMs: number,
    lastMs: number,
  ): ProjectRecord {
    return {
      project_key: identity.projectKey,
      name: identity.name,
      path: cwd,
      git_remote: identity.gitRemote,
      first_seen_at: iso(firstMs),
      last_seen_at: iso(lastMs),
    };
  }

  private toProjectRecord(p: ProjectState): ProjectRecord {
    return this.projectRecord(p.cwd, p.identity, p.firstMs, p.lastMs);
  }

  private toSessionRecord(id: string): SessionRecord {
    const s = this.sessions.get(id)!;
    const launch = this.launch.get(id);
    // Only when the launch project travels in this chunk (referential rule, sync-api-v1 §4.6).
    const projectKey =
      launch?.identity != null && this.chunkCwds.has(launch.cwd)
        ? launch.identity.projectKey
        : null;
    return {
      source_session_id: s.id,
      project_key: projectKey,
      account_key: this.opts.account?.account_key ?? null,
      first_seen_at: iso(s.firstMs),
      last_seen_at: iso(s.lastMs),
      ended_at: null,
      claude_code_version: s.version?.value ?? null,
      entrypoint: s.entrypoint?.value ?? null,
      git_branch: s.gitBranch?.value ?? null,
      model: (s.mainModel ?? s.sideModel)?.value ?? null,
    };
  }
}
