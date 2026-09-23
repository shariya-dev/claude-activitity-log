# Data Model (MySQL 8, InnoDB, utf8mb4)

Conventions: `id` BIGINT UNSIGNED auto PK; FKs `foreignId()->constrained()`; **`restrictOnDelete`** everywhere on monitoring data (history is never cascaded away); timestamps UTC; "enum" columns are `VARCHAR` backed by PHP string enums; nullable wherever Phase 0 shows a field is not reliably available (PRD §14).

## ER overview

```
users (admin/viewer)                   tracking_settings (singleton, versioned)
                                        audit_logs ──► users (actor)
developers 1─* devices 1─1 agent_sync_states
    │            │  1─* sync_batches
    │            │  1─* personal_access_tokens (Sanctum, tokenable)
    │            │  *─* claude_accounts  (claude_account_device)
    │            │  1─* project_locations *─1 projects
    │  1─* pairing_codes
    │  1─* claude_accounts
    └─* claude_sessions *─1 devices / projects / claude_accounts / claude_models
              1─* session_usage *─1 claude_models
              1─* session_messages
usage_daily_rollups (derived: date × developer × device × project × account × model)
```

## Tables

### users *(starter kit + additions)*
`role` varchar(16) default `viewer` (`admin|viewer`), `can_view_prompts` bool default false, `is_active` bool default true.

### developers
| col | type | notes |
|---|---|---|
| name | varchar(120) | |
| email | varchar(191) | **unique** — the one central identity |
| team | varchar(120) null | |
| status | varchar(16) | `active|inactive`; inactive ⇒ pairing codes rejected |
| timestamps, soft deletes | | soft delete only; history kept |

### pairing_codes
`developer_id` FK, `code_hash` char(64) **unique** (sha256 of normalized code), `expires_at`, `used_at` null, `used_by_device_id` FK null, `created_by_user_id` FK, `purpose` (`pair|repair`), timestamps. Index `(developer_id, used_at)`.

### devices
| col | type | notes |
|---|---|---|
| device_uid | char(30) | **unique**, public id `dev_` + ULID |
| developer_id | FK | |
| machine_fingerprint | char(64) | sha256; **unique (developer_id, machine_fingerprint)** ⇒ re-pair reuses row; network never involved |
| hostname | varchar(191) null | |
| platform | varchar(16) | `macos|windows|linux` (validated from config list; no per-OS columns) |
| platform_version, architecture, agent_version, claude_code_version | varchar(64) null | |
| status | varchar(16) | `active|disabled|uninstalled` (stored). `online/stale/offline` is **derived** from `last_seen_at` |
| agent_state | varchar(32) null | last reported by heartbeat |
| first_seen_at, last_seen_at, last_sync_at, last_local_activity_at | timestamp null | |
| sync_requested_at | timestamp null | admin "Sync Now" flag |
| last_public_ip | varchar(45) null | only when Network ON |
| disabled_at, uninstalled_at | timestamp null | |
Indexes: `(status, last_seen_at)`, `(developer_id)`.

### agent_sync_states *(1:1 device)*
`device_id` **unique**, `cursor` varchar(255) null, `sequence` bigint default 0, `last_batch_uuid` char(36) null, `last_success_at`, `last_failure_at`, `last_error_code` varchar(64) null, `last_error_message` text null, `consecutive_failures` int, `records_created_total`, `records_updated_total`, `records_rejected_total` bigint, `health` varchar(16) (`healthy|offline|sync_failed|disabled`, refreshed on sync and by `monitor:mark-offline`). Index `(health)`.

### sync_batches *(audit trail of sync attempts; pruned after 90 days)*
`device_id` FK, `batch_uuid` char(36), **unique (device_id, batch_uuid)**, `status` (`processing|succeeded|failed`), `is_initial` bool, counts `accepted|created|updated|rejected` int, `rejections` json null (capped 100 items), `error_code` null, `payload_bytes` int, `duration_ms` int, `response` json null (stored for idempotent replay), `received_at`, `completed_at`. Index `(device_id, received_at)`, `(status, received_at)`.

### claude_accounts
`developer_id` FK, `account_key` char(64), **unique (developer_id, account_key)**, `account_uuid` varchar(64) null, `email` varchar(191) null, `display_name` varchar(191) null, `organization_uuid` varchar(64) null, `organization_name` varchar(191) null, `status` (`active|inactive`), `first_seen_at`, `last_seen_at`.
### claude_account_device
`claude_account_id`, `device_id`, **PK/unique both**, `first_seen_at`, `last_seen_at`.

### projects
`project_key` char(64) **unique**, `name` varchar(191), `git_remote` varchar(255) null, `first_activity_at`, `last_activity_at`, `session_count` int, token totals (6 cols, see below) — denormalized, refreshed by ingestion. Index `(last_activity_at)`.
### project_locations
`project_id`, `device_id`, `path` text, `path_hash` char(64), **unique (project_id, device_id, path_hash)**, `first_seen_at`, `last_seen_at`. ("Project path" and "developers/devices per project" come from here + sessions.)

