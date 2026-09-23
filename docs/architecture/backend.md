# Backend Application Architecture (`agent-dashboard/`)

Responsibility (PRD §62): **Validate → Persist → Calculate → Aggregate → Report**, plus the dashboard's **View → Filter → Analyze → Configure**.

## 1. Stack & packages

| Package | Purpose | Installed in |
|---|---|---|
| Laravel (current stable, 13.x expected; 12.x acceptable) via `laravel/vue-starter-kit` | Framework + Inertia v2 + Vue 3 + TS + Tailwind 4 + shadcn-vue + Fortify auth + Wayfinder | H01 |
| `laravel/sanctum` | Device tokens (`Device` uses `HasApiTokens`) | H01 |
| `laravel/boost` (dev) | MCP server (DB schema, tinker, docs search, logs) + AI guidelines/skills for Laravel, Inertia, Vue, Pest, Tailwind | H01 |
| `pestphp/pest` (+ `pest-plugin-laravel`) | Tests (starter kit default) | H01 |
| `larastan/larastan` (dev) | Static analysis, level 6 | H01 |
| `laravel/pint` (dev) | Code style (Laravel preset) | H01 |
| `chart.js` + `vue-chartjs` (npm) | Trend charts | H01 |
| MySQL 8 (MAMP: `127.0.0.1:8889`, `root`/`root`) | DBs `claude_monitor`, `claude_monitor_test` | H01 |

Explicitly **not** used: Redis, Horizon, queue workers, Telescope, spatie/permission, spatie/activitylog, Livewire, Filament. `QUEUE_CONNECTION=sync`, `CACHE_STORE=database`, `SESSION_DRIVER=database`.

## 2. Module structure (Laravel conventions — Boost-friendly)

```
app/
├── Enums/                 DeviceStatus, SessionStatus, UserRole, TrackingCategory, InitialSyncRange, SyncBatchStatus, SyncHealth, ConnectionState
├── Models/                Developer, Device, ClaudeAccount, Project, ProjectLocation, ClaudeModel, ClaudeSession,
│                          SessionUsage, SessionMessage, UsageDailyRollup, TrackingSetting, AgentSyncState,
│                          SyncBatch, PairingCode, AuditLog, User
├── Support/               TokenMath (the ONLY place token formulas live), OrgClock (org timezone helpers)
├── Actions/
│   ├── Agent/             RegisterDevice, RecordHeartbeat, IssuePairingCode, RepairDevice, DisableDevice, RequestManualSync
│   ├── Ingestion/         IngestSyncBatch (orchestrator), UpsertAccounts, UpsertProjects, UpsertSessions,
│   │                      UpsertUsage, UpsertMessages, RecomputeSessionTotals, RefreshDailyRollups
│   ├── Tracking/          UpdateTrackingSettings
│   └── Audit/             RecordAudit (static facade-ish entry: AuditLog::record(...))
├── Queries/Analytics/     DateRange, UsageFilters, TokenAnalytics, ActivityStats, AgentHealth, SessionSearch
├── Http/
│   ├── Controllers/Api/Agent/V1/   RegisterController, HeartbeatController, SettingsController, SyncController, SyncStatusController
│   ├── Controllers/Dashboard/      OverviewController, DeveloperController, DeviceController, ProjectController,
│   │                               SessionController, TokenAnalyticsController, SyncMonitorController,
│   │                               TrackingSettingsController, AuditLogController, UserController
│   ├── Middleware/                 EnsureDeviceIsActive, AttachSettingsVersion
│   ├── Requests/{Agent,Dashboard}/
│   └── Resources/Agent/            SettingsResource, SyncResultResource
├── Policies/              gates: viewMonitoring, manageAgents, configureTracking, viewPrompts, viewAuditLogs, manageUsers
└── Console/Commands/      monitor:create-admin, monitor:prune, monitor:recalculate-tokens, monitor:mark-offline
routes/
├── agent/*.php            auto-loaded: prefix api/agent/v1, middleware api (+ auth:sanctum per file)
└── dashboard/*.php        auto-loaded: middleware web, auth, verified
resources/js/
├── pages/<Feature>/Index.vue, Show.vue
├── components/monitor/    DateRangeFilter, MetricCard, TokenMetricsGrid, TrendChart, DataTable, StatusBadge, EmptyState (H08)
└── types/monitor.ts       shared TS types for Inertia props (H08)
```

