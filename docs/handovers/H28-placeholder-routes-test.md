# H28 — Retire the Placeholder Assertions in PlaceholderRoutesTest
Status: done (9d3c9bf) · Follow-up (Wave 6 finding FU-3) · parallel with H26, H27, H29–H31 · Branch `handover/H28-placeholder-test`

## Objective
`php artisan test` on `main` is fully green. H08's `tests/Feature/Shell/PlaceholderRoutesTest.php` still expects the `Placeholder` page that Wave 4 replaced (23 failures).

## Owned files
`agent-dashboard/tests/Feature/Shell/PlaceholderRoutesTest.php` (and removing `Placeholder.vue` / `PlaceholderController` only if nothing references them any more).

## Allowed dependencies
None.

## Steps
Keep the route-name, guest-redirect and RBAC cases; drop the `Placeholder` component and "200 on `*.show` without a record" assertions. Do not weaken RBAC coverage.

## Validation
`cd agent-dashboard && npm run build && DB_DATABASE=claude_monitor_test_h28 php artisan test` fully green · `vendor/bin/pint --test` · `vendor/bin/phpstan analyse` · `npm run lint && npm run types`.

## Commit
`test(H28): align shell route tests with the Wave 4 pages`
