# Sync API v1: agent ↔ backend contract

Status: **normative, frozen for v1** (H03). This spec replaces the draft `docs/architecture/sync-protocol.md`.
Keywords MUST, MUST NOT, SHOULD and MAY follow RFC 2119.

The contract has four parts, and they MUST agree:

| Artifact | Location | Role |
|---|---|---|
| This spec | `docs/contracts/sync-api-v1.md` | Normative semantics: behaviour, limits, gating, cursor, idempotency, errors |
| zod module | `6am-agent/src/core/contract/` (`schemas.ts`, `errors.ts`, `scan.ts`, `index.ts`) | Source of truth for payload **shapes** |
| JSON Schemas | [`schemas/`](schemas/) | **Generated** from zod. Do not hand-edit them. |
| Examples | [`examples/`](examples/) | Canonical payloads. Backend tests (H05/H06) and agent tests (H10) load them by path. |

Regenerate the JSON Schemas after any zod change:

```sh
cd 6am-agent && UPDATE_CONTRACT_SCHEMAS=1 npx vitest run test/unit/contract
```

Without the env var, the same test fails when a committed schema differs from zod. Each schema uses `$id` `https://monitor.6amtech.com/contracts/sync-api-v1/<name>.json` (draft 2020-12, `io: 'input'`).

Schema files are `register.request`, `register.response`, `settings.response`, `heartbeat.request`, `heartbeat.response`, `sync.request`, `sync.response`, `sync-status.response` and `error` (all `.json`).

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | `https://<host>/api/agent/v1`. The host is baked into the agent build config (D4). A developer never enters it. |
| Transport | HTTPS only. Plain `http://` is allowed only for `127.0.0.1` / `localhost` in local development. |
| Encoding | JSON, UTF-8. `Content-Type: application/json`. The agent MUST replace lone UTF-16 surrogates with U+FFFD in **every** string it sends, so every body is valid UTF-8. |
| Compression | Request bodies MAY be gzip with `Content-Encoding: gzip`. The agent MUST gzip bodies over 64 KB. Size limits apply to the **decompressed** body. |
| Timestamps | ISO-8601 UTC ending in `Z`. Fractional seconds are optional. Offsets (`+06:00`) are **invalid**. Example: `2026-09-22T06:50:32.929Z`. |
| Null vs absent | **Every field is required.** Missing data is sent as explicit `null`. An absent field is a contract violation. The one exception is `error.errors`, which is present only for `invalid_payload`. |
| Integers | Token counts are non-negative JSON integers ≤ 2^53−1. |
| Hash keys | `machine_fingerprint`, `account_key` and `project_key` are lowercase sha256 hex: `^[0-9a-f]{64}$`. |
| IDs | `device_id` = `dev_` + ULID: `^dev_[0-9A-HJKMNP-TV-Z]{26}$`. `batch_id` = UUID v4. |
| Auth | `Authorization: Bearer <device token>`. The token is a Sanctum personal access token on the Device model (D2), issued by `/register`. Only `/register` is unauthenticated. |

### Headers

| Header | Direction | Required | Value / notes |
|---|---|---|---|
| `Authorization` | request | every endpoint except `/register` | `Bearer <device token>` |
| `Accept` | request | all | `application/json` |
| `Content-Type` | request | bodies | `application/json` |
| `Content-Encoding` | request | gzip bodies | `gzip` |
| `X-Agent-Version` | request | **all, including `/register`** | Agent semver. The outdated check uses it on `GET` endpoints, and on `/sync` when the body does not parse (§9.2). If it is missing, the backend falls back to `devices.agent_version`. A missing header is never a `422`. |
| `User-Agent` | request | all | `6am-agent/<version> (<platform>; <arch>)`, for example `6am-agent/1.0.0 (linux; x64)` |
| `X-Settings-Version` | response | every authenticated response, **including errors returned after authentication** | **Always** the current `tracking_settings.version`, including on replayed `/sync` responses. The agent uses `max(header, body settings_version)`. If that is higher than its own version, it MUST refetch `GET /settings`. |
| `X-Server-Time` | response | every authenticated response, including errors returned after authentication | ISO-8601 `Z`. Used for clock-skew diagnostics only. |
| `Retry-After` | response | `429` | Delay in seconds |

---

## 2. Versioning policy

| Rule | Detail |
|---|---|
| Changes within v1 | **Additive only.** A field added later in v1 MUST be optional for receivers, meaning receivers tolerate its absence. |
| Unknown fields | Both sides MUST ignore them. zod `z.object` strips them, and the JSON Schemas do not set `additionalProperties:false`. |
| Enums | **Closed** in v1: `platform`, `agent_state`, categories, `initial_sync.range`, `role`, `rejected_records[].type` and `error.code`. |
| Open enum | `rejected_records[].reason` is an open string. Agents MUST accept unknown reasons and treat them like any other rejection. |
| What forces v2 | A new error code, a new value in a closed enum, or a removed, renamed or retyped field. v2 is served at `/api/agent/v2`, and v1 stays available until all agents pass `min_agent_version`. |

### Intentional deviations from the PRD's conceptual payload (§36)

- **No `developers: []` key.** Developer identity comes **only** from the device token, which is bound to `devices.developer_id` at pairing. The agent never asserts who the developer is.
- **No derived token numbers from the agent.** Agents MUST NOT send `actual_consumed_tokens`, `total_token_activity` or any other derived token value. They send only the four raw integers: `input_tokens`, `output_tokens`, `cache_creation_tokens` and `cache_read_tokens`. `App\Support\TokenMath` on the backend is the only calculator (actual = input + output + cache_creation; total = actual + cache_read). None of these numbers are billing, cost or quota.
- The PRD's `/sync/status` is `POST`. In v1 it is `GET /sync/status`, a read-only lookup. The PRD says route names may change as long as the responsibilities stay.

---

