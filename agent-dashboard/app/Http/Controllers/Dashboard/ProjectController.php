<?php

namespace App\Http\Controllers\Dashboard;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Queries\Analytics\ActivityStats;
use App\Queries\Analytics\DateRange;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\FilterOptions;
use App\Queries\Analytics\SessionRows;
use App\Queries\Analytics\TokenAnalytics;
use App\Queries\Analytics\UsageFilters;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Project analytics (PRD §17, §46). Token metrics come from usage_daily_rollups,
 * counts from claude_sessions, paths from project_locations.
 */
class ProjectController extends Controller
{
    private const PER_PAGE = 25;

    /**
     * Sortable index columns mapped to their SQL expression.
     */
    private const SORTS = [
        'name' => 'p.name',
        'developers_count' => 'developers_count',
        'devices_count' => 'devices_count',
        'sessions_count' => 'sessions_count',
        'total_token_activity' => 'total_token_activity',
        'actual_consumed_tokens' => 'actual_consumed_tokens',
        'cache_read_tokens' => 'cache_read_tokens',
        'last_activity_at' => 'p.last_activity_at',
    ];

    private const DEFAULT_SORT = 'last_activity_at';

    private const TOKEN_COLUMNS = ['total_token_activity', 'actual_consumed_tokens', 'cache_read_tokens'];

    public function index(Request $request, FilterOptions $filterOptions): Response
    {
        Gate::authorize('viewMonitoring');

        $range = DateRange::fromRequest($request);
        $filters = new UsageFilters($range, developerId: UsageFilters::fromRequest($request)->developerId);
        $search = $this->search($request);
        $sort = array_key_exists((string) $request->query('sort'), self::SORTS) ? (string) $request->query('sort') : self::DEFAULT_SORT;
        $direction = $request->query('dir') === 'asc' ? 'asc' : 'desc';

        $projects = $this->projectRows($filters, $search)
            ->orderBy(self::SORTS[$sort], $direction)
            ->orderBy('p.id', $direction)
            ->paginate(self::PER_PAGE)
            ->withQueryString()
            ->through(fn (object $row): array => [
                'id' => (int) $row->id,
                'name' => (string) $row->name,
                'git_remote' => $row->git_remote === null ? null : (string) $row->git_remote,
                'developers_count' => (int) $row->developers_count,
                'devices_count' => (int) $row->devices_count,
                'sessions_count' => (int) $row->sessions_count,
                ...$this->tokenColumns($row),
                'last_activity_at' => $this->iso($row->last_activity_at),
            ]);

        return Inertia::render('Projects/Index', [
            'range' => $range->toArray(),
            'filters' => ['search' => $search, 'developer' => $filters->developerId],
            'filterOptions' => $filterOptions->for([Dimension::Developer]),
            'sort' => $sort,
            'direction' => $direction,
            'projects' => $projects,
        ]);
    }

    public function show(Request $request, Project $project, TokenAnalytics $analytics, ActivityStats $activity): Response
    {
        Gate::authorize('viewMonitoring');

        $range = DateRange::fromRequest($request);
        $filters = new UsageFilters($range, projectId: $project->id);

        return Inertia::render('Projects/Show', [
            'project' => [
                'id' => $project->id,
                'name' => $project->name,
                'git_remote' => $project->git_remote,
                'first_activity_at' => $this->iso($project->first_activity_at),
                'last_activity_at' => $this->iso($project->last_activity_at),
            ],
            'range' => $range->toArray(),
            'totals' => $analytics->totals($filters),
            'trend' => $analytics->trend($filters),
            'sessionsCount' => $activity->sessionsCount($filters),
            'paths' => $this->paths($project),
            'developers' => $this->developers($filters, $analytics),
            'devices' => $this->devices($filters, $analytics),
            'recentSessions' => $activity->recentSessions($filters),
        ]);
    }

