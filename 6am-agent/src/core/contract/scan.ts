/**
 * Internal boundary between the Claude data reader (H09) and the sync engine (H10).
 * Frozen after H03.
 */
import type {
  AccountRecord,
  MessageRecord,
  ProjectRecord,
  SessionRecord,
  TrackingSettings,
  UsageRecord,
} from './schemas.js';

export interface FileCheckpoint {
  path: string;
  fileIdentity: string;
  size: number;
  mtimeMs: number;
  offset: number;
}

export interface ScanRecords {
  accounts: AccountRecord[];
  projects: ProjectRecord[];
  sessions: SessionRecord[];
  usage: UsageRecord[];
  messages: MessageRecord[];
}

export interface ScanChunk {
  records: ScanRecords;
  checkpoints: FileCheckpoint[] /* advances valid only if this chunk is acked */;
  stats: { filesRead: number; linesRead: number; linesSkipped: number };
}

export interface ScanOptions {
  settings: TrackingSettings;
  since: Date | null;
  maxUsagePerChunk: number;
  maxSessionsPerChunk: number;
  maxMessagesPerChunk: number;
  /** Serialized sync request body must stay <= this (agent uses SYNC_LIMITS.maxBodyBytes minus headroom). */
  maxBytesPerChunk: number;
}

export interface ScanSource {
  scan(
    checkpoints: ReadonlyMap<string, FileCheckpoint>,
    opts: ScanOptions,
  ): AsyncIterable<ScanChunk>;
  claudeCodeVersion(): Promise<string | null>;
  lastLocalActivityAt(): Promise<Date | null>;
}