## 3. Endpoints

### Summary

| Method & path | Auth | Throttle | Success | Can return `426`? |
|---|---|---|---|---|
| `POST /register` | none (pairing code) | 10/min/IP | `201` | never |
| `GET /settings` | device token | 60/min/device | `200` | yes |
| `POST /heartbeat` | device token | 60/min/device | `200` | yes, after persisting status (§3.3) |
| `POST /sync` | device token | 60/min/device | `200` | yes |
| `GET /sync/status` | device token | 60/min/device | `200` | no |
| `POST /deregister` | device token | 60/min/device | `204` | never |

**Order of checks on authenticated endpoints.** When several checks fail, the backend returns the first failure in this order:

1. `401 unauthenticated`
2. `429 rate_limited`
3. `403 device_disabled` / `device_uninstalled`
4. `413 batch_too_large`: decompressed body larger than 2 MB (`/sync`)
5. `426 agent_outdated`. The version compared differs by endpoint:
   - `/settings`: the `X-Agent-Version` header.
   - `/sync`: body `agent.agent_version` when the body parses as JSON, otherwise the header.
   - `/heartbeat`: body `agent_version`, and **only when the body is valid**. An invalid heartbeat body returns `422` instead.
   - If the chosen value is missing, the backend uses `devices.agent_version`.
6. `413 batch_too_large` (array limits) and `422 invalid_payload` (envelope, §6.1)
7. `409 batch_in_progress`

A `403` never applies to `/deregister`.

### 3.1 `POST /register`: pair a device (PRD §9, §12, §35)

Request ([example](examples/register.request.json), schema `register.request`):

| Field | Type | Null | Constraints |
|---|---|---|---|
| `pairing_code` | string | no | 1..32 chars. The backend normalizes it: uppercase, then strip spaces and hyphens. |
| `device.hostname` | string | yes | 1..191 |
| `device.platform` | enum | no | `macos` \| `windows` \| `linux` |
| `device.platform_version` | string | yes | 1..64 |
| `device.architecture` | string | no | 1..64, for example `arm64`, `x64` |
| `device.machine_fingerprint` | string | no | sha256 hex (64) |
| `device.agent_version` | string | no | semver `^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`, ≤32 chars |
| `device.claude_code_version` | string | yes | 1..64 |

`201` response ([example](examples/register.response.json), schema `register.response`):

| Field | Type | Notes |
|---|---|---|
| `device_id` | string | `dev_` + ULID. Public device identity. |
| `token` | string | Plaintext device token, **returned exactly once**. The agent MUST store it in OS secure storage. |
| `developer.name` | string | Shown on the agent's pairing success page |
| `developer.email` | string | Same as above |
| `settings` | TrackingSettings | Same shape as `GET /settings` (§3.2) |

Illustrative request:

```json
{ "pairing_code": "K7Q2-M9XD",
  "device": { "hostname": "dev-laptop", "platform": "linux", "platform_version": "6.8.0", "architecture": "x64",
              "machine_fingerprint": "<64 hex>", "agent_version": "1.0.0", "claude_code_version": "2.1.274" } }
```

Backend behaviour:

- **Code is valid** when it is unexpired, unused, and its developer is `active`. Any problem with the code returns `422 invalid_pairing_code` with **one generic message**: unknown, expired, used, inactive developer or malformed. The response never says which condition failed. `invalid_pairing_code` is used **only** for problems with `pairing_code`. A problem with any other field (for example `device.platform`) returns `422 invalid_payload`, even when the code is also bad.
- **Re-pair.** If the same `(developer_id, machine_fingerprint)` pair already exists, the backend reuses that **same device row**. It revokes all old tokens, issues a new one, sets `status=active` and writes audit `device.repaired`. `first_seen_at` is kept, so `initial_sync.since` does not change.
- **Hostname.** The agent always sends `hostname`, because it has no settings yet. A hostname received at register is **not stored** when Device is OFF. If Device is turned OFF later, the hostname already stored is **kept** as history.
- The pairing code is marked used (`used_at`, `used_by_device_id`) in the same transaction.
- Never returns `426`, so an outdated agent can still pair and then learns it must update.

### 3.2 `GET /settings`: tracking configuration (PRD §23, §31)

No body. `200` response ([example, defaults](examples/settings.response.json), schema `settings.response`). The same `TrackingSettings` object appears in `register.response.settings`.

| Field | Type | Null | Constraints / default |
|---|---|---|---|
| `version` | int | no | ≥1, default `1`. Incremented on every admin change. |
| `categories.session` | bool | no | default `true` |
| `categories.usage` | bool | no | default `true` |
| `categories.project` | bool | no | default `true` |
| `categories.model` | bool | no | default `true` |
| `categories.device` | bool | no | default `true` |
| `categories.account` | bool | no | default `true` |
| `categories.prompt` | bool | no | default **`false`** |
| `categories.git` | bool | no | default **`false`** |
| `categories.network` | bool | no | default **`false`** |
| `initial_sync.range` | enum | no | `1d` \| `7d` \| `30d` \| `all`, default `7d` |
| `initial_sync.since` | datetime | yes | `devices.first_seen_at − N days`, exact and not truncated to midnight. The backend sends `null` **if and only if** range is `all`. When range is `all`, the agent ignores `since`. |
| `sync_interval_seconds` | int | no | ≥60, default `120` |
| `heartbeat_interval_seconds` | int | no | ≥60, default `300` |
| `min_agent_version` | semver | no | default `1.0.0` |

```json
{ "version": 1, "categories": { "session": true, "usage": true, "project": true, "model": true, "device": true,
  "account": true, "prompt": false, "git": false, "network": false },
  "initial_sync": { "range": "7d", "since": "2026-09-15T08:12:00Z" },
  "sync_interval_seconds": 120, "heartbeat_interval_seconds": 300, "min_agent_version": "1.0.0" }
```

