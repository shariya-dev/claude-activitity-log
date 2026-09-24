# H26 — Agent API Error Envelopes, Disable Semantics & Trusted Proxies
Status: done (bb1a58d) · Follow-up (Wave 6 findings F2, F3, F4, FU-2) · parallel with H27–H31 · Branch `handover/H26-agent-api-errors`

## Objective
Make every agent-facing failure use the contract §9.1 envelope, make a dashboard **Disable** yield `403 device_disabled` (not a token-revoked `401`), and let the backend see the real client IP behind a reverse proxy.

## Read first
`docs/contracts/sync-api-v1.md` §1, §2 (order of checks), §3.3, §3.4, §3.6, §9; `e2e/README.md` Findings F2–F4; `docs/validation/platform-matrix.md` FU-2 and rows 15 and 18; H05, H06, H13.

## Depends on
H05, H06, H13, H22 (merged).

## Owned files
agent-dashboard: `bootstrap/app.php` (exception rendering + `trustProxies` only) · `app/Actions/Agent/{DisableDevice,EnableDevice}.php` · `config/monitor.php` (a `trusted_proxies` key only) · `.env.example` (`MONITOR_TRUSTED_PROXIES` line only) · `tests/Feature/Agent/**` · `tests/Feature/Ingestion/{SyncHttpGuardsTest,PersistenceFailureTest}.php` · `tests/Unit/Actions/Agent/DeviceLifecycleTest.php` · `tests/Feature/Dashboard/DevicesActionsTest.php`
6am-agent: `src/core/sync/{apiClient,errorPolicy}.ts` and `test/unit/sync/{apiClient,errorPolicy}.test.ts`, **only if** the agent does not already map the contract envelopes as §9.2 requires
e2e: `e2e/scenarios/07-device-disable.test.ts`

## Allowed dependencies
None.

## Steps (TDD: write/flip the failing tests first)
1. **401 envelope.** For requests under `api/agent/*`, render `AuthenticationException` as `401 {"error":{"code":"unauthenticated",…}}` exactly like `docs/contracts/examples/error.unauthenticated.json`. Covers `/sync`, `/heartbeat`, `/settings`, `/sync/status`, `/deregister`. Dashboard (web) auth keeps its redirect.
2. **429 envelope.** Render `ThrottleRequestsException` (both `/register` 10/min/IP and the 60/min/device throttles) as the `rate_limited` envelope, keeping the `Retry-After` header.
3. **500 envelope.** An unexpected exception during `/sync` persistence returns `500 persistence_failed` with rollback (contract §3.4). Other unexpected agent-endpoint errors must still be a valid envelope. Never leak exception messages.
4. **Disable ⇒ 403.** `DisableDevice` stops revoking tokens, so `device.active` answers `403 device_disabled` (contract §9.2: the agent stops syncing and probes hourly). `EnableDevice` restores sync with the same token, no re-pair needed. Re-pair and `/deregister` still revoke (contract §3.1, §3.6). Keep the audit rows and history.
5. **Trusted proxies.** `trustProxies(at: …)` from `config('monitor.trusted_proxies')` (env `MONITOR_TRUSTED_PROXIES`, comma list or `*`, default empty = trust none). Document it in `.env.example`.
6. **Agent mapping.** Confirm (tests) that the agent turns `401 unauthenticated` into `needs_repair` + stops sync/heartbeat, and `403 device_disabled` into `device_disabled` + hourly probe. Fix only if it doesn't.
7. **e2e.** Change `07-device-disable`'s `it.fails('KNOWN BUG F2 …')` to `it`, and align its 401 assertions with the new 403 behaviour. Do not run e2e (the orchestrator runs it after merging); do not edit `e2e/README.md`.

## Validation
`cd agent-dashboard && DB_DATABASE=claude_monitor_test_h26 php artisan test` (full suite; only FU-3's `PlaceholderRoutesTest` failures are tolerated until H28 merges) · `vendor/bin/pint --test` · `vendor/bin/phpstan analyse` · `cd 6am-agent && npm test && npm run typecheck && npm run lint` if agent files changed.

## Acceptance criteria
Every agent endpoint's 401/403/429/500 body validates against the contract error schema · disable ⇒ `403 device_disabled`, enable ⇒ sync resumes on the same token · `X-Forwarded-For` is honoured only from configured proxies.

## Review checklist
Web auth unaffected · no exception text in bodies · history untouched by disable · contract §2 check order preserved.

## Commit
`fix(H26): contract error envelopes, disable semantics and trusted proxies`
