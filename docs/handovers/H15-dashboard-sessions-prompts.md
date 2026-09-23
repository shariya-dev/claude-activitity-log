# H15 — Sessions List, Session Detail, Prompt Viewing (PRD §16, §24, §47–48, §52)
Status: todo · Wave 4 · parallel with H11–H14, H16, H17 · Branch `handover/H15-dashboard-sessions`

## Objective
Filterable session list and session detail with token breakdown and per-message usage timeline, and permission-gated, audited prompt viewing.

## Read first
PRD §16, §24, §47, §48, §52, §54, `.claude/rules/privacy.md`, H07 `SessionSearch`, `FilterOptions`.

## Depends on
H07, H08.

## Owned files
`agent-dashboard/routes/dashboard/sessions.php` (replace placeholder), `app/Http/Controllers/Dashboard/SessionController.php`, `resources/js/pages/Sessions/**`, `tests/Feature/Dashboard/Sessions*Test.php`.

## Allowed dependencies
None.

## Behavior
- `sessions.index`: filters Developer, Device, Account, Project, Model, Date range, Search (`FilterOptions` for selects; `SessionSearch::paginate`). Columns per PRD §47: Developer, Project, Model, Device, Start, Duration, Token Activity, Actual Consumed, Last activity (+ status badge). Sortable: start, last activity, duration, token activity, actual consumed. Filters persist in the query string.
- `sessions.show` (`/sessions/{session}`): metadata (source session ID with copy, status, Claude Code version, entrypoint, git branch if present), Developer/Device/Account/Project/Model links, Start/End/Duration (end shows "—" plus a tooltip "Claude Code does not record an explicit end; last activity shown" when null), activity count, TokenMetricsGrid for the session, usage timeline table from `session_usage` (time, model, sidechain, input, output, cache creation, cache read, actual, total). Raw usage is allowed here (single session, indexed).
- Prompts: rendered only if `can.viewPrompts` **and** the session has messages. Use an Inertia v2 optional/lazy prop `messages` (`Inertia::optional(...)`) that loads only when the user clicks "Show prompts" (`router.reload({ only: ['messages'] })`). The closure calls `Gate::authorize('viewPrompts')` and `AuditLog::record('prompt.viewed', $session, ['count' => n])` before returning content. Show a banner "Sensitive: access is logged." If prompt tracking is currently OFF, show "Prompt tracking is disabled" (existing retained messages are still viewable with permission until retention purges them).

## Tests
List filters/sort/search · show props correct · viewer without `can_view_prompts`: `messages` never in props, and a forced partial reload ⇒ 403 · permitted user: messages load only on the partial reload and one `prompt.viewed` audit row per load · the initial page load never contains message content (assert the JSON response) · the end-time null case.

## Validation
`php artisan test --filter=Sessions && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build`.

## Acceptance criteria
AC18, AC33 · PRD §24 restrict + audit access · §48 all fields.

## Review checklist
Prompt content never in the initial props, logs, or audit metadata · authorization inside the lazy closure · sort whitelist.

## Commit
`feat(H15): session list, session detail and audited prompt viewing`