    /**
     * One row per project: range token sums (rollups) and range session count, both scoped by the developer filter,
     * plus project-wide distinct developer/device counts. Each figure is a grouped subquery, so the page runs a fixed
     * number of queries regardless of page size.
     */
    private function projectRows(UsageFilters $filters, string $search): Builder
    {
        $tokens = $filters->applyDimensions(DB::table('usage_daily_rollups as r'), 'r')
            ->whereBetween('r.date', [$filters->range->startDate(), $filters->range->endDate()])
            ->whereNotNull('r.project_id')
            ->groupBy('r.project_id')
            ->select('r.project_id')
            ->selectRaw(implode(', ', array_map(fn (string $column): string => "SUM(r.{$column}) as {$column}", self::TOKEN_COLUMNS)));

        $sessions = SessionRows::startedIn($filters->applyDimensions(DB::table('claude_sessions as s'), 's'), $filters->range)
            ->whereNotNull('s.project_id')
            ->groupBy('s.project_id')
            ->selectRaw('s.project_id, COUNT(*) as sessions_count');

        $people = DB::table('claude_sessions as s')
            ->whereNotNull('s.project_id')
            ->groupBy('s.project_id')
            ->selectRaw('s.project_id, COUNT(DISTINCT s.developer_id) as developers_count, COUNT(DISTINCT s.device_id) as devices_count');

        $query = DB::table('projects as p')
            ->leftJoinSub($tokens, 't', 't.project_id', '=', 'p.id')
            ->leftJoinSub($sessions, 'sc', 'sc.project_id', '=', 'p.id')
            ->leftJoinSub($people, 'pc', 'pc.project_id', '=', 'p.id')
            ->select(['p.id', 'p.name', 'p.git_remote', 'p.last_activity_at'])
            ->selectRaw('COALESCE(pc.developers_count, 0) as developers_count, COALESCE(pc.devices_count, 0) as devices_count')
            ->selectRaw('COALESCE(sc.sessions_count, 0) as sessions_count')
            ->selectRaw(implode(', ', array_map(fn (string $column): string => "COALESCE(t.{$column}, 0) as {$column}", self::TOKEN_COLUMNS)));

        if ($filters->developerId !== null) {
            $query->whereExists(fn (Builder $exists) => $exists->selectRaw('1')
                ->from('claude_sessions as ds')
                ->whereColumn('ds.project_id', 'p.id')
                ->where('ds.developer_id', $filters->developerId));
        }

        if ($search !== '') {
            $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search).'%';

            $query->where(fn (Builder $matches) => $matches
                ->where('p.name', 'like', $like)
                ->orWhere('p.git_remote', 'like', $like)
                ->orWhereExists(fn (Builder $exists) => $exists->selectRaw('1')
                    ->from('project_locations as pl')
                    ->whereColumn('pl.project_id', 'p.id')
                    ->where('pl.path', 'like', $like)));
        }

