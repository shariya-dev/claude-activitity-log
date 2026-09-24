import type {
  FileCheckpoint,
  ScanChunk,
  ScanOptions,
  ScanRecords,
  ScanSource,
  UsageRecord,
} from '../../../src/core/contract/index.js';

/** One fake transcript file: an ordered list of usage records, one "line" each. */
export interface FakeFile {
  path: string;
  usage: UsageRecord[];
}

export const usageRecord = (id: string, sessionId = 'sess-1'): UsageRecord => ({
  source_message_id: id,
  source_session_id: sessionId,
  request_id: null,
  model: 'claude-opus-4-1',
  is_sidechain: false,
  recorded_at: '2026-09-20T10:00:00Z',
  input_tokens: 1,
  output_tokens: 2,
  cache_creation_tokens: 3,
  cache_read_tokens: 4,
});

export const emptyRecords = (): ScanRecords => ({
  accounts: [],
  projects: [],
  sessions: [],
  usage: [],
  messages: [],
});

/**
 * Checkpoint-driven fake ScanSource. The checkpoint `offset` of a file is the number of its
 * records already acknowledged. Each chunk carries at most `opts.maxUsagePerChunk` records of a
 * single file and the checkpoint advance that the chunk would produce. `append()` simulates new
 * activity; `failWith` makes the next scan throw.
 */
export class FakeScanSource implements ScanSource {
  files: FakeFile[];
  scanCalls: { checkpoints: Map<string, FileCheckpoint>; opts: ScanOptions }[] = [];
  failWith: Error | null = null;
  lastActivity: Date | null = new Date('2026-09-20T10:00:00Z');
  version: string | null = '2.1.274';

  constructor(files: FakeFile[] = []) {
    this.files = files;
  }

  append(filePath: string, ...usage: UsageRecord[]): void {
    const file = this.files.find((f) => f.path === filePath);
    if (file) file.usage.push(...usage);
    else this.files.push({ path: filePath, usage });
  }

  async *scan(
    checkpoints: ReadonlyMap<string, FileCheckpoint>,
    opts: ScanOptions,
  ): AsyncIterable<ScanChunk> {
    this.scanCalls.push({ checkpoints: new Map(checkpoints), opts });
    if (this.failWith) {
      const err = this.failWith;
      this.failWith = null;
      throw err;
    }
    for (const file of this.files) {
      let offset = checkpoints.get(file.path)?.offset ?? 0;
      while (offset < file.usage.length) {
        const usage = file.usage.slice(offset, offset + Math.max(1, opts.maxUsagePerChunk));
        offset += usage.length;
        yield {
          records: { ...emptyRecords(), usage },
          checkpoints: [
            {
              path: file.path,
              fileIdentity: `id:${file.path}`,
              size: file.usage.length,
              mtimeMs: 1_700_000_000_000,
              offset,
            },
          ],
          stats: { filesRead: 1, linesRead: usage.length, linesSkipped: 0 },
        };
      }
    }
  }

  claudeCodeVersion(): Promise<string | null> {
    return Promise.resolve(this.version);
  }

  lastLocalActivityAt(): Promise<Date | null> {
    return Promise.resolve(this.lastActivity);
  }
}
