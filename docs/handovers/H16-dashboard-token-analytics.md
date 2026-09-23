# H16 — Token Analytics Explorer (PRD §19–22)
Status: todo · Wave 4 · parallel with H11–H15, H17 · Branch `handover/H16-token-analytics`

## Objective
One page to slice token metrics by any dimension and period: filters for every dimension, a granularity switch, a group-by dimension, totals, trend, and breakdown, with an explanation of the calculation.

## Read first
PRD §19–22, H07 `TokenAnalytics`, `FilterOptions`, `Granularity`, `Dimension`, H08 components.

## Depends on
H07, H08.

## Owned files
`agent-dashboard/routes/dashboard/token-analytics.php` (replace placeholder), `app/Http/Controllers/Dashboard/TokenAnalyticsController.php`, `resources/js/pages/Analytics/**`, `tests/Feature/Dashboard/TokenAnalyticsTest.php`.

## Allowed dependencies
None.

## Behavior
`analytics.tokens` GET `/analytics/tokens?range=&from=&to=&developer=&device=&account=&project=&model=&granularity=day|week|month|year&group=developer|device|account|project|model&metric=total|actual|cache_read|input|output|cache_creation`.
Props: `range`, `filters`, `options` (FilterOptions for all dims), `granularity` (explicit or auto), `group`, `totals`, `trend`, `breakdown` (limit 25). UI: filter bar, TokenMetricsGrid, TrendChart with metric selector, BreakdownTable for the chosen group with share-of-total %, and a "How these numbers are calculated" panel: Total Token Activity = Input + Output + Cache Creation + Cache Read; Actual Consumed Tokens = Input + Output + Cache Creation (Cache Read excluded); "monitoring calculation, not an Anthropic billing or quota value" (PRD §20).

## Tests
Every dimension filter and every granularity returns consistent totals (sum of trend points == totals; sum of full breakdown == totals). Invalid group/metric/granularity ⇒ default, not 500. PRD §20 example seeded as a rollup ⇒ the page shows 650,000 / 150,000 / 500,000.

## Validation
`php artisan test --filter=TokenAnalytics && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build`.

## Acceptance criteria
AC23–AC26, AC34, AC35 · every PRD §22 axis and metric reachable.

## Review checklist
Consistency invariants tested · exact PRD labels · no billing wording.

## Commit
`feat(H16): token analytics explorer`