        return $query;
    }

    /**
     * @return list<array{id: int, path: string, device: string, device_uid: string, developer: string, first_seen_at: string|null, last_seen_at: string|null}>
     */
    private function paths(Project $project): array
    {
        return DB::table('project_locations as pl')
            ->join('devices as dv', 'dv.id', '=', 'pl.device_id')
            ->join('developers as dev', 'dev.id', '=', 'dv.developer_id')
            ->where('pl.project_id', $project->id)
            ->orderByDesc('pl.last_seen_at')
            ->orderBy('pl.id')
            ->get(['pl.id', 'pl.path', 'dv.hostname', 'dv.device_uid', 'dev.name as developer', 'pl.first_seen_at', 'pl.last_seen_at'])
            ->map(fn (object $row): array => [
                'id' => (int) $row->id,
                'path' => (string) $row->path,
                'device' => (string) ($row->hostname ?? $row->device_uid),
                'device_uid' => (string) $row->device_uid,
                'developer' => (string) $row->developer,
                'first_seen_at' => $this->iso($row->first_seen_at),
                'last_seen_at' => $this->iso($row->last_seen_at),
            ])
            ->values()
            ->all();
    }

    /**
     * Every developer who has worked on the project, with range session counts and range token totals.
     *
     * @return list<array{id: int, name: string, email: string, sessions_count: int, last_activity_at: string|null, total_token_activity: int, actual_consumed_tokens: int, cache_read_tokens: int}>
     */
    private function developers(UsageFilters $filters, TokenAnalytics $analytics): array
    {
        $rows = $this->participants($filters, 'developer_id')
            ->join('developers as dev', 'dev.id', '=', 's.developer_id')
            ->groupBy('dev.name', 'dev.email')
            ->addSelect(['dev.name', 'dev.email'])
            ->get();

        $tokens = $this->tokensBy($filters, $analytics, Dimension::Developer, $rows->count());

        return $this->ranked($rows->map(fn (object $row): array => [
            'id' => (int) $row->id,
            'name' => (string) $row->name,
            'email' => (string) $row->email,
            'sessions_count' => (int) $row->sessions_count,
            'last_activity_at' => $this->iso($row->last_activity_at),
            ...($tokens[(int) $row->id] ?? $this->tokenColumns(null)),
        ])->all());
    }

    /**
     * Every device the project has been used on, with range session counts and range token totals.
     *
     * @return list<array{id: int, device_uid: string, label: string, platform: string, developer: string, sessions_count: int, last_activity_at: string|null, total_token_activity: int, actual_consumed_tokens: int, cache_read_tokens: int}>
     */
    private function devices(UsageFilters $filters, TokenAnalytics $analytics): array
    {
        $rows = $this->participants($filters, 'device_id')
            ->join('devices as dv', 'dv.id', '=', 's.device_id')
            ->join('developers as dev', 'dev.id', '=', 'dv.developer_id')
            ->groupBy('dv.device_uid', 'dv.hostname', 'dv.platform', 'dev.name')
            ->addSelect(['dv.device_uid', 'dv.hostname', 'dv.platform', 'dev.name as developer'])
            ->get();

        $tokens = $this->tokensBy($filters, $analytics, Dimension::Device, $rows->count());

        return $this->ranked($rows->map(fn (object $row): array => [
            'id' => (int) $row->id,
            'device_uid' => (string) $row->device_uid,
            'label' => (string) ($row->hostname ?? $row->device_uid),
            'platform' => (string) $row->platform,
            'developer' => (string) $row->developer,
            'sessions_count' => (int) $row->sessions_count,
            'last_activity_at' => $this->iso($row->last_activity_at),
            ...($tokens[(int) $row->id] ?? $this->tokenColumns(null)),
        ])->all());
    }

    /**
     * The project's sessions grouped by $column (all time), counting those started inside the range.
     */
    private function participants(UsageFilters $filters, string $column): Builder
    {
        return DB::table('claude_sessions as s')
            ->where('s.project_id', $filters->projectId)
            ->groupBy("s.{$column}")
            ->selectRaw(
                "s.{$column} as id, SUM(CASE WHEN s.started_at BETWEEN ? AND ? THEN 1 ELSE 0 END) as sessions_count, MAX(s.last_activity_at) as last_activity_at",
                [$filters->range->start->utc(), $filters->range->end->utc()],
            );
    }

    /**
     * Range token totals for the project keyed by dimension id, via the H07 breakdown.
     *
     * @return array<int, array{total_token_activity: int, actual_consumed_tokens: int, cache_read_tokens: int}>
     */
    private function tokensBy(UsageFilters $filters, TokenAnalytics $analytics, Dimension $dimension, int $count): array
    {
        $tokens = [];

        foreach ($analytics->breakdown($filters, $dimension, max(1, $count)) as $row) {
            if ($row['id'] !== null) {
                $tokens[$row['id']] = $this->tokenColumns((object) $row);
            }
        }

        return $tokens;
    }

    /**
     * Highest range activity first, then most recent activity.
     *
     * @template TRow of array{total_token_activity: int, last_activity_at: string|null}
     *
     * @param  array<array-key, TRow>  $rows
     * @return list<TRow>
     */
    private function ranked(array $rows): array
    {
        usort($rows, fn (array $a, array $b): int => [$b['total_token_activity'], $b['last_activity_at'] ?? '']
            <=> [$a['total_token_activity'], $a['last_activity_at'] ?? '']);

        return $rows;
    }

    /**
     * @return array{total_token_activity: int, actual_consumed_tokens: int, cache_read_tokens: int}
     */
    private function tokenColumns(?object $row): array
    {
        return [
            'total_token_activity' => (int) ($row->total_token_activity ?? 0),
            'actual_consumed_tokens' => (int) ($row->actual_consumed_tokens ?? 0),
            'cache_read_tokens' => (int) ($row->cache_read_tokens ?? 0),
        ];
    }

    private function search(Request $request): string
    {
        $search = $request->query('search');

        return is_string($search) ? mb_substr(trim($search), 0, 191) : '';
    }

    /**
     * Stored UTC timestamp (string from the query builder or a cast Carbon) as ISO-8601 Zulu.
     */
    private function iso(CarbonInterface|string|null $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $utc = $value instanceof CarbonInterface ? CarbonImmutable::instance($value)->utc() : CarbonImmutable::parse($value, 'UTC');

        return $utc->format('Y-m-d\TH:i:s\Z');
    }
}