`since` is stable per device because re-pairing reuses the row. A reinstall therefore re-scans from the same point, and the upserts make that idempotent. Developers cannot override settings locally (PRD §23).

### 3.3 `POST /heartbeat`: liveness and status (PRD §33)

Request ([example](examples/heartbeat.request.json), schema `heartbeat.request`):

| Field | Type | Null | Constraints |
|---|---|---|---|
| `agent_version` | semver | no | ≤32 |
| `claude_code_version` | string | yes | 1..64 |
| `platform_version` | string | yes | 1..64 |
| `hostname` | string | yes | 1..191. The agent MUST send `null` when Device is OFF. |
| `agent_state` | enum | no | `ok` \| `syncing` \| `backoff` \| `claude_data_unavailable` \| `update_required` \| `needs_repair` \| `device_disabled` \| `error`. `needs_repair` and `device_disabled` are local/diagnostic states: they never reach the backend, because `401`/`403` responses write nothing. |
| `last_local_activity_at` | datetime | yes | Newest Claude activity the agent has seen locally |
| `last_successful_sync_at` | datetime | yes | Time of the last `200 success:true` sync |
| `last_error` | string | yes | 1..500. A short code or message. MUST NOT contain tokens, prompt text or emails. |

`200` response ([example](examples/heartbeat.response.json), schema `heartbeat.response`):

| Field | Type | Notes |
|---|---|---|
| `server_time` | datetime | |
| `settings_version` | int | If it is higher than the agent's version, the agent refetches `/settings` |
| `sync_requested` | bool | `true` **once** after an admin clicks "Sync Now". The backend then clears `sync_requested_at`. The agent syncs right away. |

```json
{ "agent_version": "1.0.0", "claude_code_version": "2.1.274", "platform_version": "6.8.0", "hostname": "dev-laptop",
  "agent_state": "ok", "last_local_activity_at": "2026-09-22T06:50:32.929Z",
  "last_successful_sync_at": "2026-09-22T06:52:10Z", "last_error": null }
```

Backend behaviour:

What the backend persists from a heartbeat:

| Field | Persisted to |
|---|---|
| (request time) | `devices.last_seen_at` |
| `agent_version`, `claude_code_version`, `platform_version`, `agent_state` | Matching `devices` columns |
| `last_local_activity_at` | `devices.last_local_activity_at` |
| `last_successful_sync_at` | Not persisted. Diagnostic only. It **never** overwrites `devices.last_sync_at`, which is server truth set by `/sync`. |
| `last_error` | Not persisted in V1: there is no column for it. Follow-up item. |
| `hostname` | `devices.hostname`, only when Device is ON. When Device is OFF, the sent value is ignored and the stored hostname is kept. |
- **Network.** The agent never collects network data. When Network is ON, the backend writes the request IP to `last_public_ip`. When Network is OFF, it sets `last_public_ip` to `null`. The IP is never used for identity (PRD §26, D14).
- **Outdated agent.** If the body is valid and `agent_version` is lower than `min_agent_version`, the backend first persists `last_seen_at`, the versions and `agent_state`, then returns `426 agent_outdated`. The dashboard then shows the device as **Outdated**, not Offline. An invalid body returns `422 invalid_payload` and persists nothing.
- **Disabled or uninstalled device.** The backend returns `403` and writes nothing. The agent keeps probing hourly.

### 3.4 `POST /sync`: upload activity (PRD §29, §32, §36–39)

Top-level request ([schema](schemas/sync.request.json) `sync.request`):

| Field | Type | Null | Constraints |
|---|---|---|---|
| `agent.device_id` | string | no | Must equal the token's device, otherwise `422 invalid_payload` |
| `agent.platform` | enum | no | `macos` \| `windows` \| `linux` |
| `agent.platform_version` | string | yes | 1..64 |
| `agent.architecture` | string | no | 1..64 |
| `agent.agent_version` | semver | no | ≤32 |
| `agent.claude_code_version` | string | yes | 1..64 |
| `sync.batch_id` | uuid v4 | no | Idempotency key (§8) |
| `sync.cursor` | string | yes | ≤255. The last server cursor the agent received, or `null`. |
| `sync.is_initial` | bool | no | `true` while the initial-history scan is running |
| `sync.settings_version` | int | no | ≥1. The settings version the agent scanned with. |
| `sync.sequence` | int | no | ≥1. Agent-local counter, incremented per **new** batch. Retries reuse the same value. Informational only. The backend copies the last acknowledged value into `agent_sync_states.sequence`. There is no separate server counter. |
| `accounts` | AccountRecord[] | no | max **50** |
| `projects` | ProjectRecord[] | no | max **200** |
| `sessions` | SessionRecord[] | no | max **200** |
| `usage` | UsageRecord[] | no | max **500** |
| `messages` | MessageRecord[] | no | max **200** |

All five arrays MUST be present. An empty array is `[]`. The record tables are in §4.

Examples:

| Case | Request | Response |
|---|---|---|
| All categories ON, including prompt and git | [sync.request.full.json](examples/sync.request.full.json) | [sync.response.full.json](examples/sync.response.full.json) |
| Session + Usage only | [sync.request.minimal.json](examples/sync.request.minimal.json) | [sync.response.minimal.json](examples/sync.response.minimal.json) |
| Prompt and Git OFF | [sync.request.prompt-off.json](examples/sync.request.prompt-off.json) | [sync.response.prompt-off.json](examples/sync.response.prompt-off.json) |
| Initial sync | [sync.request.initial.json](examples/sync.request.initial.json) | [sync.response.initial.json](examples/sync.response.initial.json) |
| Per-record rejections | n/a | [sync.response.with-rejections.json](examples/sync.response.with-rejections.json) |

