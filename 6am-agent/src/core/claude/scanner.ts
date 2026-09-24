/**
 * ScanSource over Claude Code's transcripts (claude-data-contract §3–11): incremental tail
 * reads from byte checkpoints, tolerant parsing, category gating before any value reaches a
 * record, and chunks whose checkpoints cover exactly the lines they include.
 *
 * Checkpoint convention: `size`/`mtimeMs` equal the file's stat only once the file has been
 * read to its end. A checkpoint cut mid-file stores `size = offset`, so the stat-only fast
 * path never mistakes it for a finished file.
 */
import { SYNC_LIMITS } from '../contract/index.js';
import type {
  AccountRecord,
  FileCheckpoint,
  ScanChunk,
  ScanOptions,
  ScanSource,
} from '../contract/index.js';
import { ScanAggregator, type ProjectIdentity, type RecordLine } from '../detect/aggregator.js';
import {
  lastSegment,
  normalizeGitRemote,
  projectKeyFromCwd,
  projectKeyFromRemote,
} from '../detect/keys.js';
import { readAccount } from './accountReader.js';
import type { ClaudeDataSource } from './discovery.js';
import { fileIdentity, nodeFs, type FsLike, type StatLike } from './fs.js';
import { readOriginRemote } from './gitRemote.js';
import {
  BLOCK_SIZE,
  readLineBatches,
  type JsonPathSegment,
  type StringElision,
} from './jsonlTailReader.js';
import { parseLine, type LineGates, type ParsedLine } from './lineParser.js';
import { truncateUnits, wellFormed } from './text.js';
import { listTranscriptFiles, type TranscriptFile } from './transcriptFiles.js';

export interface ClaudeScannerDeps {
  source: ClaudeDataSource;
  deviceUid: () => string;
  fs?: FsLike;
  readGitRemote?: (cwd: string) => Promise<string | null>;
}

const NAME_MAX = 191;
const REMOTE_MAX = 255;
const NO_GATES: LineGates = { model: false, git: false, prompt: false };
/**
 * Strings at other paths longer than this are elided while reading. Every path `parseLine`
 * reads is kept at any length, so this only bounds what an unlisted path can carry. Keys longer
 * than this are elided too, so it must stay well above the longest key read (`entrypoint`).
 */
const UNREAD_STRING_UNITS = 256;
/** Top-level string fields `parseLine` reads (lineParser.ts). */
const PARSED_FIELDS: ReadonlySet<JsonPathSegment> = new Set([
  'type',
  'sessionId',
  'uuid',
  'timestamp',
  'cwd',
  'version',
  'entrypoint',
  'gitBranch',
  'requestId',
]);

/** Paths of every string `parseLine` reads: the fields above, `message.model`, `message.id`. */
function isParsedPath(path: readonly JsonPathSegment[]): boolean {
  if (path.length === 1) return PARSED_FIELDS.has(path[0]!);
  return path.length === 2 && path[0] === 'message' && (path[1] === 'model' || path[1] === 'id');
}

/** What `extractPrompt` reads: `message.content`, its parts' `type`/`text`, `origin.kind`. */
function isPromptPath(path: readonly JsonPathSegment[]): boolean {
  if (path[0] === 'origin') return path.length === 2 && path[1] === 'kind';
  if (path[0] !== 'message' || path[1] !== 'content') return false;
  return (
    path.length === 2 ||
    (path.length === 4 && typeof path[2] === 'number' && (path[3] === 'text' || path[3] === 'type'))
  );
}

const isPromptOrParsedPath = (path: readonly JsonPathSegment[]) =>
  isParsedPath(path) || isPromptPath(path);

/**
 * How transcripts are read (H31): string values no parsed field uses (tool results, file
 * contents, thinking text, tool inputs) are elided in the reader, so they never become strings
 * or parsed JSON. `parseLine` returns exactly what it returns for the full line.
 */
export function transcriptElision(gates: LineGates): StringElision {
  return {
    maxUnits: UNREAD_STRING_UNITS,
    keep: gates.prompt ? isPromptOrParsedPath : isParsedPath,
  };
}

/** Newest line seen across scans: feeds `claudeCodeVersion()` and `lastLocalActivityAt()`. */
class ActivityTracker {
  lastMs: number | null = null;
  private versionMs = -Infinity;
  version: string | null = null;

