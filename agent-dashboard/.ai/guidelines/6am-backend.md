# 6AM Activity Monitor — backend conventions

Architecture: `docs/architecture/backend.md`, data model: `docs/architecture/data-model.md`, contract: `docs/contracts/sync-api-v1.md`.

## Structure

- Thin controllers: FormRequest → Action (`app/Actions/<Area>/`, invokable-style `handle()`) or Query (`app/Queries/Analytics/`) → API Resource / `Inertia::render`.
- Agent API controllers: `app/Http/Controllers/Api/Agent/V1/`. Dashboard controllers: `app/Http/Controllers/Dashboard/`.
- Routes: one file per feature in `routes/agent/*.php` (prefix `api/agent/v1`) or `routes/dashboard/*.php` (web + auth). Never add routes to `web.php`/`api.php`.
- Vue pages: `resources/js/pages/<Feature>/{Index,Show}.vue`. Shared monitor components: `resources/js/components/monitor/`. Shared prop types: `resources/js/types/monitor.ts`. Use Wayfinder route helpers, never hard-coded URLs.

## Data rules

- Token formulas only in `App\Support\TokenMath`. UI labels: "Total Token Activity", "Actual Consumed Tokens", "Cache Read Tokens", "Input", "Output", "Cache Creation".
- Enum-like columns are strings backed by PHP enums in `app/Enums`. Models and platforms are dynamic data, never hard-coded lists in schema.
- Monitoring FKs use `restrictOnDelete()`. Developers are soft-deleted. Nothing deletes history on device disable/uninstall.
- Ingestion is idempotent: `upsert()` on unique keys, `GREATEST` for token columns, one transaction per batch.
- Dashboard token metrics come from `usage_daily_rollups`; session counts from `claude_sessions`. Don't aggregate `session_usage` in list/overview pages.
- Dates: store UTC, bucket days with `App\Support\OrgClock` (`config('monitor.timezone')`).

## Security

- Every dashboard action calls `Gate::authorize(...)`. Gates: `viewMonitoring`, `manageAgents`, `configureTracking`, `viewPrompts`, `viewAuditLogs`, `manageUsers`.
- Sensitive actions call `App\Models\AuditLog::record(action, subject, metadata)`.
- Agent tokens and pairing codes are never in Inertia props (except the one-time pairing code display), logs, or audit metadata.
- No queues, no Redis. `QUEUE_CONNECTION=sync`.

## Testing

- Pest feature tests for every endpoint and page controller, using the MySQL test DB `claude_monitor_test`.
- Gates before commit: `php artisan test`, `vendor/bin/pint --test`, `vendor/bin/phpstan analyse`, `npm run lint`, `npm run types`, `npm run build`.
