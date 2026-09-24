import { SYNC_LIMITS } from '../contract/index.js';
import type { SyncAgent } from '../contract/index.js';

/**
 * The contract `agent` object (device_id, platform, versions) plus the hostname, which only the
 * heartbeat sends (and only while the Device category is ON). Supplied by the composition root.
 */
export type AgentInfo = SyncAgent & { hostname: string | null };

/** Per-chunk limits handed to `ScanSource.scan`. Halved after a `413 batch_too_large`. */
export interface ChunkLimits {
  maxUsagePerChunk: number;
  maxSessionsPerChunk: number;
  maxMessagesPerChunk: number;
  maxBytesPerChunk: number;
}

/** Headroom kept below the 2 MB body limit for the envelope and JSON escaping. */
export const BODY_HEADROOM_BYTES = 64 * 1024;

export const DEFAULT_CHUNK_LIMITS: ChunkLimits = {
  maxUsagePerChunk: SYNC_LIMITS.usage,
  maxSessionsPerChunk: SYNC_LIMITS.sessions,
  maxMessagesPerChunk: SYNC_LIMITS.messages,
  maxBytesPerChunk: SYNC_LIMITS.maxBodyBytes - BODY_HEADROOM_BYTES,
};