  observe(line: ParsedLine): void {
    const ms = line.timestampMs;
    if (ms === null) return;
    if (this.lastMs === null || ms > this.lastMs) this.lastMs = ms;
    if (line.version !== null && ms >= this.versionMs) {
      this.versionMs = ms;
      this.version = line.version;
    }
  }
}

export function createClaudeScanner(deps: ClaudeScannerDeps): ScanSource {
  const { source, deviceUid } = deps;
  const fs = deps.fs ?? nodeFs;
  const readGitRemote = deps.readGitRemote ?? ((cwd: string) => readOriginRemote(cwd, fs));
  const tracker = new ActivityTracker();
  let peeked = false;

  async function statOrNull(file: string): Promise<StatLike | null> {
    try {
      const stat = await fs.stat(file);
      return stat.isFile() ? stat : null;
    } catch {
      return null;
    }
  }

  async function* scan(
    checkpoints: ReadonlyMap<string, FileCheckpoint>,
    opts: ScanOptions,
  ): AsyncGenerator<ScanChunk> {
    const categories = opts.settings.categories;
    // Session OFF: the agent sends no /sync at all (sync-api-v1 §5), so nothing is read.
    if (!categories.session) return;
    const gates: LineGates = {
      model: categories.model,
      git: categories.git,
      prompt: categories.prompt,
    };
    const elision = transcriptElision(gates);
    const since = opts.since === null ? null : opts.since.getTime();
    // Read once per scan. `observed_at` is only a same-length stand-in for the chunk byte
    // budget: `stampAccount` sets the real value from each chunk's own data.
    const account: AccountRecord | null =
      categories.account && source.globalConfigPath !== null
        ? await readAccount(source.globalConfigPath, new Date(0), fs)
        : null;

    const identities = new Map<string, ProjectIdentity>();
    /** Synchronous when known (undefined: not resolved yet), so most lines await nothing. */
    function knownIdentity(cwd: string | null): ProjectIdentity | null | undefined {
      if (!categories.project || cwd === null) return null;
      return identities.get(cwd);
    }
    async function identityFor(cwd: string | null): Promise<ProjectIdentity | null> {
      if (!categories.project || cwd === null) return null;
      const cached = identities.get(cwd);
      if (cached !== undefined) return cached;
      let remote: string | null = null;
      if (categories.git) {
        const raw = await readGitRemote(cwd).catch(() => null);
        remote = raw === null ? null : normalizeGitRemote(wellFormed(raw));
        if (remote !== null && remote.length > REMOTE_MAX) remote = null;
      }
      const identity: ProjectIdentity =
        remote !== null
          ? {
              projectKey: projectKeyFromRemote(remote),
              name: truncateUnits(lastSegment(remote), NAME_MAX),
              gitRemote: remote,
            }
          : {
              projectKey: projectKeyFromCwd(deviceUid(), cwd),
              name: truncateUnits(lastSegment(cwd), NAME_MAX),
              gitRemote: null,
            };
      identities.set(cwd, identity);
      return identity;
    }

    const agg = new ScanAggregator({
      usage: categories.usage,
      account,
      limits: {
        usage: Math.min(opts.maxUsagePerChunk, SYNC_LIMITS.usage),
        sessions: Math.min(opts.maxSessionsPerChunk, SYNC_LIMITS.sessions),
        messages: Math.min(opts.maxMessagesPerChunk, SYNC_LIMITS.messages),
        projects: SYNC_LIMITS.projects,
        bytes: Math.min(opts.maxBytesPerChunk, SYNC_LIMITS.maxBodyBytes),
      },
    });

    for (const file of await listTranscriptFiles(source.projectsDir, fs)) {
      const stat = await statOrNull(file.path);
      if (stat === null) continue;
      const identity = fileIdentity(stat);
      const cp = checkpoints.get(file.path);
      if (
        cp !== undefined &&
        cp.fileIdentity === identity &&
        cp.size === stat.size &&
        cp.mtimeMs === stat.mtimeMs
      ) {
        continue; // stat-only fast path: zero bytes read
      }
      const final = (offset: number): FileCheckpoint => ({
        path: file.path,
        fileIdentity: identity,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        offset,
      });
      if (cp === undefined && since !== null && stat.mtimeMs < since) {
        agg.setCheckpoint(final(stat.size));
        continue;
      }
      const start =
        cp !== undefined && cp.fileIdentity === identity && cp.offset <= stat.size ? cp.offset : 0;
      yield* readFile(file, start, stat, final);
    }
    if (!agg.isEmpty()) yield stampAccount(agg.takeChunk());

    async function* readFile(
      file: TranscriptFile,
      start: number,
      stat: StatLike,
      final: (offset: number) => FileCheckpoint,
    ): AsyncGenerator<ScanChunk> {
      const partial = (offset: number): FileCheckpoint => ({ ...final(offset), size: offset });
      let launchPending = file.kind === 'main' && start === 0;
      let consumed = start;
      try {
        const batches = readLineBatches(fs, file.path, start, stat.size, BLOCK_SIZE, elision);
        for await (const batch of batches) {
          for (const raw of batch) {
            const line = parseLine(raw.text, gates);
            if (line !== null) {
              tracker.observe(line);
              if (launchPending && line.cwd !== null && line.sessionId !== null) {
                launchPending = false;
                let launch = knownIdentity(line.cwd);
                if (launch === undefined) launch = await identityFor(line.cwd);
                agg.observeLaunch(line.sessionId, line.cwd, launch);
              }
              if (isRecordLine(line, since)) {
                let project = knownIdentity(line.cwd);
                if (project === undefined) project = await identityFor(line.cwd);
                if (agg.hasRecords() && !agg.fits(line, project)) {
                  agg.setCheckpoint(partial(consumed));
                  yield stampAccount(agg.takeChunk());
                }
                agg.add(line, project);
              }
            }
            agg.countLine(file.path, line === null);
            consumed = raw.end;
          }
        }
      } catch {
        // Unreadable file: keep what was consumed, retry the rest next cycle.
        if (consumed > start) agg.setCheckpoint(partial(consumed));
        return;
      }
      agg.setCheckpoint(final(consumed));
    }
  }

  /** Before any scan has seen a line: parse the tail of the most recently modified file. */
  async function peekNewest(): Promise<void> {
    if (peeked || tracker.lastMs !== null) return;
    peeked = true;
    let files: TranscriptFile[];
    try {
      files = await listTranscriptFiles(source.projectsDir, fs);
    } catch {
      return;
    }
    let newest: { path: string; stat: StatLike } | null = null;
    for (const file of files) {
      const stat = await statOrNull(file.path);
      if (stat !== null && (newest === null || stat.mtimeMs > newest.stat.mtimeMs)) {
        newest = { path: file.path, stat };
      }
    }
    if (newest === null) return;
    const start = Math.max(0, newest.stat.size - BLOCK_SIZE);
    try {
      const elision = transcriptElision(NO_GATES);
      const end = newest.stat.size;
      for await (const batch of readLineBatches(fs, newest.path, start, end, BLOCK_SIZE, elision)) {
        for (const raw of batch) {
          if (raw.start === start && start > 0) continue; // may begin mid-line
          const line = parseLine(raw.text, NO_GATES);
          if (line !== null) tracker.observe(line);
        }
      }
    } catch {
      // Unreadable: stay unknown.
    }
  }

  return {
    scan,
    async claudeCodeVersion() {
      await peekNewest();
      return tracker.version;
    },
    async lastLocalActivityAt() {
      await peekNewest();
      return tracker.lastMs === null ? null : new Date(tracker.lastMs);
    },
  };
}

/**
 * Sets the chunk's `observed_at` to the newest activity among the chunk's sessions: the latest
 * time the data shows this account in use. It is derived only from the lines being sent, so a
 * re-scan of the same data from the same checkpoints builds byte-identical records and a retry
 * reuses its batch_id (sync-api-v1 §8.2). An account travels only with sessions.
 */
function stampAccount(chunk: ScanChunk): ScanChunk {
  const [account] = chunk.records.accounts;
  if (account === undefined) return chunk;
  if (chunk.records.sessions.length === 0) {
    return { ...chunk, records: { ...chunk.records, accounts: [] } };
  }
  const observed_at = chunk.records.sessions
    .map((s) => s.last_seen_at)
    .reduce((newest, at) => (at > newest ? at : newest));
  return { ...chunk, records: { ...chunk.records, accounts: [{ ...account, observed_at }] } };
}

function isRecordLine(line: ParsedLine, since: number | null): line is RecordLine {
  return (
    line.sessionId !== null &&
    line.timestampMs !== null &&
    (since === null || line.timestampMs >= since)
  );
}
