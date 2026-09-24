# H34 — Dashboard Login Only
Status: done (6d17fa3) · Follow-up (user request 2026-09-24) · solo · Branch `handover/H34-login-only`

## Objective
The dashboard's only public entry is email + password login. After login the user lands on the dashboard (`/dashboard`). Users are created only by admins (Users page, H17) or `php artisan monitor:create-admin` (H08), so self-registration, email verification, password reset, passkey login and two-factor challenge are removed.

## Owned files
agent-dashboard: `config/fortify.php` · `app/Providers/FortifyServiceProvider.php` · `app/Actions/Fortify/**` · `app/Models/User.php` (interfaces/traits only) · `app/Http/Controllers/Settings/**` · `routes/web.php` · `routes/settings.php` · the auth route group in `bootstrap/app.php` (`verified` only) · `resources/js/pages/auth/**` · `resources/js/pages/Welcome.vue` · `resources/js/pages/settings/**` · `resources/js/components/{PasskeyVerify,…}.vue` and layouts/nav that link to removed routes · `tests/Feature/Auth/**` · `tests/Feature/Settings/**` · `tests/Feature/DashboardTest.php` / `ExampleTest.php`

## Steps (TDD)
1. Tests first: `/register`, `/forgot-password`, `/reset-password/*`, `/email/verify*`, passkey login and two-factor routes are 404; guest `GET /` → redirect to login; authenticated `GET /` and successful login → `/dashboard`; a user with `email_verified_at = null` can log in and reach the dashboard; `EnsureUserIsActive` still blocks inactive users; login page has no sign-up / forgot-password / passkey UI.
2. Disable the Fortify features; drop `MustVerifyEmail` and the `verified` middleware; remove the pages, components, settings sections (keep profile + password change + appearance) and dead Wayfinder route imports.
3. Keep the `email_verified_at` column (no migration).

## Validation
`cd agent-dashboard && npm run build && DB_DATABASE=claude_monitor_test_h34 php artisan test` (full, green) · `vendor/bin/pint --test` · `vendor/bin/phpstan analyse` · `npm run lint` · `npm run types`.

## Commit
`feat(H34): login-only dashboard authentication`
