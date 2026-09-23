# H03 — Sync API Contract (PRD Phase 2, §27–39)
Status: todo · Wave 2 · parallel with H02, H04 · Branch `handover/H03-sync-api-contract`

## Objective
Freeze the agent ↔ backend contract as (1) a normative markdown spec, (2) JSON Schemas + canonical example payloads both sides test against, and (3) the agent's TypeScript/zod contract module, including the internal `ScanSource` interface between reader (H09) and sync engine (H10).

## Read first
`docs/architecture/sync-protocol.md` (the draft to finalize), `data-model.md`, `agent.md` §3, PRD §9, §12, §23, §27–39, §55.

## Depends on
H01.

## Owned files
`docs/contracts/sync-api-v1.md`, `docs/contracts/schemas/**`, `docs/contracts/examples/**`, `6am-agent/src/core/contract/**`, `6am-agent/test/unit/contract/**`.

## Allowed dependencies
None new (`zod` already installed). Dev-only JSON Schema checking in tests: generate JSON Schema from zod with zod v4's `z.toJSONSchema()` if available, otherwise hand-write the schemas and assert that the examples parse with zod.

## Deliverables
1. `sync-api-v1.md`: finalize every endpoint in the draft (request, response, headers, status codes, error envelope, limits, category gating table, cursor semantics, idempotency table, retry guidance per error, versioning policy: additive fields only within v1; unknown fields ignored by both sides). State explicitly: developer identity comes from the device token, so the PRD's `developers: []` payload key is intentionally omitted.
2. `schemas/`: `register.request.json`, `register.response.json`, `settings.response.json`, `heartbeat.request.json`, `heartbeat.response.json`, `sync.request.json`, `sync.response.json`, `sync-status.response.json`, `error.json`.
3. `examples/`: valid `sync.request.full.json`, `sync.request.minimal.json` (usage only), `sync.request.prompt-off.json`, `sync.request.initial.json`, the matching responses, `error.*.json` for every code, and **invalid** examples `invalid/*.json` (negative token, missing batch_id, bad timestamp, unknown platform, oversize arrays). Backend tests (H05/H06) and agent tests (H10) load these files by path.
4. `6am-agent/src/core/contract/`:
   - `schemas.ts`: zod schemas mirroring every JSON Schema. Export inferred types: `RegisterRequest`, `RegisterResponse`, `TrackingSettings`, `HeartbeatRequest`, `HeartbeatResponse`, `SyncRequest`, `SyncResponse`, `SyncStatusResponse`, `ApiError`, `AccountRecord`, `ProjectRecord`, `SessionRecord`, `UsageRecord`, `MessageRecord`.
   - `errors.ts`: `export type ApiErrorCode = 'unauthenticated'|'device_disabled'|'device_uninstalled'|'batch_in_progress'|'batch_too_large'|'invalid_payload'|'agent_outdated'|'rate_limited'|'persistence_failed'|'invalid_pairing_code'`, plus `export const RETRYABLE: Record<ApiErrorCode, boolean>`.
   - `scan.ts` (internal boundary, frozen after this handover):
     ```ts
     export interface FileCheckpoint { path: string; fileIdentity: string; size: number; mtimeMs: number; offset: number }
     export interface ScanRecords { accounts: AccountRecord[]; projects: ProjectRecord[]; sessions: SessionRecord[]; usage: UsageRecord[]; messages: MessageRecord[] }
     export interface ScanChunk { records: ScanRecords; checkpoints: FileCheckpoint[] /* advances valid only if this chunk is acked */; stats: { filesRead: number; linesRead: number; linesSkipped: number } }
     export interface ScanOptions { settings: TrackingSettings; since: Date | null; maxUsagePerChunk: number; maxSessionsPerChunk: number; maxMessagesPerChunk: number }
     export interface ScanSource { scan(checkpoints: ReadonlyMap<string, FileCheckpoint>, opts: ScanOptions): AsyncIterable<ScanChunk>; claudeCodeVersion(): Promise<string | null>; lastLocalActivityAt(): Promise<Date | null> }
     ```
   - `index.ts` re-exports.
5. Tests `test/unit/contract/examples.test.ts`: every valid example parses; every `invalid/*` fails with the expected path.

## Validation
`cd 6am-agent && npm test && npm run typecheck && npm run lint`. Also `node -e` JSON-parse every file in `docs/contracts/**`.

## Acceptance criteria
One unambiguous spec. Every PRD §34–39 responsibility maps to an endpoint/field. Nullability matches `data-model.md`. Category gating rules are stated for both agent and backend.

## Review checklist
Spec, schemas, zod, and examples agree (spot-check 5 fields across all four) · no token-derived fields in agent payloads (actual/total are backend-only) · `batch_id` retry semantics clear · cursor advances only on `success:true`.

## Commit
`docs(H03): sync api v1 contract, json schemas, examples and agent zod types`
