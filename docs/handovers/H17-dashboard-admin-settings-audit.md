# H17 — Admin: Tracking Settings, Retention, Users, Audit Log (PRD §23–26, §31, §52–53, §56)
Status: done (3d1dd19) · Wave 4 · parallel with H11–H16 · Branch `handover/H17-admin-settings-audit`

## Objective
Central tracking settings (with versioning so agents pick up changes), initial-sync range, intervals, minimum agent version, retention policy + prune command, user/role management, and the audit log viewer.

## Read first
PRD §23–26, §31, §52–53, §56, data-model (`tracking_settings`, `audit_logs`, users), `.claude/rules/privacy.md`, H08 gates.

## Depends on
H08 (and H04 models). Independent of H05/H06: agents read settings through `TrackingSetting::current()->toAgentPayload()` (H04), which this handover only updates.

## Owned files
`agent-dashboard/routes/dashboard/{tracking-settings,users,audit-logs}.php` (replace placeholders), `app/Http/Controllers/Dashboard/{TrackingSettingsController,UserController,AuditLogController}.php`, `app/Http/Requests/Dashboard/{UpdateTrackingSettingsRequest,StoreUserRequest,UpdateUserRequest}.php`, `app/Actions/Tracking/UpdateTrackingSettings.php`, `app/Console/Commands/PruneMonitoringData.php`, `routes/console.php` (add the `monitor:prune` daily schedule line only), `resources/js/pages/Admin/**`, `tests/Feature/Dashboard/Admin/**`.

## Allowed dependencies
None.

## Behavior
- `tracking-settings.edit` GET / `tracking-settings.update` PUT `/admin/tracking` (`configureTracking`). Form: 9 category toggles with the PRD defaults noted, the Prompt toggle with an explicit confirmation dialog ("Raw prompt text will be collected from all developers' machines…"), Git/Network explanations, initial sync range (1 day / 7 days / 30 days / All history), sync interval (60–3600 s), heartbeat interval (60–3600 s), minimum agent version (semver), retention days (blank = forever, min 30). `UpdateTrackingSettings::handle(array $data, User $by)`: transaction, diff, `bumpVersion()`, audit `tracking.updated` with before/after diff, plus a separate `prompt_tracking.enabled|disabled` audit when that flag changes, and `retention.updated` when retention changes. No local developer override exists anywhere (PRD §23).
- `users.index` + store/update (`manageUsers`): list, create (name, email, role admin/viewer, can_view_prompts, temporary password), change role, toggle prompt permission, deactivate (`is_active=false`). Can't demote or deactivate yourself or the last active admin. Audit `user.created`, `user.role_changed`, `user.prompt_permission_changed`, `user.deactivated`.
- `audit-logs.index` (`viewAuditLogs`): filter by action (distinct list), actor, subject type, date range. Columns: time, actor, action, subject (linked when routable), IP, metadata (expandable JSON). Read-only, paginated 50.
- `monitor:prune`: if `retention_days` is set, delete `session_messages` older than N days, `session_usage` older than N days **only for dates already present in `usage_daily_rollups`** (rollups and sessions are kept, so history totals remain), and `sync_batches` older than 90 days regardless. Chunked deletes, `--dry-run` option, audit `retention.pruned` with counts (actor null). Never touches devices/developers/sessions. Scheduled `daily()` in `routes/console.php`.

## Tests
Defaults render (prompt/git/network OFF) (AC28). Update bumps version, writes the diff audit, and `GET /api/agent/v1/settings` for a device token reflects the change (use Sanctum actingAs a Device factory) (AC27). Viewer ⇒ 403 on all admin routes. Last-admin protection. The audit log filters work, and there's no update/delete route. Prune dry-run counts vs real delete; rollup totals are unchanged after the prune (history preserved) (PRD §56).

## Validation
`php artisan test --filter=Admin && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build && php artisan schedule:list`.

## Acceptance criteria
AC27, AC28, AC38 · PRD §31 initial range central · §56 configurable retention without losing aggregate history.

## Review checklist
Every change audited with a diff · prompt enable is a deliberate two-step action · retention can't delete rollups/sessions/devices.

## Commit
`feat(H17): tracking settings, retention, user management and audit log viewer`
