# H12 — Developers: Management, Detail, Pairing Codes (PRD §10, §44, §45)
Status: done (a47b43a) · Wave 4 · parallel with H11, H13–H17 · Branch `handover/H12-dashboard-developers`

## Objective
Developer list, create/edit/deactivate, developer detail dashboard (accounts, devices, projects, sessions, tokens, trends, last activity/sync), and "Generate pairing code" (shown once).

## Read first
PRD §9–10, §15, §44–45, H05 interfaces (`IssuePairingCode`), H07 + H08 docs.

## Depends on
H05, H07, H08.

## Owned files
`agent-dashboard/routes/dashboard/developers.php` (replace placeholder), `app/Http/Controllers/Dashboard/DeveloperController.php`, `app/Http/Controllers/Dashboard/DeveloperPairingCodeController.php`, `app/Http/Requests/Dashboard/{StoreDeveloperRequest,UpdateDeveloperRequest}.php`, `resources/js/pages/Developers/**`, `tests/Feature/Dashboard/Developers*Test.php`.

## Allowed dependencies
None.

## Routes
`developers.index` GET /developers · `developers.store` POST /developers · `developers.update` PUT /developers/{developer} · `developers.show` GET /developers/{developer} · `developers.pairing-codes.store` POST /developers/{developer}/pairing-codes. Mutations need `manageAgents`, reads need `viewMonitoring`. Deactivating = update `status=inactive` (no delete route; history kept).

## Behavior
- Index: search (name/email/team), status filter, DateRange. Columns: Name, Email, Team, Status, Devices, Claude accounts, Sessions (range), Actual Consumed (range), Total Token Activity (range), Last activity, Last sync. Paginated 25. Use aggregate subqueries/`withCount`, not per-row queries.
- Show: header (name, email, team, status), DateRange + EntityFilters (device, account, project, model limited to this developer's options), TokenMetricsGrid, TrendChart, breakdowns by device/account/project/model, devices list (platform, versions, connection StatusBadge, last seen/sync → `devices.show`), Claude accounts (email/display name, first/last seen, devices), recent sessions (→ `sessions.show`). Navigation per PRD §45 (Developer → Device → Account → Project → Session) is through links plus the pre-applied filters.
- Pairing code: the POST calls `IssuePairingCode` and redirects back with `flash.pairing_code`. A modal shows it once with its expiry (15 min) and copy button, plus instructions "Install the agent, then enter this code". It's never re-displayed, and the Inertia history state is cleared (`preserveState:false`).

## Tests
Viewer can view but cannot store/update/pair (403). Admin creates a developer (unique email validation) and deactivates it (devices + history intact). The pairing code flash is present once and absent on the next request. The audit row `pairing_code.issued` exists without the code. Show page totals equal H07 queries with the developer filter. Developer with 3 devices on 3 platforms shows all under one identity (AC13 display side).

## Validation
`php artisan test --filter=Developers && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build`. Manual: create developer, issue code, check it in `pairing_codes` (hashed).

## Acceptance criteria
AC30 · PRD §44 fields all present · §9 controlled pairing starts here.

## Review checklist
Pairing code never logged/persisted in plaintext · policies on every action · no delete of developers with history.

## Commit
`feat(H12): developer management, detail dashboard and pairing codes`
