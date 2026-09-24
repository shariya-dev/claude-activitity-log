/**
 * Sync API v1 payload schemas (docs/contracts/sync-api-v1.md).
 * docs/contracts/schemas/*.json are generated from these (test/unit/contract/jsonSchemas.test.ts).
 *
 * Every field is required; optional data is an explicit `null`. `z.object` strips unknown
 * fields, so receivers ignore additive v1 fields.
 */
import * as z from 'zod';
import { API_ERROR_CODES } from './errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLATFORMS = ['macos', 'windows', 'linux'] as const;

export const AGENT_STATES = [
  'ok',
  'syncing',
  'backoff',
  'claude_data_unavailable',
  'update_required',
  'needs_repair',
  'device_disabled',
  'error',
] as const;

export const TRACKING_CATEGORIES = [
  'session',
  'usage',
  'project',
  'model',
  'device',
  'account',
  'prompt',
  'git',
  'network',
] as const;

export const INITIAL_SYNC_RANGES = ['1d', '7d', '30d', 'all'] as const;

export const RECORD_TYPES = ['account', 'project', 'session', 'usage', 'message'] as const;

/** Reasons the v1 backend emits. `rejected_records[].reason` stays an open string. */
export const KNOWN_REJECTION_REASONS = [
  'negative_token_value',
  'invalid_value',
  'invalid_timestamp',
  'future_timestamp',
  'unknown_session',
  'unknown_project',
  'unknown_account',
  'category_disabled',
] as const;

export const SYNC_LIMITS = {
  accounts: 50,
  projects: 200,
  sessions: 200,
  usage: 500,
  messages: 200,
  rejectedRecords: 100,
  maxBodyBytes: 2 * 1024 * 1024,
} as const;

export const MAX_MESSAGE_CONTENT_CHARS = 100_000;

// ---------------------------------------------------------------------------
// Shared value formats
// ---------------------------------------------------------------------------

const str = (min: number, max: number) => z.string().min(min).max(max);
const timestamp = () => z.iso.datetime();
const sha256Hex = () => z.string().regex(/^[0-9a-f]{64}$/);
const semver = () =>
  z
    .string()
    .max(32)
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const uuidV4 = () => z.uuid({ version: 'v4' });
const tokenCount = () => z.number().int().nonnegative();
const count = () => z.number().int().nonnegative();
const version = () => z.number().int().min(1);

export const PlatformSchema = z.enum(PLATFORMS);
export const AgentStateSchema = z.enum(AGENT_STATES);
export const DeviceIdSchema = z.string().regex(/^dev_[0-9A-HJKMNP-TV-Z]{26}$/);
export const CursorSchema = z.string().max(255);

// ---------------------------------------------------------------------------
// GET /settings
// ---------------------------------------------------------------------------

export const TrackingSettingsSchema = z.object({
  version: version(),
  categories: z.object({
    session: z.boolean(),
    usage: z.boolean(),
    project: z.boolean(),
    model: z.boolean(),
    device: z.boolean(),
    account: z.boolean(),
    prompt: z.boolean(),
    git: z.boolean(),
    network: z.boolean(),
  }),
  initial_sync: z.object({
    range: z.enum(INITIAL_SYNC_RANGES),
    since: timestamp().nullable(),
  }),
  sync_interval_seconds: z.number().int().min(60),
  heartbeat_interval_seconds: z.number().int().min(60),
  min_agent_version: semver(),
});

// ---------------------------------------------------------------------------
// POST /register
// ---------------------------------------------------------------------------

export const RegisterRequestSchema = z.object({
  pairing_code: str(1, 32),
  device: z.object({
    hostname: str(1, 191).nullable(),
    platform: PlatformSchema,
    platform_version: str(1, 64).nullable(),
    architecture: str(1, 64),
    machine_fingerprint: sha256Hex(),
    agent_version: semver(),
    claude_code_version: str(1, 64).nullable(),
  }),
});

export const RegisterResponseSchema = z.object({
  device_id: DeviceIdSchema,
  token: z.string().min(1),
  developer: z.object({
    name: str(1, 191),
    email: str(1, 191),
  }),
  settings: TrackingSettingsSchema,
});

// ---------------------------------------------------------------------------
// POST /heartbeat
// ---------------------------------------------------------------------------

export const HeartbeatRequestSchema = z.object({
  agent_version: semver(),
  claude_code_version: str(1, 64).nullable(),
  platform_version: str(1, 64).nullable(),
  hostname: str(1, 191).nullable(),
  agent_state: AgentStateSchema,
  last_local_activity_at: timestamp().nullable(),
  last_successful_sync_at: timestamp().nullable(),
  last_error: str(1, 500).nullable(),
});

export const HeartbeatResponseSchema = z.object({
  server_time: timestamp(),
  settings_version: version(),
  sync_requested: z.boolean(),
});

// ---------------------------------------------------------------------------
// POST /sync — records
// ---------------------------------------------------------------------------

