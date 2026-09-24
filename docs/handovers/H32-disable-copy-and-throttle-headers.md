# H32 — Disable/Enable Dashboard Copy, Throttle Response Headers, Uninstalled Message
Status: todo · Follow-up (H26 review leftovers) · parallel with H27, H31 · Branch `handover/H32-h26-leftovers`

## Objective
Finish what H26 changed: (1) the dashboard tells admins the truth about Disable/Enable (the token is kept; Enable resumes syncing at the agent's next hourly probe, no re-pair), (2) `429 rate_limited` on authenticated agent endpoints carries `X-Settings-Version` and `X-Server-Time` like every other response (contract §1), (3) the `device_uninstalled` message matches `docs/contracts/examples/error.device_uninstalled.json`.

## Depends on
H26 (merged).

## Owned files
agent-dashboard: `resources/js/pages/Devices/components/DeviceActions.vue` · `app/Http/Controllers/Dashboard/DeviceActionController.php` (flash text only) · `app/Http/Middleware/EnsureDeviceIsActive.php` (message only) · `routes/agent/{device,sync}.php` and/or the middleware section of `bootstrap/app.php` (middleware order/priority only) · `tests/Feature/Agent/**` · `tests/Feature/Ingestion/SyncHttpGuardsTest.php` · `tests/Feature/Dashboard/Devices*Test.php`

## Steps (TDD)
1. Failing tests: 429 on `/heartbeat` and `/sync` has both headers; `device_uninstalled` body equals the example; enable flash text.
2. Fix middleware order without breaking contract §2 check order (401 → 429 → 403 → …).
3. Update copy.

## Validation
`cd agent-dashboard && npm run build && DB_DATABASE=claude_monitor_test_h32 php artisan test` fully green · `vendor/bin/pint --test` · `vendor/bin/phpstan analyse` · `npm run lint && npm run types`.

## Commit
`fix(H32): accurate disable copy, headers on throttled agent responses`
