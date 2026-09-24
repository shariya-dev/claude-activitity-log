# H05 — Agent API: Pairing, Registration, Heartbeat, Settings, Device Lifecycle Actions
Status: done (f30c854) · Wave 3 · parallel with H06–H10 · Branch `handover/H05-agent-api`

## Objective
Implement every agent endpoint except `/sync`, plus the device-lifecycle actions the dashboard will call (issue pairing code, disable/enable, request manual sync, deregister).

## Read first
`docs/contracts/sync-api-v1.md` (normative), `docs/architecture/backend.md` §3–4, `data-model.md` (devices, pairing_codes, agent_sync_states, audit_logs), PRD §9, §11, §33, §35, §51–52.

## Depends on
H03 (contract + examples), H04 (models, middleware, TrackingSetting, AuditLog).

## Owned files
`agent-dashboard/routes/agent/device.php`, `app/Http/Controllers/Api/Agent/V1/{RegisterController,HeartbeatController,SettingsController,SyncStatusController,DeregisterController}.php`, `app/Http/Requests/Agent/{RegisterRequest,HeartbeatRequest}.php`, `app/Http/Resources/Agent/SettingsResource.php`, `app/Actions/Agent/**`, `tests/Feature/Agent/{Register,Heartbeat,Settings,SyncStatus,Deregister}Test.php`, `tests/Unit/Actions/Agent/**`.

## Allowed dependencies
None.

## Interfaces produced (used by H12, H13, H18)
```php
App\Actions\Agent\IssuePairingCode::handle(Developer $developer, User $by, PairingPurpose $purpose = PairingPurpose::Pair): string // plaintext "XXXX-XXXX" (Crockford base32, no 0/O/1/I), shown once; stores hash; audit pairing_code.issued (no code in metadata)
App\Actions\Agent\RegisterDevice::handle(string $code, array $deviceInfo): array{device: Device, token: string}
App\Actions\Agent\RecordHeartbeat::handle(Device $device, array $data, ?string $ip): array{server_time:string, settings_version:int, sync_requested:bool}
App\Actions\Agent\DisableDevice::handle(Device $device, User $by): void   // status disabled, revoke tokens, health disabled, audit device.disabled
App\Actions\Agent\EnableDevice::handle(Device $device, User $by): void    // status active (agent must re-pair: tokens were revoked), audit device.enabled
App\Actions\Agent\RequestManualSync::handle(Device $device, User $by): void // sets sync_requested_at, audit sync.requested
App\Actions\Agent\DeregisterDevice::handle(Device $device): void          // status uninstalled, revoke tokens, audit device.uninstalled (actor null)
```

## Behavior
- `POST register` (no auth, `throttle:10,1`): validate against `docs/contracts/schemas/register.request.json` rules (platform in `config('monitor.platforms')`). In one transaction: lock the code row, check it's unexpired, unused, and its developer is active. Find or create the device by `(developer_id, machine_fingerprint)`. Re-pair (existing row): revoke old tokens, `status=active`, clear `disabled_at`, audit `device.repaired`. New: `first_seen_at=now`, create `agent_sync_states` row. Mark the code used. `$device->createToken('agent', ['agent'])`. Respond 201 per contract (`settings` = `TrackingSetting::current()->toAgentPayload()` with `initial_sync.since` computed from the range). Any failure ⇒ 422 `invalid_pairing_code` (single generic message).
- Authenticated routes: `['auth:sanctum', 'device.active', 'settings.version']`. `/deregister` must still work for disabled devices, so it skips `device.active`.
- `POST heartbeat`: update `last_seen_at`, versions, `agent_state`, `last_local_activity_at`, `last_sync_at` hint (don't overwrite the server truth; store as reported), `hostname` only if Device category ON, `last_public_ip` only if Network ON, else null it. Return `sync_requested=true` once if `sync_requested_at` is set, then clear it.
- `GET settings`: `SettingsResource`.
- `GET sync/status`: from `agent_sync_states` + count of sessions.
- Agent outdated: if `agent_version` < `min_agent_version` (version_compare) on heartbeat/settings ⇒ 426 `agent_outdated`.
- All error bodies use the contract envelope. Add a small `App\Http\Responses\AgentError::make(code, message, status)` inside `app/Actions/Agent/Support/` (owned) for this.

## Tests (Pest, using `docs/contracts/examples/*.json` files)
Register: valid code ⇒ 201 + token works on `/settings`; expired/used/unknown/inactive-developer ⇒ 422 with identical bodies; same fingerprint twice ⇒ same `device_uid`, old token 401, audit `device.repaired`; different fingerprint ⇒ new device, same developer (PRD §10); **same fingerprint with a changed IP/hostname ⇒ still one device** (PRD §26 / AC13); throttle ⇒ 429.
Heartbeat: updates last_seen; network OFF ⇒ `last_public_ip` null; ON ⇒ stored; `sync_requested` returned once; disabled device ⇒ 403 `device_disabled`; outdated ⇒ 426.
Settings: payload equals the contract example shape and defaults; the version header is present.
Deregister: status uninstalled, tokens revoked, sessions untouched (AC39).
IssuePairingCode: format, hash stored, plaintext absent from DB and audit.

## Validation
`php artisan test --filter=Agent && vendor/bin/pint --test && vendor/bin/phpstan analyse && php artisan route:list --path=api/agent`.

## Acceptance criteria
PRD §9 backend steps all satisfied · device-level credentials, revocable · disabled devices can't call authenticated endpoints · network never affects identity.

## Review checklist
Tokens/codes never logged or audited · transaction + row lock on code redemption · no `/sync` logic here · contract examples used, not ad-hoc JSON.

## Commit
`feat(H05): agent pairing, registration, heartbeat, settings and device lifecycle actions`