Route-file ownership avoids merge conflicts: each handover owns its own `routes/agent/<feature>.php` / `routes/dashboard/<feature>.php`. H01 wires the glob loaders in `bootstrap/app.php`. H08 creates the sidebar with every nav entry and placeholder pages so page handovers only replace their own page + controller.

## 3. Conventions & guardrails

- **Controllers are thin**: FormRequest → Action/Query → Resource/Inertia response. No query builder in controllers.
- **Actions** are single-purpose invokable classes (`handle()` method) with constructor DI; they own transactions.
- **Queries** return plain typed arrays/DTOs for Inertia; they read `usage_daily_rollups` for token metrics and `claude_sessions` for session counts. Never aggregate raw `session_usage` in dashboard requests except session detail.
- **Token math** only via `App\Support\TokenMath::actual($in,$out,$cc)` / `::total($in,$out,$cc,$cr)`. Labels in UI: "Total Token Activity", "Actual Consumed Tokens", "Cache Read Tokens". Never "cost", "billing", "quota".
- **Idempotency**: every ingested entity has a unique key (see data-model.md) and is written with `upsert()` / `INSERT … ON DUPLICATE KEY UPDATE`; token columns use `GREATEST(col, VALUES(col))`.
- **Transactions**: one `DB::transaction()` per sync batch; any exception ⇒ 5xx `persistence_failed`, nothing committed.
- **Enums** backed by strings; DB columns are `string` (not MySQL ENUM) so new values need no schema change (models/platforms are dynamic).
- **Authorization**: every dashboard controller calls `Gate::authorize()`; prompt content additionally requires `viewPrompts` and writes an audit entry.
- **Audit** (`audit_logs`) for: tracking/prompt setting changes, prompt content views, device disable/enable/re-pair/pairing-code issue, manual sync, user role changes, retention changes.
- **Agent credentials** never appear in Inertia props, logs, or audit metadata; pairing codes are shown once and stored hashed.
- **Tests**: Pest feature tests per endpoint/page; MySQL test DB (upsert/`GREATEST` semantics are MySQL-specific). `php artisan test`, `vendor/bin/pint --test`, `vendor/bin/phpstan analyse`, `npm run build`, `npm run lint`, `npm run types` (vue-tsc) must pass before commit.
- **Scheduler** (cron `* * * * * php artisan schedule:run`): `monitor:mark-offline` every 5 min (derives nothing destructive; refreshes `agent_sync_states.health`), `monitor:prune` daily. The scheduler is not a queue.

## 4. Agent ↔ backend boundary

| Direction | Channel | Auth | Owned by |
|---|---|---|---|
| Agent → backend | `POST /api/agent/v1/register` | pairing code (rate limit 10/min/IP) | H05 |
| Agent → backend | `POST /api/agent/v1/heartbeat`, `GET /settings`, `GET /sync/status`, `POST /deregister` | `Authorization: Bearer <device token>` + `EnsureDeviceIsActive` | H05 |
| Agent → backend | `POST /api/agent/v1/sync` | same | H06 |
| Backend → agent | Only via responses: `settings_version`, `sync_requested`, `min_agent_version`, error codes | — | H03 contract |
| Dashboard → backend | Inertia web routes, session auth | Fortify + Gates | H08+ |

Rules: the backend never trusts agent-computed totals; the agent never trusts its own settings over the server's; every agent response carries `X-Settings-Version`. Full detail: [sync-protocol.md](sync-protocol.md).
