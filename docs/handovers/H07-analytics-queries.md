# H07 — Analytics Query Layer
Status: todo · Wave 3 · parallel with H05, H06, H08–H10 · Branch `handover/H07-analytics-queries`

## Objective
The read side every dashboard page uses: date-range parsing, filters, token totals/trends/breakdowns from rollups, activity stats, agent health, and session search. Pure PHP query objects returning plain arrays; no controllers or pages.

## Read first
`data-model.md` (rollups, claude_sessions indexes), `backend.md` §3, PRD §22, §43–50, §57.

## Depends on
H04. (Tests seed rollups/sessions with factories, not ingestion.)

## Owned files
`agent-dashboard/app/Queries/Analytics/**`, `tests/Feature/Analytics/**`.

## Interfaces produced (exact; Wave 4 codes against these)
```php
namespace App\Queries\Analytics;

final class DateRange {
    public function __construct(public readonly CarbonImmutable $start, public readonly CarbonImmutable $end, public readonly string $preset) {}
    // presets: today|yesterday|week|month|year|custom ; org timezone; week starts Monday; custom needs from/to (Y-m-d), max 3 years
    public static function fromRequest(Request $r, string $default = 'week'): self;   // query params: range, from, to
    public static function preset(string $preset, ?CarbonImmutable $now = null): self;
    public function startDate(): string; public function endDate(): string;            // Y-m-d, inclusive, org tz
    public function toArray(): array;                                                  // {preset, from, to} for Inertia
}
final class UsageFilters {
    public function __construct(public readonly DateRange $range, public readonly ?int $developerId = null, public readonly ?int $deviceId = null,
        public readonly ?int $accountId = null, public readonly ?int $projectId = null, public readonly ?int $modelId = null) {}
    public static function fromRequest(Request $r): self;   // developer, device, account, project, model query params (ids)
}
enum Granularity: string { case Day='day'; case Week='week'; case Month='month'; case Year='year';
    public static function auto(DateRange $r): self; }     // ≤ 45 days → day, ≤ 26 weeks → week, ≤ 3 years → month, else year
enum Dimension: string { case Developer='developer'; case Device='device'; case Account='account'; case Project='project'; case Model='model'; }

final class TokenAnalytics {
    /** @return array{input_tokens:int,output_tokens:int,cache_creation_tokens:int,cache_read_tokens:int,actual_consumed_tokens:int,total_token_activity:int,message_count:int} */
    public function totals(UsageFilters $f): array;
    /** @return list<array{period:string,label:string}&TokenTotals> ; zero-filled periods */
    public function trend(UsageFilters $f, ?Granularity $g = null): array;
    /** @return list<array{id:int|null,label:string}&TokenTotals> ordered by total_token_activity desc */
    public function breakdown(UsageFilters $f, Dimension $by, int $limit = 10): array;
}
final class ActivityStats {
    public function totalDevelopers(): int;                                 // active developers
    public function activeDevices(DateRange $r): int;                       // devices with last_seen_at in range
    public function sessionsCount(UsageFilters $f): int;                    // claude_sessions started in range + filters
    public function activeProjects(DateRange $r): int;                      // projects with activity in range
    /** @return list<array{id:int,source_session_id:string,developer:string,project:?string,model:?string,device:string,started_at:string,last_activity_at:string,duration_seconds:int,actual_consumed_tokens:int,total_token_activity:int}> */
    public function recentSessions(UsageFilters $f, int $limit = 10): array;
}
final class AgentHealth {
    /** @return array{online:int,stale:int,offline:int,disabled:int,uninstalled:int,outdated:int,sync_failed:int} */
    public function summary(): array;
    /** @return list<array{device_id:int,device_uid:string,hostname:?string,developer:string,platform:string,agent_version:?string,last_seen_at:?string,last_sync_at:?string,connection:string,health:string,outdated:bool}> */
    public function problemAgents(int $limit = 20): array;                   // stale/offline/sync_failed/outdated, oldest first
}
final class SessionSearch {
    /** filters + ?search (source_session_id prefix, project name, developer name/email) ; returns LengthAwarePaginator of the recentSessions row shape */
    public function paginate(UsageFilters $f, ?string $search, int $perPage = 25, string $sort = 'started_at', string $dir = 'desc'): LengthAwarePaginator;
}
final class FilterOptions {
    /** @param list<Dimension> $dims  @return array<string, list<array{id:int,label:string}>> keyed by dimension value; developers "Name <email>", devices "hostname (platform)", accounts email|display_name|"Account #id", projects name, models name */
    public function for(array $dims): array;
}
```
"TokenTotals" = the 7 keys of `totals()`. Token metrics come only from `usage_daily_rollups`. Counts come from `claude_sessions`/`devices`.

## Tests
Fixed clock (`Carbon::setTestNow('2026-09-22 10:00:00', 'Asia/Dhaka')`). Presets produce the right org-tz boundaries (week = Mon 2026-09-21…Sun 09-27); custom validation; totals equal the sum of seeded rollups under every filter combination; trend zero-fills gaps and buckets weeks/months correctly; breakdown ordering, limit, and the null-dimension label "Unknown"; sessionsCount respects filters; AgentHealth classifies online/stale/offline/outdated at thresholds; SessionSearch search + sort whitelist (invalid sort ⇒ default). Query-count assertions: `totals`/`trend`/`breakdown` ≤ 2 queries each.

## Validation
`php artisan test --filter=Analytics && vendor/bin/pint --test && vendor/bin/phpstan analyse`. Paste `EXPLAIN` of the trend and breakdown queries showing index use.

## Acceptance criteria
Covers every aggregation axis in PRD §22 (developer, device, account, project, session via SessionSearch/session row, model, day/week/month/year/custom) and every metric.

## Review checklist
No raw `session_usage` aggregation · org timezone everywhere · sort/filter inputs whitelisted · signatures exactly as above.

## Commit
`feat(H07): analytics query layer for token metrics, activity, agent health and sessions`
