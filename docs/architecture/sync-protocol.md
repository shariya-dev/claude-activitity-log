# Sync Protocol v1 (draft — H03 finalizes into `docs/contracts/sync-api-v1.md` + JSON Schemas + zod)

Base: `https://<host>/api/agent/v1`. JSON only, UTF-8, `Content-Type: application/json`, gzip request bodies allowed (`Content-Encoding: gzip`). All timestamps ISO-8601 UTC with `Z`. HTTPS only (except `127.0.0.1` in local dev).

Every authenticated response includes header `X-Settings-Version: <int>` and `X-Server-Time`.

## 1. Endpoints

### `POST /register` (unauthenticated, throttle 10/min/IP)
```json
{ "pairing_code": "K7Q2-M9XD",
  "device": { "hostname": "alim-mbp", "platform": "macos", "platform_version": "26.0.1",
              "architecture": "arm64", "machine_fingerprint": "<sha256 hex>",
              "agent_version": "1.0.0", "claude_code_version": "2.1.274" } }
```
`201`:
```json
{ "device_id": "dev_01J9Z…", "token": "<plaintext sanctum token, shown once>",
  "developer": { "name": "…", "email": "…" },
  "settings": { …same as GET /settings… } }
```
Rules: code valid ⇔ unexpired, unused, developer active. Same `(developer_id, machine_fingerprint)` ⇒ **same device row** (re-pair): old tokens revoked, new token issued, `status=active`, audit `device.repaired`. Errors: `422 invalid_pairing_code` (never reveals which condition failed).

### `GET /settings`
```json
{ "version": 7,
  "categories": { "session": true, "usage": true, "project": true, "model": true, "device": true,
                  "account": true, "prompt": false, "git": false, "network": false },
  "initial_sync": { "range": "7d", "since": "2026-09-15T00:00:00Z" },   // range: 1d|7d|30d|all ; since null for all
  "sync_interval_seconds": 120, "heartbeat_interval_seconds": 300,
  "min_agent_version": "1.0.0" }
```

### `POST /heartbeat`
```json
{ "agent_version": "1.0.0", "claude_code_version": "2.1.274", "platform_version": "26.0.1",
  "agent_state": "ok",                 // ok | syncing | backoff | claude_data_unavailable | update_required | error
  "last_local_activity_at": "…", "last_successful_sync_at": "…", "last_error": null }
```
`200`: `{ "server_time": "…", "settings_version": 7, "sync_requested": false }`. Updates `devices.last_seen_at` (+ `last_public_ip` only if network ON). `sync_requested` is true once after an admin "Sync Now", then cleared.

### `POST /sync`
```json
{
  "agent": { "device_id": "dev_…", "platform": "macos", "platform_version": "26.0.1", "architecture": "arm64",
             "agent_version": "1.0.0", "claude_code_version": "2.1.274" },
  "sync":  { "batch_id": "<uuid v4, reused verbatim on retry>", "cursor": "<last server cursor or null>",
             "is_initial": false, "settings_version": 7, "sequence": 42 },
  "accounts": [ { "account_key": "<sha256 of accountUuid, or of lowercased email if no uuid>",
                  "account_uuid": "…|null", "email": "…|null", "display_name": "…|null",
                  "organization_uuid": "…|null", "organization_name": "…|null",
                  "observed_at": "…" } ],
  "projects": [ { "project_key": "<sha256>", "name": "Backend-6Valley-eCommerce-CMS",
                  "path": "/Applications/MAMP/htdocs/Backend-6Valley-eCommerce-CMS",
                  "git_remote": "…|null", "first_seen_at": "…", "last_seen_at": "…" } ],
  "sessions": [ { "source_session_id": "3cd42766-…", "project_key": "…|null", "account_key": "…|null",
                  "first_seen_at": "…", "last_seen_at": "…", "ended_at": null,
                  "claude_code_version": "2.1.274", "entrypoint": "cli|sdk-cli|…|null",
                  "git_branch": "…|null", "model": "claude-sonnet-5|null" } ],
  "usage": [ { "source_message_id": "msg_011Cf…", "source_session_id": "3cd42766-…",
               "request_id": "req_…|null", "model": "claude-sonnet-5", "is_sidechain": false,
               "recorded_at": "2026-09-22T06:50:32.929Z",
               "input_tokens": 2, "output_tokens": 866,
               "cache_creation_tokens": 48433, "cache_read_tokens": 19929 } ],
  "messages": [ { "source_message_id": "<line uuid>", "source_session_id": "…", "role": "user",
                  "content": "…", "recorded_at": "…" } ]
}
```
Category gating (agent omits, backend strips as defense in depth): `account` OFF ⇒ `accounts=[]`, `account_key=null`; `project` OFF ⇒ `projects=[]`, `project_key=null`; `model` OFF ⇒ `model=null`; `git` OFF ⇒ `git_branch=null`, `git_remote=null`; `prompt` OFF ⇒ `messages=[]`; `usage` OFF ⇒ `usage=[]`; `session` OFF ⇒ nothing but heartbeat is sent. `device` OFF ⇒ hostname sent as `null` in heartbeat/sync updates (identity still via fingerprint captured at pairing).

