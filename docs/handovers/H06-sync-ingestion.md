# H06 — Sync Ingestion, Token Calculation, Rollups
Status: done (3534c6c) · Wave 3 · parallel with H05, H07–H10 · Branch `handover/H06-sync-ingestion`

## Objective
Implement `POST /api/agent/v1/sync`: validate → persist idempotently in one transaction → calculate tokens (TokenMath) → recompute session/project totals → refresh daily rollups → acknowledge. Also provide a demo-data seeder that exercises the real ingestion path (used by all dashboard handovers).

## Read first
`docs/contracts/sync-api-v1.md`, `.claude/rules/sync-protocol.md`, `.claude/rules/privacy.md`, `data-model.md`, PRD §19–22, §27–39, §57.

## Depends on
H03, H04.

## Owned files
`agent-dashboard/routes/agent/sync.php`, `app/Http/Controllers/Api/Agent/V1/SyncController.php`, `app/Http/Requests/Agent/SyncRequest.php`, `app/Http/Resources/Agent/SyncResultResource.php`, `app/Actions/Ingestion/**`, `app/Console/Commands/{RecalculateTokens,MarkOffline}.php`, `routes/console.php` (schedule entry for mark-offline only), `database/seeders/MonitorDemoSeeder.php`, `tests/Feature/Ingestion/**`, `tests/Unit/Actions/Ingestion/**`.

## Allowed dependencies
None.

## Interfaces produced
```php
App\Actions\Ingestion\IngestSyncBatch::handle(Device $device, array $validated): array  // contract success response body
App\Actions\Ingestion\RefreshDailyRollups::handle(array $deviceDatePairs): void          // [[device_id, 'Y-m-d'], ...]; delete + insert-select from session_usage
App\Actions\Ingestion\RecomputeSessionTotals::handle(array $sessionIds): void
```
Artisan: `monitor:recalculate-tokens {--from=} {--to=}` (recompute calc columns via TokenMath, session totals, all rollups in range), `monitor:mark-offline` (refresh `agent_sync_states.health` from last_seen/last errors; scheduled every 5 min).

## Algorithm (inside `DB::transaction`, device row `lockForUpdate`)
1. `sync_batches` upsert on `(device_id, batch_uuid)`: `succeeded` ⇒ return stored `response` verbatim (no writes). `processing` and younger than 2 min ⇒ 409 `batch_in_progress`. Otherwise set `processing`.
2. Strip disabled categories using `TrackingSetting::current()`, adding a rejection `category_disabled` per stripped record (prompt OFF ⇒ `messages` dropped; git OFF ⇒ git fields nulled; etc.).
3. Per-record semantic validation (negative tokens, `recorded_at` > now+1d, unknown session reference) ⇒ `rejected_records`, continue.
4. Upserts in order: models (`ClaudeModel::idFor`), accounts (+ `claude_account_device`), projects (+ `project_locations`), sessions (LEAST/GREATEST rules), usage (`GREATEST` per raw column; calc columns via TokenMath in the same statement or a follow-up update of touched rows; `recorded_on` via OrgClock; denormalized dims from the session), messages (insert-ignore).
5. If a session's project/account changed, update its `session_usage` dims and include the old+new dates in the rollup refresh.
6. `RecomputeSessionTotals` for touched sessions (sums, activity_count, duration_seconds, status, model = latest usage model); refresh project denormalized totals/session_count/last_activity for touched projects.
7. `RefreshDailyRollups` for touched `(device_id, recorded_on)`.
8. Update device `last_sync_at`, `claude_code_version`; `agent_sync_states` (sequence+1, cursor = base64url json {sequence,batch,acked_at}, totals, health healthy, consecutive_failures 0); mark batch `succeeded` with counts + response. Return 200.
- `created`/`updated` counts: use `upsert` affected-rows semantics (MySQL returns 1 for insert, 2 for update); document the approach in code.
- Any exception ⇒ rollback. Outside the transaction, record the batch `failed` + `agent_sync_states.last_failure_at/error`, then return 500 `persistence_failed` (retryable). Never 200 on partial persistence.
- `SyncRequest` validates the envelope per `schemas/sync.request.json` and the limits from `config('monitor.sync_limits')` (413 when exceeded). It also checks `agent.device_id` == authenticated device (else 422).

## Demo seeder
`MonitorDemoSeeder` creates 6 developers, 9 devices (all 3 platforms), 3 accounts, 8 projects, 4 models, and ~60 days of sessions. It **builds contract-shaped payloads and calls `IngestSyncBatch`**, so demo data is produced by the real code path. It also creates an admin `admin@example.com` / `password` and a viewer.

## Tests
- Contract examples: `sync.request.full.json` ⇒ 200 with the expected counts; the same body again ⇒ identical response, row counts unchanged (**AC16**).
- Split/partial usage: send msg X with output 100 then 866 then 100 again ⇒ stored 866.
- PRD §20 example ⇒ session actual 150000 / total 650000 / cache_read 500000 (**AC24–26**).
- Prompt OFF + messages sent ⇒ none stored, rejection `category_disabled` (**AC29**).
- Forced failure (mock `RefreshDailyRollups` to throw) ⇒ 500, zero rows written, batch `failed`, a retry with the same batch_id succeeds (**AC17** server side).
- Rollups: two sessions on two org-days across UTC midnight land on the correct `date`; recompute is idempotent.
- Session merge: a later chunk with earlier `first_seen_at` lowers `started_at`; duration updates.
- Project reassignment moves rollup totals.
- Disabled device ⇒ 403 (middleware). Wrong device_id in body ⇒ 422. Oversize ⇒ 413.
- `monitor:recalculate-tokens` reproduces identical totals.

## Validation
`php artisan test --filter=Ingestion && php artisan db:seed --class=MonitorDemoSeeder && vendor/bin/pint --test && vendor/bin/phpstan analyse`. Report a timing: ingest of a 500-usage batch < 1.5 s locally.

## Acceptance criteria
PRD §21, §38, §39 satisfied · backend is the only calculator · no queues · rejected records visible, never silent.

## Review checklist
Single transaction · `GREATEST` merge · replay returns stored response · category stripping server-side · N+1-free (bulk upserts, not per-row saves).

## Commit
`feat(H06): idempotent sync ingestion with token calculation and daily rollups`