```json
{ "agent": { "device_id": "dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W", "platform": "linux", "platform_version": "6.8.0",
             "architecture": "x64", "agent_version": "1.0.0", "claude_code_version": "2.1.274" },
  "sync": { "batch_id": "8f14e45f-ceea-467a-9b36-4f2a1c0d9e21", "cursor": null, "is_initial": false,
            "settings_version": 1, "sequence": 42 },
  "accounts": [], "projects": [], "messages": [],
  "sessions": [ { "source_session_id": "3cd42766-...", "project_key": null, "account_key": null, "...": "..." } ],
  "usage": [ { "source_message_id": "msg_011Cf...", "source_session_id": "3cd42766-...", "input_tokens": 2,
               "output_tokens": 866, "cache_creation_tokens": 48433, "cache_read_tokens": 19929, "...": "..." } ] }
```

`200` response ([schema](schemas/sync.response.json) `sync.response`):

| Field | Type | Notes |
|---|---|---|
| `success` | `true` | Literal |
| `batch_id` | uuid | Echo of `sync.batch_id` |
| `sync.accepted` | int ≥0 | Equals `created + updated` |
| `sync.created` | int ≥0 | Rows newly inserted |
| `sync.updated` | int ≥0 | Matched an existing row. This **includes unchanged matches**. |
| `sync.rejected` | int ≥0 | True number of rejected records |
| `rejected_records[]` | array | At most **100** entries are listed. `sync.rejected` is the authoritative count. |
| `rejected_records[].type` | enum | `account` \| `project` \| `session` \| `usage` \| `message` |
| `rejected_records[].source_id` | string | The record's id (§4.6) |
| `rejected_records[].reason` | string | **Open** set (§6.3) |
| `cursor` | string | ≤255, opaque (§7.3) |
| `settings_version` | int | **Current** settings version |
| `server_time` | datetime | |

```json
{ "success": true, "batch_id": "8f14e45f-ceea-467a-9b36-4f2a1c0d9e21",
  "sync": { "accepted": 2, "created": 2, "updated": 0, "rejected": 0 }, "rejected_records": [],
  "cursor": "eyJzZXF1ZW5jZSI6NDIsImJhdGNoX2lkIjoiOGYxNGU0NWYtY2VlYS00NjdhLTliMzYtNGYyYTFjMGQ5ZTIxIiwiYWNrZWRfYXQiOiIyMDI2LTA5LTIyVDA2OjUyOjEwWiJ9",
  "settings_version": 1, "server_time": "2026-09-22T06:52:10Z" }
```

Counting rule: **`accepted + rejected` = total records in the request**, summed over all five arrays.

Backend behaviour:

- **Synchronous processing.** The batch is processed inside the HTTP request, in **one DB transaction** (D8). No queues are used: `QUEUE_CONNECTION=sync`.
- **Batch lifecycle.** The backend first commits a `processing` row in `sync_batches`, keyed by `(device_id, batch_uuid)`, in its **own short transaction** before the data transaction starts. This is what makes `409` and stale reprocessing (§8.2) reachable. At the end the row becomes `succeeded` and stores the full response (for replay, §8), or becomes `failed` and stores `error_code`.
- **Checks.** Run envelope validation (§6.1). Apply category gating (§5) against the **current** settings, even when `sync.settings_version` is older.
- **Record handling.** Validate each record (§6.2). Resolve references (§4.6). Upsert (§8).
- **Recompute in the same transaction:**
  - touched sessions' token totals, `activity_count` and `duration_seconds`
  - `session_usage` dimensions, if a session's project or account changed
  - `usage_daily_rollups` for each touched `(device_id, recorded_on)`
- **All token math goes through `TokenMath`.**
- **Device fields.** Updates `devices.last_sync_at`, the versions and `platform_version` from `agent`.
- **Sync state.** Updates `agent_sync_states`: `cursor`, `sequence` (copied from `sync.sequence`), `last_batch_uuid`, `last_success_at` and counters. The server cursor is `base64url(JSON {sequence, batch_id, acked_at})`.
- **Failure.** If persistence fails, the transaction rolls back, the backend returns `500 persistence_failed` and nothing is partially committed (PRD §39).

### 3.5 `GET /sync/status`: server-side sync state (PRD §34)

No body. `200` response ([example](examples/sync-status.response.json), schema `sync-status.response`):

| Field | Type | Null | Notes |
|---|---|---|---|
| `last_batch_id` | uuid | yes | Last succeeded batch |
| `cursor` | string | yes | ≤255. Last issued server cursor. |
| `sequence` | int ≥0 | no | The last acknowledged `sync.sequence`. `0` if the device has never synced. |
| `last_success_at` | datetime | yes | |
| `sessions_known` | int ≥0 | no | Number of `claude_sessions` rows for this device |

**Use.** After the agent loses local state (reinstall, or `state.db` lost), it decides from this response whether it is resuming or starting fresh, and continues `sequence` from `sequence + 1`. Re-sending data is always safe because of the upserts. The response is **informational**: the agent's real cursor is always its local checkpoints (§7).

### 3.6 `POST /deregister`: uninstall (PRD §11)

No body. `204 No Content`, with an empty body.

- Called best-effort by uninstallers.
- Works for `disabled` devices too.
- Sets `status=uninstalled` and `uninstalled_at`, revokes all tokens, and **keeps all history** (`restrictOnDelete`).
- Idempotent. Because the token is revoked, a repeat call returns `401`. The agent/uninstaller MUST treat a `401` from `/deregister` as already done.
- Never returns `403` or `426`.

---

## 4. Record types (inside `POST /sync`)

The agent always sends **valid** records. zod and the JSON Schemas describe a fully valid payload. §6 covers what the backend does with invalid ones.

### 4.1 AccountRecord: `claude_accounts` (PRD §15)