Limits: ≤ 500 `usage`, ≤ 200 `sessions`, ≤ 200 `messages`, ≤ 2 MB decompressed. `413 batch_too_large` otherwise.

`200` (success):
```json
{ "success": true, "batch_id": "…",
  "sync": { "accepted": 42, "created": 35, "updated": 7, "rejected": 0 },
  "rejected_records": [ { "type": "usage", "source_id": "msg_…", "reason": "negative_token_value" } ],
  "cursor": "<opaque>", "settings_version": 7, "server_time": "2026-09-21T12:50:00Z" }
```

### `GET /sync/status`
`{ "last_batch_id": "…|null", "cursor": "…|null", "last_success_at": "…|null", "sessions_known": 123 }` — used after agent state loss (reinstall) to decide whether to redo an initial scan. Re-sending is always safe.

### `POST /deregister`
Called best-effort by uninstallers. Sets `status=uninstalled`, revokes tokens, keeps all history.

## 2. Cursor semantics
- **Real cursor lives in the agent**: per-file `{path, file_identity, size, mtime_ms, offset}` in SQLite, where `offset` = byte after the last complete `\n` consumed into an acknowledged batch.
- A batch carries the list of checkpoint advances it would produce (kept in agent memory only). On `200 success:true`, the agent commits exactly those advances in one SQLite transaction and stores `cursor`. On anything else, nothing changes; the same `batch_id` + same records are re-sent on retry.
- Server `cursor` = opaque base64url of `{sequence, batch_id, acked_at}` stored in `agent_sync_states`. It is informational/reconciliatory; losing it is harmless.
- File shrink or identity change ⇒ agent resets that file's offset to 0 (idempotent upserts absorb the re-send).
- Initial sync: files with `mtime < initial_sync.since` are checkpointed at EOF without sending; lines with `timestamp < since` are skipped.

## 3. Idempotency (backend)
| Record | Unique key | Merge rule |
|---|---|---|
| batch | `(device_id, batch_uuid)` | Already `succeeded` ⇒ return stored response, no writes |
| account | `(developer_id, account_key)` | nullable fields: `COALESCE(new, old)`; `first_seen_at=LEAST`, `last_seen_at=GREATEST` |
| project | `project_key` | name/path latest non-null; + `project_locations (project_id, device_id, path_hash)` |
| session | `(device_id, source_session_id)` | `started_at=LEAST(first_seen_at)`, `last_activity_at=GREATEST`, other fields latest non-null |
| usage | `(claude_session_id, source_message_id)` | each token column `GREATEST(old,new)`; calc columns recomputed by `TokenMath` |
| message | `(claude_session_id, source_message_id)` | insert-ignore |

After upserts (same transaction): recompute touched sessions' totals + `activity_count` + `duration_seconds`, re-denormalize `session_usage` dims if a session's project/account changed, refresh `usage_daily_rollups` for touched `(device_id, recorded_on)` pairs.

## 4. Error envelope
`{ "success": false, "error": { "code": "…", "message": "…", "retryable": true|false } }`

| HTTP | code | Agent action |
|---|---|---|
| 401 | `unauthenticated` | stop; `needs_repair` |
| 403 | `device_disabled` / `device_uninstalled` | stop syncing; hourly heartbeat probe |
| 409 | `batch_in_progress` | retry same batch after backoff |
| 413 | `batch_too_large` | halve batch, retry |
| 422 | `invalid_payload` (+`errors`) | log contract violation, backoff; no checkpoint advance |
| 426 | `agent_outdated` | `update_required`; keep checkpoints |
| 429 | `rate_limited` | honour `Retry-After` |
| 5xx | `persistence_failed` / other | backoff retry |

Per-record semantic problems (e.g. negative tokens, unparseable timestamp) are **rejected records inside a 200**, logged to `sync_batches.rejections` and surfaced on the Sync Monitor page — never silently dropped, and never able to block the cursor forever.