export const AccountRecordSchema = z.object({
  account_key: sha256Hex(),
  account_uuid: str(1, 64).nullable(),
  email: str(1, 191).nullable(),
  display_name: str(1, 191).nullable(),
  organization_uuid: str(1, 64).nullable(),
  organization_name: str(1, 191).nullable(),
  observed_at: timestamp(),
});

export const ProjectRecordSchema = z.object({
  project_key: sha256Hex(),
  name: str(1, 191),
  path: str(1, 4096),
  git_remote: str(1, 255).nullable(),
  first_seen_at: timestamp(),
  last_seen_at: timestamp(),
});

export const SessionRecordSchema = z.object({
  source_session_id: str(1, 64),
  project_key: sha256Hex().nullable(),
  account_key: sha256Hex().nullable(),
  first_seen_at: timestamp(),
  last_seen_at: timestamp(),
  ended_at: timestamp().nullable(),
  claude_code_version: str(1, 64).nullable(),
  entrypoint: str(1, 64).nullable(),
  git_branch: str(1, 191).nullable(),
  model: str(1, 128).nullable(),
});

/** Raw token integers only: token math (actual/total) lives in the backend. */
export const UsageRecordSchema = z.object({
  source_message_id: str(1, 64),
  source_session_id: str(1, 64),
  request_id: str(1, 64).nullable(),
  model: str(1, 128).nullable(),
  is_sidechain: z.boolean(),
  recorded_at: timestamp(),
  input_tokens: tokenCount(),
  output_tokens: tokenCount(),
  cache_creation_tokens: tokenCount(),
  cache_read_tokens: tokenCount(),
});

/** Only sent when the prompt category is ON. */
export const MessageRecordSchema = z.object({
  source_message_id: str(1, 64),
  source_session_id: str(1, 64),
  role: z.enum(['user']),
  content: str(1, MAX_MESSAGE_CONTENT_CHARS),
  recorded_at: timestamp(),
});

// ---------------------------------------------------------------------------
// POST /sync — envelope
// ---------------------------------------------------------------------------

export const SyncAgentSchema = z.object({
  device_id: DeviceIdSchema,
  platform: PlatformSchema,
  platform_version: str(1, 64).nullable(),
  architecture: str(1, 64),
  agent_version: semver(),
  claude_code_version: str(1, 64).nullable(),
});

export const SyncMetaSchema = z.object({
  batch_id: uuidV4(),
  cursor: CursorSchema.nullable(),
  is_initial: z.boolean(),
  settings_version: version(),
  sequence: z.number().int().min(1),
});

export const SyncRequestSchema = z.object({
  agent: SyncAgentSchema,
  sync: SyncMetaSchema,
  accounts: z.array(AccountRecordSchema).max(SYNC_LIMITS.accounts),
  projects: z.array(ProjectRecordSchema).max(SYNC_LIMITS.projects),
  sessions: z.array(SessionRecordSchema).max(SYNC_LIMITS.sessions),
  usage: z.array(UsageRecordSchema).max(SYNC_LIMITS.usage),
  messages: z.array(MessageRecordSchema).max(SYNC_LIMITS.messages),
});

export const RejectedRecordSchema = z.object({
  type: z.enum(RECORD_TYPES),
  source_id: z.string(),
  reason: z.string(),
});

export const SyncResponseSchema = z.object({
  success: z.literal(true),
  batch_id: uuidV4(),
  sync: z.object({
    accepted: count(),
    created: count(),
    updated: count(),
    rejected: count(),
  }),
  rejected_records: z.array(RejectedRecordSchema).max(SYNC_LIMITS.rejectedRecords),
  cursor: CursorSchema,
  settings_version: version(),
  server_time: timestamp(),
});

// ---------------------------------------------------------------------------
// GET /sync/status
// ---------------------------------------------------------------------------

export const SyncStatusResponseSchema = z.object({
  last_batch_id: uuidV4().nullable(),
  cursor: CursorSchema.nullable(),
  sequence: count(),
  last_success_at: timestamp().nullable(),
  sessions_known: count(),
});

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    retryable: z.boolean(),
    /** Only for `invalid_payload`: field path → messages. */
    errors: z.record(z.string(), z.array(z.string())).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Platform = z.infer<typeof PlatformSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export type TrackingSettings = z.infer<typeof TrackingSettingsSchema>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;
export type AccountRecord = z.infer<typeof AccountRecordSchema>;
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
export type UsageRecord = z.infer<typeof UsageRecordSchema>;
export type MessageRecord = z.infer<typeof MessageRecordSchema>;
export type SyncAgent = z.infer<typeof SyncAgentSchema>;
export type SyncMeta = z.infer<typeof SyncMetaSchema>;
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
export type RejectedRecord = z.infer<typeof RejectedRecordSchema>;
export type SyncResponse = z.infer<typeof SyncResponseSchema>;
export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