| Field | Type | Null | Constraints / derivation |
|---|---|---|---|
| `account_key` | sha256 hex | no | `sha256(accountUuid)`. If there is no uuid: `sha256(lowercase(email))`. |
| `account_uuid` | string | yes | 1..64 |
| `email` | string | yes | 1..191. Plain string, no strict email format check. |
| `display_name` | string | yes | 1..191 |
| `organization_uuid` | string | yes | 1..64 |
| `organization_name` | string | yes | 1..191 |
| `observed_at` | datetime | no | The newest `last_seen_at` among the chunk's sessions (derived from the data, never the clock, so a retry is byte-identical, §8.2). An account is sent only with sessions. |

The agent sends an empty string as `null`: every string field has a minimum length of 1.

Unique key: `(developer_id, account_key)`, with `developer_id` taken from the token.

### 4.2 ProjectRecord: `projects` + `project_locations` (PRD §17)

| Field | Type | Null | Constraints / derivation |
|---|---|---|---|
| `project_key` | sha256 hex | no | See D13, next table |
| `name` | string | no | 1..191. The last path segment of the normalized remote when `project_key` is derived from the remote. Otherwise the directory basename. |
| `path` | string | no | 1..4096. Absolute cwd on this device. |
| `git_remote` | string | yes | 1..255. Normalized remote. `null` unless Git is ON and a remote exists. |
| `first_seen_at` | datetime | no | |
| `last_seen_at` | datetime | no | |

`project_key` derivation (D13):

| Condition | `project_key` |
|---|---|
| Git ON **and** the repo has a remote | `sha256(normalized_remote)` |
| Otherwise | `sha256(device_id + "\n" + absolute_cwd)`, for example `sha256("dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W\n/home/dev/work/acme-api")` = `d653e136…fe95c` |

`normalized_remote` is agent-side and the backend treats the key as opaque. The agent builds it as follows:

- Take the `origin` URL from `.git/config`.
- Remove the scheme, any userinfo (`user[:password]@`), any port, a trailing `/` and a trailing `.git`. For example, `ssh://git@host:22/org/repo` becomes `host/org/repo`.
- Rewrite scp-style `git@host:org/repo` as `host/org/repo`.
- Lowercase the host.

Example: `github.com/example/acme-api`. The same string is sent as `git_remote`, so **credentials are never sent**. When Git is OFF, the agent MUST NOT read `.git/*`, and the key MUST NOT be derived from a remote.

**Toggling Git splits project history.** Switching the Git category changes a directory's `project_key` (remote-derived vs device+cwd). History for that directory is then spread across two projects. V1 does not merge them.

### 4.3 SessionRecord: `claude_sessions` (PRD §16)

| Field | Type | Null | Constraints / derivation |
|---|---|---|---|
| `source_session_id` | string | no | 1..64. Claude's `sessionId`. |
| `project_key` | sha256 hex | yes | `null` when Project is OFF |
| `account_key` | sha256 hex | yes | `null` when Account is OFF or unknown |
| `first_seen_at` | datetime | no | Earliest line timestamp the agent has seen |
| `last_seen_at` | datetime | no | Latest line timestamp |
| `ended_at` | datetime | yes | Only when the source data establishes it |
| `claude_code_version` | string | yes | 1..64 |
| `entrypoint` | string | yes | 1..64, for example `cli`, `sdk-cli` |
| `git_branch` | string | yes | 1..191. `null` when Git is OFF. |
| `model` | string | yes | 1..128. Most recent model. `null` when Model is OFF. |

Unique key: `(device_id, source_session_id)`.

### 4.4 UsageRecord: `session_usage`, one row per Claude API message (PRD §19–21, §42, D5)

| Field | Type | Null | Constraints / derivation |
|---|---|---|---|
| `source_message_id` | string | no | 1..64. **Claude `message.id`** (`msg_…`), which is the dedup key. Documented fallbacks: `requestId` if `message.id` is absent, then the line `uuid`. When streaming splits one message across several JSONL lines, the agent merges them into one record by **per-field max**. |
| `source_session_id` | string | no | 1..64 |
| `request_id` | string | yes | 1..64 |
| `model` | string | yes | 1..128. `null` when Model is OFF. |
| `is_sidechain` | bool | no | |
| `recorded_at` | datetime | no | Line timestamp |
| `input_tokens` | int ≥0 | no | raw |
| `output_tokens` | int ≥0 | no | raw |
| `cache_creation_tokens` | int ≥0 | no | raw |
| `cache_read_tokens` | int ≥0 | no | raw |

No other token fields are allowed (§2). Unique key: `(claude_session_id, source_message_id)`.

### 4.5 MessageRecord: `session_messages`, sent only when Prompt is ON (PRD §24)

| Field | Type | Null | Constraints |
|---|---|---|---|
| `source_message_id` | string | no | 1..64. The JSONL **line `uuid`**. |
| `source_session_id` | string | no | 1..64 |
| `role` | enum | no | `user` only, in v1 |
| `content` | string | no | 1..100000 UTF-16 code units. The agent truncates longer prompts to 100000, **on a code-point boundary**, so a surrogate pair is never split. Lone surrogates become U+FFFD (§1). |
| `recorded_at` | datetime | no | |

Unique key: `(claude_session_id, source_message_id)`. Content is stored with an encrypted cast.

### 4.6 Referential rule and `source_id`

- **Agent (MUST).** Every batch that contains a usage or message record also contains that record's session. Every batch that contains a session also contains the project and account records the session references.
- **Backend (tolerant).**
  - A reference that is missing from the batch is resolved from the DB: the session by `(device_id, source_session_id)`, the project by `project_key`, the account by `(developer_id, account_key)`.
  - If it cannot be resolved, the record is rejected with `unknown_session`, `unknown_project` or `unknown_account`.
  - A record that depends on a **rejected** record (for example usage whose session was rejected) is rejected with `unknown_session`.
