# H10 — Agent: Sync Engine (state, settings, API client, cursor, retry, heartbeat, runtime loop)
Status: todo · Wave 3 · parallel with H05–H09 · Branch `handover/H10-agent-sync-engine`

## Objective
Everything in the agent core between a `ScanSource` and the network: SQLite state store, settings manager, HTTP API client, sync manager with the cursor-commit rule, backoff, heartbeat, and the runtime scheduler loop. Fully testable with fakes, with no dependency on the real reader or OS adapters.

## Read first
`docs/contracts/sync-api-v1.md`, `.claude/rules/sync-protocol.md`, `6am-agent/CLAUDE.md`, `docs/architecture/agent.md` §3–4, PRD §5, §27–33, §35, §39, §55.

## Depends on
H03 (contract types incl. `ScanSource`). H01's `PlatformAdapter` type (only `CredentialStore` is used here).

## Owned files
`6am-agent/src/core/state/**`, `src/core/settings/**`, `src/core/sync/**`, `src/core/runtime/**`, `test/unit/{state,settings,sync,runtime}/**`, `test/helpers/fakes/**`.

## Allowed dependencies
None beyond `zod` + `node:sqlite` (or the H01-approved fallback).

## Interfaces produced (H18 composes these)
```ts
// state/stateStore.ts
export interface StateStore {
  get<K extends keyof KvSchema>(k: K): KvSchema[K] | null; set<K extends keyof KvSchema>(k: K, v: KvSchema[K]): void;
  checkpoints(): Map<string, FileCheckpoint>;
  commitBatch(checkpoints: FileCheckpoint[], kv: Partial<KvSchema>): void;   // ONE transaction
  resetCheckpoints(): void; close(): void;
}
export type KvSchema = { device_uid: string; server_cursor: string; settings: TrackingSettings; settings_version: number;
  last_settings_sync_at: string; last_success_sync_at: string; last_failure_at: string; last_error_code: string;
  agent_state: AgentState; agent_version: string; initial_sync_done: boolean; sync_sequence: number };
export function openStateStore(dbPath: string): StateStore;   // creates schema (kv, file_checkpoints) with a user_version migration

// sync/apiClient.ts
export interface ApiClient {
  register(req: RegisterRequest): Promise<RegisterResponse>;
  heartbeat(req: HeartbeatRequest): Promise<HeartbeatResponse>;
  settings(): Promise<TrackingSettings>;
  sync(req: SyncRequest): Promise<SyncResponse>;
  syncStatus(): Promise<SyncStatusResponse>;
  deregister(): Promise<void>;
}
export class ApiError extends Error { code: ApiErrorCode | 'network' | 'timeout' | 'invalid_response'; status: number | null; retryable: boolean; retryAfterMs: number | null }
export function createApiClient(o: { baseUrl: string; getToken: () => Promise<string | null>; fetchImpl?: typeof fetch; timeoutMs?: number; userAgent: string }): ApiClient
// validates every response with zod (invalid ⇒ ApiError invalid_response), gzip-compresses bodies > 64 KB, rejects http: unless AGENT_ALLOW_INSECURE_LOCALHOST=1 and host 127.0.0.1/localhost

// sync/backoff.ts
export function nextDelayMs(attempt: number, rand?: () => number): number;   // 30s·2^n, cap 15 min, ±20 % jitter

// settings/settingsManager.ts
export interface SettingsManager { current(): TrackingSettings; refreshIfNeeded(serverVersion?: number): Promise<boolean> }

// sync/syncManager.ts
export interface SyncOutcome { status: 'ok' | 'nothing' | 'failed' | 'stopped'; batches: number; accepted: number; rejected: number; error?: ApiError }
export function createSyncManager(d: { api: ApiClient; state: StateStore; scan: ScanSource; settings: SettingsManager; agentInfo: () => Promise<AgentInfo>; clock?: () => Date; uuid?: () => string; logger: Logger }): { runOnce(): Promise<SyncOutcome> }

// runtime/agentRuntime.ts
export function createAgentRuntime(d: { sync: ReturnType<typeof createSyncManager>; api: ApiClient; state: StateStore; settings: SettingsManager; scan: ScanSource; agentInfo: () => Promise<AgentInfo>; clock?: Clock; logger: Logger }): { start(): Promise<void>; stop(): Promise<void>; requestSync(): void; status(): RuntimeStatus }

// runtime/logger.ts
export function createLogger(o: { dir: string; level?: 'debug'|'info'|'warn'|'error'; maxBytes?: number; files?: number }): Logger  // JSON lines, rotating, redacts keys matching /token|authorization|content|prompt|email/i
```
`AgentInfo` = the contract `agent` object (device_id, platform, versions). Defined in `sync/types.ts`.

## Behavior
- `runOnce`: refresh settings if due → for each chunk from `scan.scan(state.checkpoints(), opts)` build `SyncRequest` (`batch_id` = uuid **persisted in memory for retries of the same chunk**, `sequence`, `is_initial = !initial_sync_done`, `settings_version`) → `api.sync` → success ⇒ `state.commitBatch(chunk.checkpoints, {server_cursor, last_success_sync_at, sync_sequence})`. Any error ⇒ record `last_failure_at/error_code`, **don't commit**, stop this run, and return `failed` with the error so the runtime schedules a backoff. 413 ⇒ halve the chunk limits and retry once. 401 ⇒ `agent_state='needs_repair'`, return `stopped`. 403 ⇒ `device_disabled`/`device_uninstalled`, `stopped`. 426 ⇒ `update_required`. After the first full successful pass, set `initial_sync_done=true`.
- The settings version from any response header/body that is newer ⇒ refetch before the next chunk (and apply to the next chunk).
- Runtime loop: 60 s tick. Heartbeat every `heartbeat_interval_seconds`, also when `stopped` (disabled: once per hour). Sync every `sync_interval_seconds`, or immediately when a heartbeat says `sync_requested` or `requestSync()` is called. Only one sync runs at a time. Backoff state is in memory, attempt reset on success. Connectivity check = the request itself (no ping endpoint). The runtime never throws out of `start()`: it catches, logs, and continues.

## Tests (vitest, fake clock via `vi.useFakeTimers`, fake ScanSource/ApiClient/fetch in `test/helpers/fakes/`)
State: commitBatch is atomic (inject a failure mid-transaction ⇒ nothing changed); schema migration idempotent; contains no record tables. API client: contract examples round-trip; invalid response ⇒ `invalid_response`; timeout; 429 `Retry-After`; http rejection; gzip over threshold; Authorization header never logged. Sync manager: **cursor never advances on 500/timeout/422/network** (AC17); success advances exactly the chunk's checkpoints; the retry reuses the same batch_id; a multi-chunk run where chunk 2 fails leaves chunk 1 committed and chunk 2 retried next time; 413 halving; 401/403/426 states; offline then online: no commits while offline, full catch-up after (AC14). Backoff bounds + jitter. Runtime: heartbeat cadence, sync_requested triggers an immediate sync, no overlapping syncs, survives thrown errors. Logger redaction.

## Validation
`cd 6am-agent && npm test && npm run lint && npm run typecheck`. Coverage ≥ 90 % for the owned dirs.

## Acceptance criteria
PRD §27, §30, §32, §39, §55 behaviors are demonstrated by named tests · SQLite is minimal (§28) · no OS-specific code.

## Review checklist
Commit only after `success:true` · one SQLite transaction per batch · secrets only via `CredentialStore`/`getToken` · no busy loops (timers only) · error map matches the contract table.

## Commit
`feat(H10): agent sync engine with state store, api client, cursor commit rule, backoff and heartbeat`
