# H11 — Organization Overview Dashboard (PRD §43)
Status: todo · Wave 4 · parallel with H12–H17 (and Wave 5) · Branch `handover/H11-dashboard-overview`

## Objective
Replace the starter kit dashboard with the organization overview: KPIs, token metrics, trend, top breakdowns, recent activity, and offline/stale agents, all driven by the date filter.

## Read first
PRD §43, `backend.md` §3, `agent-dashboard/CLAUDE.md`, H07 interfaces (`docs/handovers/H07-analytics-queries.md`), H08 components (`resources/js/components/monitor/`, `types/monitor.ts`).

## Depends on
H07, H08 (merged). Demo data: `php artisan migrate:fresh --seed --seeder=MonitorDemoSeeder` (H06).

## Owned files
`agent-dashboard/routes/dashboard/overview.php`, `app/Http/Controllers/Dashboard/OverviewController.php`, `resources/js/pages/Dashboard.vue` (replace), `resources/js/pages/Overview/**` (subcomponents), `tests/Feature/Dashboard/OverviewTest.php`.

## Allowed dependencies
None.

## Behavior
- `GET /dashboard` (`dashboard`), gate `viewMonitoring`. `DateRange::fromRequest($r, 'today')`.
- Props: `range`, `kpis {totalDevelopers, activeDevices, sessionsInRange (labelled "Sessions today" when preset=today), activeProjects}`, `tokens` (TokenAnalytics::totals), `trend` (auto granularity, but hourly isn't supported, so `today`/`yesterday` show the last 14 days trend with the day highlighted: document this in the UI subtitle), `topDevelopers`, `topProjects`, `topModels` (breakdown limit 5), `recentSessions` (10), `agentHealth` (summary), `problemAgents` (10).
- UI: DateRangeFilter (Today, Yesterday, This Week, This Month, This Year, Custom), 4 KPI MetricCards, TokenMetricsGrid (Total Token Activity, Actual Consumed Tokens, Cache Read Tokens prominent; Input/Output/Cache Creation secondary), TrendChart, three BreakdownTables linking to detail pages, recent sessions linking to `sessions.show`, offline/stale agents panel linking to `devices.show`, with empty states.

## Tests
Viewer gets 200 with every prop key. Totals equal the H07 query results for the seeded data. Each preset is accepted and an invalid custom range ⇒ validation redirect with errors. Guest ⇒ login. Prop payload contains no token/credential keys (assert recursively that no key matches `/token$|secret|password/` except metric names).

## Validation
`php artisan test --filter=Overview && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build`. Manual: seeded data, every preset, dark mode, 375 px.

## Acceptance criteria
Every PRD §43 item is visible · AC26 (cache read separate) · AC35 date filters.

## Review checklist
Controller is thin (only H07 calls) · no N+1 · copy uses the exact PRD metric names · no "cost/billing".

## Commit
`feat(H11): organization overview dashboard`