- **`source_id` in `rejected_records`:**

  | Record type | `source_id` |
  |---|---|
  | account | `account_key` |
  | project | `project_key` |
  | session | `source_session_id` |
  | usage | `source_message_id` |
  | message | `source_message_id` |

  If that field is missing or not a string, the backend uses `#<zero-based index in its array>`, for example `#3`.

---

## 5. Category gating (PRD §23–26)

The agent **omits** disabled data. The backend **strips or rejects** it as defense in depth. Whole-record categories are rejected with reason `category_disabled` and counted in `rejected`. Field-level categories are nulled silently, and the record is still accepted.

| Category OFF | Agent MUST | Backend MUST |
|---|---|---|
| `session` | Send **no `/sync` at all**. Heartbeat only. | Reject every session, usage and message record with `category_disabled`. |
| `usage` | Send `usage: []` | Reject usage records with `category_disabled` |
| `project` | Send `projects: []` and `project_key: null` | Reject project records with `category_disabled`. Null `sessions[].project_key` before resolving references. |
| `model` | Send `usage[].model` and `sessions[].model` as `null` | Null both fields |
| `account` | Send `accounts: []` and `sessions[].account_key: null`. Do not read `oauthAccount`. | Reject account records with `category_disabled`. Null `sessions[].account_key`. |
| `git` | Send `git_branch` and `git_remote` as `null`. Do not read `.git/*`. Never derive `project_key` from a remote. | Null `git_branch` and `git_remote` |
| `prompt` | Send `messages: []`. **Read no prompt text** into memory or payloads. | Reject message records with `category_disabled`. Never store or log `content`. |
| `device` | Send `hostname: null` in heartbeat. `/register` still sends `hostname`, because settings are not known yet. `platform`, `platform_version`, `architecture` and versions are operational data and are **always sent**. | Do not store a hostname received at register. Ignore hostname on heartbeat. Keep any hostname already stored as history. |
| `network` | Never collect network data, whatever the setting. | Store the request IP in `last_public_ip` only when ON. Otherwise set it to `null`. Never use it for identity. |

Rules:

- **Settings apply at scan time.** Data scanned while a category was OFF is **not backfilled** when the category is turned ON, because the checkpoints have already passed it.
- **Backend uses current settings.** It gates by the **current** settings even when `sync.settings_version` is stale, and returns the new `settings_version` in the response and the header. The agent then refetches.

---

## 6. Limits, validation and rejections

### 6.1 Envelope-level problems: the whole request fails

| Condition | Response |
|---|---|
| Decompressed body > **2 MB** (2 × 1024 × 1024 bytes) | `413 batch_too_large` |
| Array over its limit: accounts 50, projects 200, sessions 200, usage 500, messages 200 | `413 batch_too_large` |
| Body not valid JSON, `agent`/`sync` block missing or ill-typed, an array field missing or not an array, an array element not an object | `422 invalid_payload` with `errors` |
| `agent.device_id` differs from the token's device | `422 invalid_payload` |

The constants live in zod `SYNC_LIMITS = {accounts:50, projects:200, sessions:200, usage:500, messages:200, maxBodyBytes:2097152}`. The agent MUST keep every chunk below them, using `ScanOptions` `maxUsagePerChunk`, `maxSessionsPerChunk`, `maxMessagesPerChunk` and `maxBytesPerChunk`, with the serialized body ≤ 2 MB. A single record is always far below 2 MB: `content` ≤ 100000 UTF-16 units is at most about 600 KB of JSON.

**Validation boundary (normative).**
- The backend's request validation (FormRequest) checks **only** the envelope conditions listed in this table.
- It does not validate record internals with `422`. Record-level problems are handled per record, as described in §6.2.
- The JSON Schemas and zod describe what a **correct agent sends** (agent-strict). They MUST NOT be used as the backend's `422` validator for records.

### 6.2 Record-level problems: that record is rejected inside a `200`

Only the bad record is rejected. The rest of the batch is persisted, and the agent's checkpoints advance. **One bad record can never block the cursor.** Every rejection is stored in `sync_batches.rejections` (capped at 100) and shown on the Sync Monitor. Nothing is dropped silently.

### 6.3 Rejection reasons

This set is open: agents MUST accept reasons not listed here.

| Reason | When |
|---|---|
| `negative_token_value` | Any of the 4 token fields is < 0 |
| `invalid_value` | Any other field problem: wrong type, bad key format, bad length, bad `role`, non-integer token, or `first_seen_at > last_seen_at` on a session or project |
| `invalid_timestamp` | A timestamp is not ISO-8601 UTC with `Z` (offsets and garbage included), or is earlier than `1970-01-01T00:00:01Z` (the MySQL `TIMESTAMP` range) |
| `future_timestamp` | A record timestamp is more than server now + 1 day |
| `unknown_session` | The session cannot be resolved, or it was rejected in this batch |
| `unknown_project` | `project_key` cannot be resolved |
| `unknown_account` | `account_key` cannot be resolved |
| `category_disabled` | The record's category is OFF (§5) |

The backend MUST catch every value that the database would refuse (range, length, type) at this stage. A record MUST NEVER reach a DB error: that would produce a `500` that repeats on every retry and blocks the device forever.

Each record gets one reason: the first check that fails, in the order of this table. `category_disabled` is checked before everything else.

Invalid examples are in [`examples/invalid/`](examples/invalid/). Each file wraps its payload with `description`, `schema` and `expect.zod_path`, plus the `expect.backend` outcome:

| File | Expected |
|---|---|
| `negative-token` | `200`, rejection `negative_token_value` |
| `missing-batch-id` | `422 invalid_payload` |
| `bad-timestamp` | `200`, rejection `invalid_timestamp` |
| `unknown-platform` | `422` |
| `register-unknown-platform` | `422 invalid_payload` |
| `oversize-sessions` | `413` |
| `oversize-usage` | `413` |

---

## 7. Cursor semantics (PRD §27–31)

