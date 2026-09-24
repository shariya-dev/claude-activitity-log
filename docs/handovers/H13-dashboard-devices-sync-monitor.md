# H13 — Devices, Agent Health & Sync Monitor (PRD §11, §49–52)
Status: done (a4805ab) · Wave 4 · parallel with H11, H12, H14–H17 · Branch `handover/H13-devices-sync-monitor`

## Objective
Device list/detail with agent health, device actions (disable, enable, re-pair code, Sync Now), and the Sync Monitoring page.

## Read first
PRD §11, §33, §49–52, H05 action interfaces, H07 `AgentHealth`, data-model (`devices`, `agent_sync_states`, `sync_batches`).

## Depends on
H05, H07, H08. (sync_batches data comes from H06's seeder; tests use factories.)

## Owned files
`agent-dashboard/routes/dashboard/{devices,sync}.php` (replace placeholders), `app/Http/Controllers/Dashboard/{DeviceController,DeviceActionController,SyncMonitorController}.php`, `resources/js/pages/{Devices,Sync}/**`, `tests/Feature/Dashboard/{Devices,SyncMonitor}*Test.php`.

## Allowed dependencies
None.

## Routes
`devices.index` GET /devices · `devices.show` GET /devices/{device:device_uid} · `devices.disable` POST · `devices.enable` POST · `devices.request-sync` POST · `devices.repair-code` POST (all `/devices/{device:device_uid}/…`, gate `manageAgents`) · `sync.index` GET /sync (`viewMonitoring`).

## Behavior
- Devices index: filters platform, status, connection (online/stale/offline, derived), outdated, developer. Columns per PRD §49: Developer, Device (hostname), OS, OS version, Architecture, Agent version (outdated badge vs `min_agent_version`), Claude Code version, Last seen, Last sync, Connection status, Sync status (`agent_sync_states.health`). Default sort puts problems first.
- Device show: identity & versions, status timeline (first seen, disabled/uninstalled at), accounts seen on the device, token totals + trend (DateRange), recent sessions, last 20 sync batches (status, counts, duration, error code, rejection count; expandable rejections list). Action buttons with confirmation dialogs: Disable (explains the agent stops syncing and history is kept), Enable (explains a re-pair is needed), Generate re-pair code (`IssuePairingCode` purpose `repair`, flash-once modal), Sync Now (explains it applies at the next heartbeat, ≤ 5 min).
- Sync monitor: AgentHealth summary cards (Healthy / Offline / Sync Failed / Disabled + Outdated), a table of every device with last successful sync, last failed sync, health, records created/updated/rejected totals, last error code/message (truncated), agent version. Filter by health. A "Recent failures" list of failed/rejection-bearing batches from the last 7 days.

## Tests
Viewer: read OK, actions 403. Disable ⇒ status disabled, tokens revoked, audit `device.disabled`, and the device's sessions still listed (AC39). Sync Now ⇒ `sync_requested_at` set + audit `sync.requested`. Re-pair code flash-once + audit `device.repaired`/`pairing_code.issued` per H05 semantics. Connection derivation boundaries render the right badge. Health filter works. Rejections are shown for a batch with `rejections` JSON.

## Validation
`php artisan test --filter="Devices|SyncMonitor" && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build`.

## Acceptance criteria
AC31, AC36, AC37, AC39 · PRD §50 statuses Healthy/Offline/Sync Failed/Disabled · §51 manual sync is optional and audited.

## Review checklist
Actions only through H05 Actions (no duplicated logic) · confirmations on destructive actions · no token/credential data in props.

## Commit
`feat(H13): device monitoring, device actions and sync monitor`