### claude_models
`name` varchar(128) **unique** (dynamic, no fixed list), `first_seen_at`, `last_seen_at`.

### claude_sessions *(PRD "sessions"; renamed — D9)*
| col | type | notes |
|---|---|---|
| device_id, developer_id | FK | developer denormalized for filters |
| claude_account_id, project_id, claude_model_id | FK null | model = most recent model in session |
| source_session_id | varchar(64) | **unique (device_id, source_session_id)** |
| started_at, last_activity_at | timestamp | from LEAST/GREATEST of observed line timestamps |
| ended_at | timestamp null | only if source data establishes it (Phase 0) |
| duration_seconds | int unsigned | `last_activity_at - started_at` (wall span; documented as such) |
| activity_count | int unsigned | count of distinct assistant API messages (= `session_usage` rows) |
| input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, actual_consumed_tokens, total_token_activity | bigint unsigned default 0 | sums of session_usage |
| status | varchar(16) | `active` (activity < 30 min ago) / `idle` / `ended` — derived at write + read |
| claude_code_version, entrypoint | varchar(64) null | |
| git_branch | varchar(191) null | only when Git ON |
| timestamps | | |
Indexes: `(developer_id, started_at)`, `(device_id, started_at)`, `(project_id, started_at)`, `(claude_account_id, started_at)`, `(claude_model_id, started_at)`, `(started_at)`, `(last_activity_at)`.

### session_usage *(one row per Claude API message; PRD §42)*
| col | notes |
|---|---|
| claude_session_id FK, source_message_id varchar(64) | **unique (claude_session_id, source_message_id)** |
| request_id varchar(64) null, is_sidechain bool | |
| claude_model_id FK null | |
| device_id, developer_id, project_id null, claude_account_id null | denormalized for rollups; re-synced when session dims change |
| input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens | bigint unsigned, raw, preserved |
| actual_consumed_tokens, total_token_activity | bigint unsigned, **backend-computed by TokenMath** |
| recorded_at | timestamp(3) |
| recorded_on | date — `recorded_at` in `MONITOR_TIMEZONE` |
| timestamps | |
Indexes: `(recorded_on, device_id)`, `(claude_session_id, recorded_at)`.

### usage_daily_rollups *(derived, rebuildable from session_usage)*
`date`, `developer_id`, `device_id`, `project_id` null, `claude_account_id` null, `claude_model_id` null, `dims_hash` char(64) (sha256 of the 6 dims incl. nulls) **unique**, the 6 token columns, `message_count` int, `updated_at`. Indexes: `(date, developer_id)`, `(date, project_id)`, `(date, claude_model_id)`, `(date, claude_account_id)`, `(date, device_id)`. Refresh = delete+insert-select for touched `(device_id, date)` inside the batch transaction. Command `monitor:recalculate-tokens` rebuilds everything (used if TokenMath changes).

### session_messages *(only when Prompt ON)*
`claude_session_id` FK, `source_message_id` varchar(64), **unique (claude_session_id, source_message_id)**, `role` varchar(16), `content` longtext **encrypted cast**, `recorded_at` timestamp(3). Index `(claude_session_id, recorded_at)`. Access: `viewPrompts` gate + `audit_logs` entry per view. Purged by retention.

### tracking_settings *(singleton row id=1)*
`session, usage, project, model, device, account` bool default true; `prompt, git, network` bool default **false**; `initial_sync_range` varchar(8) default `7d` (`1d|7d|30d|all`); `sync_interval_seconds` int default 120 (min 60); `heartbeat_interval_seconds` int default 300; `min_agent_version` varchar(32) default `1.0.0`; `retention_days` int null (null = keep forever; applies to `session_messages`, `session_usage` older than N days after rollups exist, `sync_batches` fixed 90 d); `version` int (incremented on every change); `updated_by_user_id` FK null; timestamps. Seeded by migration.

### audit_logs
`user_id` FK null (null = system/agent), `action` varchar(64) (e.g. `tracking.updated`, `prompt.viewed`, `device.disabled`, `device.repaired`, `pairing_code.issued`, `sync.requested`, `user.role_changed`, `retention.updated`), `subject_type` / `subject_id` (morph, nullable), `metadata` json (before/after diffs; **never** prompt content or tokens), `ip_address` varchar(45) null, `user_agent` varchar(255) null, `created_at`. Indexes `(action, created_at)`, `(subject_type, subject_id)`, `(user_id, created_at)`. Append-only (no update/delete routes).

## Constraint checklist vs PRD
- Multiple devices/accounts/networks → one developer: `devices.developer_id`, `claude_accounts.developer_id`, no network columns in any identity key. ✔ (§10, §26)
- Platform-neutral schema: single `devices` table, `platform` string. ✔ (§12, §41)
- Dynamic models: `claude_models.name`. ✔ (§18)
- Raw tokens preserved + backend calc columns. ✔ (§19–21, §42)
- Idempotency unique keys on every ingested entity. ✔ (§38)
- History survives disable/uninstall: status columns + restrictOnDelete + soft-deleted developers. ✔ (§11, §56)