### 7.1 Agent checkpoints are the real cursor

Each tracked file has a checkpoint in SQLite: `{path, file_identity, size, mtime_ms, offset}`, the `FileCheckpoint` type in `scan.ts`. `offset` is the byte just after the last complete `\n` included in an **acknowledged** batch. SQLite holds only this sync state and never a copy of history (PRD §28).

### 7.2 Commit rule

- **Pending advances.** Each batch carries the checkpoint advances it would produce (`ScanChunk.checkpoints`). They are held in memory only.
- **Commit on success.** The agent MUST commit those advances **only after HTTP `200` with `success: true`**. It commits them in **one SQLite transaction** and stores the server `cursor` in that same transaction.
- **Everything else changes nothing.** This includes any other status, a network error, and an unparseable or schema-invalid response. The records stay eligible for retry (PRD §30, §39, §55).
- **A failed chunk aborts the rest of the scan.** When a chunk is not acknowledged, the agent MUST abort the remaining chunks of that scan, because later checkpoints assume the earlier ones were committed. The next cycle re-scans from the committed checkpoints.
- **Unreadable file.** It is skipped this cycle and its checkpoint does not move.
- **Unparseable line.** It is skipped and counted in diagnostics.

### 7.3 Server cursor

- **Format.** `base64url(JSON {sequence, batch_id, acked_at})`, stored in `agent_sync_states.cursor`.
- **Opaque to the agent.** The agent echoes it back in `sync.cursor` and never parses it.
- **Informational only.** The backend MUST NOT reject a batch because of a stale, `null` or unknown cursor. Losing the cursor is harmless.

### 7.4 Initial sync (PRD §31)

- The agent uses `initial_sync.since` from settings.
  - Files with `mtime < since` are checkpointed at EOF **without sending**.
  - Lines with `timestamp < since` are skipped.
  - When `since` is `null` (range `all`), everything is sent.
- Batches send `is_initial: true` until the initial scan completes.
- The first batch has `cursor: null` and `sequence: 1` ([example](examples/sync.request.initial.json)).

### 7.5 Resets

If a file shrinks (`size < offset`) or its `file_identity` changes (rotated or replaced), its offset resets to `0`. The resulting re-send is absorbed by the idempotent upserts.

---

## 8. Idempotency and retries (PRD §38)

### 8.1 Backend unique keys and merge rules

| Record | Unique key | Merge rule |
|---|---|---|
| batch | `(device_id, batch_uuid)` | See §8.2 |
| account | `(developer_id, account_key)` | Nullable fields `COALESCE(new, old)`. `first_seen_at = LEAST`, `last_seen_at = GREATEST` (from `observed_at`). Also upserts `claude_account_device`. |
| project | `project_key` | `name`/`git_remote` take the latest non-null value. Also upserts `project_locations (project_id, device_id, path_hash)` with `path`. |
| session | `(device_id, source_session_id)` | `started_at = LEAST(first_seen_at)`, `last_activity_at = GREATEST(last_seen_at)`. Other fields take the latest non-null value. |
| usage | `(claude_session_id, source_message_id)` | Each raw token column is `GREATEST(old, new)`. `actual`/`total` are recomputed by `TokenMath`. |
| message | `(claude_session_id, source_message_id)` | Insert-ignore. Content is never overwritten. |

### 8.2 `batch_id` semantics

| Situation | Rule |
|---|---|
| Retry of the same chunk | The agent MUST reuse the **same `batch_id` and byte-for-byte identical records**. A `batch_id` never carries different content. |
| After `413` | The agent **discards** the chunk; nothing is committed. It re-scans from the **same** committed checkpoints with **halved** limits (`maxBytesPerChunk` and the record caps), and repeats until the batch succeeds or a chunk holds a single record. Each part comes from that re-scan and carries **its own** checkpoints, never the parent chunk's. Each part gets a **new** `batch_id`. |
| After an agent restart | Pending batch_ids are held in memory only, so the agent re-scans and uses new batch_ids. This is safe because of §8.1. |
| Backend: `(device, batch)` already `succeeded` | Return the **stored response body verbatim**, with the same counts and cursor. Its `settings_version` may be old. The `X-Settings-Version` header carries the current version (§1). No writes. |
| Backend: `processing` and less than 2 minutes old | `409 batch_in_progress` |
| Backend: `failed`, or `processing` for 2 minutes or more (stale) | Reprocess |

---

## 9. Errors

### 9.1 Envelope

Schema `error`. Examples are `examples/error.<code>.json`, one per code.

```json
{ "success": false, "error": { "code": "invalid_payload", "message": "The given data was invalid.", "retryable": false,
  "errors": { "sync.batch_id": ["The sync.batch_id field is required."] } } }
```

| Field | Type | Notes |
|---|---|---|
| `success` | `false` | |
| `error.code` | enum | Closed in v1 (§9.2) |
| `error.message` | string | Human-readable. MUST NOT contain tokens, prompt text or emails. |
| `error.retryable` | bool | Matches `RETRYABLE[code]` in `errors.ts` |
| `error.errors` | `Record<string, string[]>` | **Only** for `invalid_payload`. Keys are dotted paths. |

### 9.2 Codes

