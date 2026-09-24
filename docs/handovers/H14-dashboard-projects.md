# H14 — Project Analytics (PRD §17, §46)
Status: done (eabb04b) · Wave 4 · parallel with H11–H13, H15–H17 · Branch `handover/H14-dashboard-projects`

## Objective
Project list and project detail analytics.

## Read first
PRD §17, §46, data-model (`projects`, `project_locations`), H07/H08 docs.

## Depends on
H07, H08.

## Owned files
`agent-dashboard/routes/dashboard/projects.php` (replace placeholder), `app/Http/Controllers/Dashboard/ProjectController.php`, `resources/js/pages/Projects/**`, `tests/Feature/Dashboard/ProjectsTest.php`.

## Allowed dependencies
None.

## Behavior
- `projects.index`: search by name/path, DateRange, developer filter. Columns: Project name, Developers (count), Devices (count), Sessions (range), Total Token Activity, Actual Consumed Tokens, Cache Read Tokens (range, from rollups via `breakdown(Dimension::Project)` or an equivalent grouped rollup query in the controller's Query call), Last activity. Paginated.
- `projects.show`: name, git remote (if stored), paths (from `project_locations`: path + device + developer + last seen), developers list with per-developer totals (breakdown by developer with the project filter), devices, session count, TokenMetricsGrid, TrendChart, recent sessions. Viewer-visible (`viewMonitoring`).

## Tests
Totals match H07 with the project filter · multiple developers on one project show separately (PRD §17) · a path-only project (no git remote) renders · search · 403 for guests.

## Validation
`php artisan test --filter=Projects && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build`.

## Acceptance criteria
AC19, AC32 · every PRD §46 field.

## Review checklist
Rollups for token metrics · no N+1 on counts · paths are displayed only to authenticated monitoring users.

## Commit
`feat(H14): project analytics pages`
