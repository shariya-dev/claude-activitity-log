# H08 — Dashboard Shell, RBAC, Shared Components
Status: todo · Wave 3 · parallel with H05–H07, H09, H10 · Branch `handover/H08-dashboard-shell-rbac`

## Objective
Everything the Wave 4 page handovers share, so they can run in parallel without touching common files: gates, Inertia shared props, the sidebar with every nav entry, placeholder routes/pages for each feature, shared Vue monitor components, shared TS types, and the `monitor:create-admin` command.

## Read first
`backend.md` §2–3, `agent-dashboard/CLAUDE.md` (Boost: Inertia/Vue/Tailwind/shadcn-vue guidance), PRD §43–53.

## Depends on
H04 (User role columns, enums).

## Owned files
`agent-dashboard/app/Providers/MonitorAuthServiceProvider.php`, `bootstrap/providers.php`, `app/Http/Middleware/HandleInertiaRequests.php`, `app/Http/Middleware/EnsureUserIsActive.php` (+ alias registration line in `bootstrap/app.php`), `app/Http/Controllers/Dashboard/PlaceholderController.php`, `routes/dashboard/{developers,devices,projects,sessions,token-analytics,sync,tracking-settings,audit-logs,users}.php` (placeholders), `app/Console/Commands/CreateAdmin.php`, `resources/js/components/AppSidebar.vue` (and the starter kit's nav config it uses), `resources/js/pages/Placeholder.vue`, `resources/js/components/monitor/**`, `resources/js/types/monitor.ts`, `resources/js/lib/format.ts`, `tests/Feature/Shell/**`.

## Allowed dependencies
None (chart.js + vue-chartjs are already installed).

## Deliverables
1. Gates (in `MonitorAuthServiceProvider`): `viewMonitoring` (active admin or viewer), `manageAgents`, `configureTracking`, `viewAuditLogs`, `manageUsers` (admin only), `viewPrompts` (admin **and** `can_view_prompts`, or viewer with `can_view_prompts`). Inactive users are logged out by `EnsureUserIsActive`, appended to the dashboard route group.
2. Inertia shared props: `auth.user {id,name,email,role}`, `can {manageAgents, configureTracking, viewAuditLogs, manageUsers, viewPrompts}`, `monitor {timezone}`, `flash {success,error,pairing_code}`.
3. Route names & placeholder routes (each GETs `PlaceholderController` rendering `Placeholder` with a title). Wave 4 replaces each file wholesale:
   `developers.php` → `developers.index` `/developers`, `developers.show` `/developers/{developer}` · `devices.php` → `devices.index`, `devices.show` `/devices/{device:device_uid}` · `projects.php` → `projects.index`, `projects.show` · `sessions.php` → `sessions.index`, `sessions.show` `/sessions/{session}` · `token-analytics.php` → `analytics.tokens` `/analytics/tokens` · `sync.php` → `sync.index` `/sync` · `tracking-settings.php` → `tracking-settings.edit` `/admin/tracking` · `audit-logs.php` → `audit-logs.index` `/admin/audit-logs` · `users.php` → `users.index` `/admin/users`. (Overview `dashboard` already exists from H01; H11 owns `routes/dashboard/overview.php`.)
4. Sidebar: Overview, Developers, Devices, Projects, Sessions, Token Analytics, Sync Monitor. Admin group (visible by `can`): Tracking Settings, Users, Audit Log. Use Wayfinder route helpers.
5. `components/monitor/`: `DateRangeFilter.vue` (presets Today/Yesterday/This Week/This Month/This Year/Custom; syncs `range,from,to` query params via `router.get(..., {preserveState:true, preserveScroll:true})`), `EntityFilters.vue` (select boxes for developer/device/account/project/model, options passed as props `{id,label}[]`), `MetricCard.vue`, `TokenMetricsGrid.vue` (six metrics with the exact PRD labels; cache read visually separated, tooltip: "Actual Consumed = Input + Output + Cache Creation. Monitoring figure, not billing."), `TrendChart.vue` (vue-chartjs line, series selectable: total/actual/cache read), `BreakdownTable.vue`, `DataTable.vue` (server pagination via Laravel paginator props, sortable headers), `StatusBadge.vue` (device status, connection, sync health, session status), `EmptyState.vue`, `RelativeTime.vue` (org tz).
6. `types/monitor.ts`: TS types mirroring every H07 return shape (`TokenTotals`, `TrendPoint`, `BreakdownRow`, `SessionRow`, `AgentHealthSummary`, `ProblemAgent`, `DateRangeProps`, `FilterOption`, `Paginated<T>`).
7. `lib/format.ts`: `formatTokens(n)` (1.2K / 3.4M / 1.05B, with full value in title), `formatDuration(seconds)`, `formatDateTime(iso, tz)`.
8. `monitor:create-admin {email} {--name=}` prompts for a password and creates an active admin.

## Tests
Gates matrix (admin/viewer/inactive × each gate). Every placeholder route: guest ⇒ redirect login; viewer ⇒ 200 for monitoring pages, 403 for admin pages. Shared props contain `can` and no token/secret fields. create-admin creates an admin. Vue: `npm run types` and `npm run lint` pass; the components compile in the build.

## Validation
`php artisan test --filter=Shell && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build`. Manual: `composer run dev`, log in, click every nav item (placeholders render), toggle dark mode, check 375 px width.

## Acceptance criteria
PRD §53 roles enforced server-side · all Wave 4 route names exist · shared components are feature-agnostic.

## Review checklist
No feature logic · labels exactly as PRD · no "cost/billing" wording · accessibility: labeled selects, keyboard-usable date picker.

## Commit
`feat(H08): dashboard shell, rbac gates, shared monitor components and placeholders`