| HTTP | `code` | Retryable | Agent action | Example |
|---|---|---|---|---|
| 401 | `unauthenticated` | false | Stop sync **and** heartbeat. Set local state `needs_repair`. Show the pairing page. | [json](examples/error.unauthenticated.json) |
| 403 | `device_disabled` | false | Stop syncing. Heartbeat probe hourly. | [json](examples/error.device_disabled.json) |
| 403 | `device_uninstalled` | false | Stop syncing. Heartbeat probe hourly. | [json](examples/error.device_uninstalled.json) |
| 409 | `batch_in_progress` | true | Retry the **same** batch after backoff | [json](examples/error.batch_in_progress.json) |
| 413 | `batch_too_large` | true | Discard the chunk. Re-scan from the same checkpoints with halved limits. Send the parts with new batch_ids (§8.2). | [json](examples/error.batch_too_large.json) |
| 422 | `invalid_payload` | false | Log `contract_violation`, back off, **do not advance checkpoints** | [json](examples/error.invalid_payload.json) |
| 422 | `invalid_pairing_code` | false | Show the generic pairing error | [json](examples/error.invalid_pairing_code.json) |
| 426 | `agent_outdated` | false | State `update_required`. **Keep checkpoints.** | [json](examples/error.agent_outdated.json) |
| 429 | `rate_limited` | true | Wait `Retry-After` seconds | [json](examples/error.rate_limited.json) |
| 500 | `persistence_failed` | true | Back off and retry the same batch | [json](examples/error.persistence_failed.json) |

`426` by endpoint:

| Endpoint | Returns `426`? |
|---|---|
| `/heartbeat` | Yes, **after** persisting status. Only when the body is valid; otherwise `422`. |
| `/settings`, `/sync` | Yes. `/settings` uses the `X-Agent-Version` header. `/sync` uses body `agent.agent_version` when the body parses, otherwise the header. If the version is missing, the backend uses `devices.agent_version`. |
| `/sync/status` | No |
| `/register`, `/deregister` | Never |

### 9.3 Failures outside the envelope and backoff

- **Treated as retryable transport failures:** any response that is not a valid envelope, including proxy `502/503/504`, HTML bodies and truncated JSON, plus timeouts, DNS/TLS/connection errors and no connectivity.
- **Unknown `error.code`** under an otherwise valid envelope is handled the same way.
- **Backoff:** `30 s × 2^n`, capped at **15 min**, with **±20 % jitter**. `n` resets after a success. `429` uses `Retry-After` instead.
- **Throttles:** `/register` 10/min/IP. Authenticated endpoints 60/min/device.

---

## 10. Security and privacy

- **Never logged by either side:** device tokens, pairing codes, prompt `content` or emails. This covers agent logs, backend logs, `audit_logs.metadata`, `sync_batches.rejections` and `last_error`.
- **Token storage.** The device token is shown **once** (`register.response.token`). The agent stores it in OS secure storage. The backend stores only its hash (Sanctum). Re-pairing revokes the old tokens.
- **Frontend.** The Inertia/Vue frontend MUST NEVER expose agent credentials: no tokens, token hashes or pairing-code hashes in props or API responses. A pairing code is shown to the admin only once, when it is issued.
- **Prompt OFF means no prompt text anywhere.** It is not read into memory or payloads, not sent, and not stored. When Prompt is ON, content is encrypted at rest and every view is audited (`prompt.viewed`).
- **Network data** never identifies a developer or device.
- **Agent reads only:** Claude's data dir, `~/.claude.json` (`oauthAccount`, when Account is ON), and `.git/config` / `.git/HEAD` (only when Git is ON). It **never writes** to any of them.
- **HTTPS only**, except loopback in development.

---

## 11. PRD traceability

| PRD | Responsibility | Where in this contract |
|---|---|---|
| §9 | Identify developer, register device, unique identity, issue credentials, return config | `POST /register` (§3.1): `device_id`, `token`, `developer`, `settings` |
| §9 | Agent stores credentials securely, then does the initial sync | §10 token storage, §7.4 |
| §11 | Disable or uninstall never deletes history | `403 device_disabled`/`device_uninstalled`, `POST /deregister` (§3.6) |
| §12 | Every device reports its platform. The schema is platform-neutral. | `platform` enum + `platform_version`, `architecture` on register, heartbeat and `sync.agent` |
| §23 | Central settings, 9 categories, defaults, no local override | `GET /settings` (§3.2), gating (§5), `X-Settings-Version` |
| §24–26 | Prompt, Git and Network off by default and gated | §3.2 defaults, §5, §4.2 git_remote without credentials |
| §27 | Offline sync without queues. The cursor stays unchanged while offline. | §7.2, §9.3, synchronous processing in §3.4 |
| §28 | SQLite holds sync state only | §7.1 |
| §29 | Incremental. Stable source IDs. | Byte-offset checkpoints (§7.1), `source_message_id` = `message.id` (§4.4) |
| §30 | Cursor advances only after persistence | §7.2 (200 + `success:true`, one SQLite transaction) |
| §31 | Backend-controlled initial range (1d/7d/30d/all, default 7d) | `initial_sync` (§3.2), `sync.is_initial`, §7.4 |
| §32 | Flow: settings → scan → gate → payload → send → ack → advance | §3.2 → §5 → §3.4 → §7.2 |
| §33 | Heartbeat with versions, last activity, last sync, status. Online/stale/offline/outdated. | `POST /heartbeat` (§3.3). `426` still persists status. |
| §34 | Endpoints register, heartbeat, settings, sync, sync/status | §3 summary. `/sync/status` is `GET` (§2). |
| §35 | HTTPS, device-level credentials, secure storage, disabled devices can't sync, backend validates identity, frontend never exposes credentials | §1 Auth, §3.4 `device_id` match, `403`, §10 |
| §36 | Payload `agent` + `sync` + record arrays, only enabled records | §3.4, §4, §5. `developers` omitted and no derived tokens (§2). |
| §37 | Response `success`, `sync` counts, `cursor`, `server_time` | §3.4 response + `batch_id`, `rejected_records`, `settings_version` |
| §38 | Duplicate batches are safe. Stable IDs, unique constraints, upserts. | §8 |
| §39 | Explicit failure. No wrong cursor advance. No silent loss. | `500 persistence_failed` + rollback (§3.4), §6.2 rejections are recorded, §7.2 |
| §55 | No internet, backend down, auth failure, invalid response, partial failure, simple backoff, position never lost | §9.2 agent actions, §9.3, §7.2 |
