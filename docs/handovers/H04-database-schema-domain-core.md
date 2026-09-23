# H04 — Database Schema & Domain Core (PRD Phase 1, §40–42)
Status: todo · Wave 2 · parallel with H02, H03 · Branch `handover/H04-database-schema-domain-core`

## Objective
Implement the complete data model and the small shared domain core that every backend handover relies on: models, enums, factories, `TokenMath`, `OrgClock`, `AuditLog::record`, `TrackingSetting::current()`, and the device-auth middlewares.

## Read first
`docs/architecture/data-model.md` (normative), `backend.md`, `agent-dashboard/CLAUDE.md` (Boost), PRD §10–12, §15–21, §40–42, §52–53, §56.

## Depends on
H01.

## Owned files
`agent-dashboard/database/migrations/**` (new files only), `database/factories/**`, `app/Models/**` (incl. edits to `User.php`), `app/Enums/**`, `app/Support/TokenMath.php`, `app/Support/OrgClock.php`, `app/Http/Middleware/EnsureDeviceIsActive.php`, `app/Http/Middleware/AttachSettingsVersion.php`, `config/monitor.php`, `tests/Unit/Domain/**`, `tests/Feature/Schema/**`. Register middleware **aliases** (`device.active`, `settings.version`) in `bootstrap/app.php` `withMiddleware` (the only edit allowed there).

## Allowed dependencies
None.

## Deliverables
1. **Migrations**, one per table, in dependency order, exactly as `data-model.md` (columns, nullability, unique keys, indexes, `restrictOnDelete`): users additions, developers (soft deletes), pairing_codes, devices, agent_sync_states, sync_batches, claude_accounts, claude_account_device, projects, project_locations, claude_models, claude_sessions, session_usage, usage_daily_rollups, session_messages, tracking_settings (+ seed row id=1 in the migration), audit_logs.
2. **Enums** (string-backed): `UserRole{Admin,Viewer}`, `DeveloperStatus{Active,Inactive}`, `DeviceStatus{Active,Disabled,Uninstalled}`, `ConnectionState{Online,Stale,Offline}` with `static fromLastSeen(?CarbonInterface): self`, `SessionStatus{Active,Idle,Ended}`, `SyncBatchStatus{Processing,Succeeded,Failed}`, `SyncHealth{Healthy,Offline,SyncFailed,Disabled}`, `TrackingCategory{Session,Usage,Project,Model,Device,Account,Prompt,Git,Network}`, `InitialSyncRange{OneDay='1d',SevenDays='7d',ThirtyDays='30d',All='all'}` with `sinceFrom(CarbonImmutable $now): ?CarbonImmutable`, `PairingPurpose{Pair,Repair}`.
3. **Models** with casts, relationships, and scopes: `Developer` (devices, claudeAccounts, sessions, pairingCodes), `Device` (`use HasApiTokens`; developer, syncState, syncBatches, sessions, claudeAccounts (pivot with timestamps), projectLocations; `connectionState(): ConnectionState`; route key `device_uid`; `creating` hook generating `dev_`+ULID), `ClaudeAccount`, `Project`, `ProjectLocation`, `ClaudeModel` (`static idFor(string $name): int` using upsert+cache per request), `ClaudeSession` (table `claude_sessions`), `SessionUsage` (table `session_usage`), `SessionMessage` (`content` => `encrypted`), `UsageDailyRollup`, `TrackingSetting` (`static current(): self` = row 1; `enabled(TrackingCategory): bool`; `toAgentPayload(): array` per contract; `bumpVersion()`), `AgentSyncState`, `SyncBatch`, `PairingCode` (`static hashCode(string): string` normalizes uppercase/strip `-`), `AuditLog` (`static record(string $action, ?Model $subject = null, array $metadata = [], ?User $actor = null): self` pulling ip/user-agent from request when present; `$guarded` update/delete blocked via model events throwing `LogicException`), `User` additions (`role` cast, `isAdmin()`).
4. `App\Support\TokenMath`: `actual(int $in, int $out, int $cacheCreation): int`, `total(int $in, int $out, int $cacheCreation, int $cacheRead): int`, `forRow(array $raw): array` returning both, all ints ≥ 0 (throws `InvalidArgumentException` on negatives).
5. `App\Support\OrgClock`: `timezone(): string`, `dateFor(CarbonInterface $utc): string` (Y-m-d in org tz), `startOfDayUtc(string $date): CarbonImmutable`, `now(): CarbonImmutable`.
6. Middleware: `EnsureDeviceIsActive` (the authenticated tokenable must be a `Device`; `disabled` ⇒ 403 `device_disabled`, `uninstalled` ⇒ 403 `device_uninstalled`, JSON error envelope per contract), `AttachSettingsVersion` (adds `X-Settings-Version`, `X-Server-Time`).
7. Factories for every model with realistic states (`Device::factory()->disabled()`, `ClaudeSession::factory()->for($device)`, `SessionUsage::factory()` computing calc columns through TokenMath).

## Tests (Pest)
- `TokenMathTest`: PRD §20 example (100000/20000/30000/500000 ⇒ actual 150000, total 650000); zeros; negative throws.
- `OrgClockTest`: 2026-09-21T20:30Z is `2026-09-22` in Asia/Dhaka.
- `SchemaTest`: each unique key rejects duplicates (device fingerprint per developer, session per device, usage per session+message, rollup dims_hash, batch per device); `restrictOnDelete` blocks deleting a device with sessions; tracking_settings row 1 has PRD defaults (prompt/git/network false, 7d).
- `AuditLogTest`: record() stores actor/ip; update throws.
- `EnsureDeviceIsActiveTest`: disabled ⇒ 403 envelope; active passes (a test-only route defined inside the test).
- `ConnectionStateTest`: boundaries at 10 min / 24 h from config.

## Validation
`php artisan migrate:fresh && php artisan test && vendor/bin/pint --test && vendor/bin/phpstan analyse`.

## Acceptance criteria
Schema matches `data-model.md` 1:1 (reviewer diffs `php artisan db:show`/Boost `database-schema` against the doc) · PRD defaults seeded · no per-OS columns · no cascading deletes on monitoring data.

## Review checklist
Index list complete · `session_usage` calc columns only via TokenMath · `SessionMessage` encrypted · no business logic beyond the listed helpers.

## Commit
`feat(H04): monitoring schema, models, enums, token math and device middleware`
