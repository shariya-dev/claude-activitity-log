<?php

namespace App\Http\Controllers\Dashboard;

use App\Enums\DeveloperStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Dashboard\StoreDeveloperRequest;
use App\Http\Requests\Dashboard\UpdateDeveloperRequest;
use App\Models\AuditLog;
use App\Models\ClaudeAccount;
use App\Models\Developer;
use App\Models\Device;
use App\Queries\Analytics\ActivityStats;
use App\Queries\Analytics\DateRange;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\TokenAnalytics;
use App\Queries\Analytics\UsageFilters;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Developer identities (PRD §10, §44–45): list, create/edit/deactivate and the per-developer dashboard.
 * Developers are never deleted here; deactivation is `status=inactive` and keeps all history.
 */
class DeveloperController extends Controller
{
    private const PER_PAGE = 25;

    /**
     * Filter dimensions offered on the detail page; the developer dimension is fixed by the route.
     */
    private const DETAIL_DIMENSIONS = [Dimension::Device, Dimension::Account, Dimension::Project, Dimension::Model];

    public function index(Request $request): Response
    {
        $range = DateRange::fromRequest($request);
        $search = is_string($request->query('search')) ? trim($request->query('search')) : '';
        $status = is_string($request->query('status')) ? DeveloperStatus::tryFrom($request->query('status')) : null;

        $developers = Developer::query()
            ->select(['developers.id', 'developers.name', 'developers.email', 'developers.team', 'developers.status'])
            ->withCount([
                'devices',
                'claudeAccounts',
                'sessions' => fn (Builder $sessions) => $sessions->whereBetween('started_at', [$range->start->utc(), $range->end->utc()]),
            ])
            ->selectSub($this->rangeRollupSum('actual_consumed_tokens', $range), 'actual_consumed_tokens')
            ->selectSub($this->rangeRollupSum('total_token_activity', $range), 'total_token_activity')
            ->selectSub(
                DB::table('claude_sessions as s')->selectRaw('MAX(s.last_activity_at)')->whereColumn('s.developer_id', 'developers.id'),
                'last_activity_at',
            )
            ->selectSub(
                DB::table('devices as dv')->selectRaw('MAX(dv.last_sync_at)')->whereColumn('dv.developer_id', 'developers.id'),
                'last_sync_at',
            )
            ->when($search !== '', function (Builder $query) use ($search): void {
                $like = '%'.addcslashes($search, '\\%_').'%';

                $query->where(fn (Builder $match) => $match
                    ->where('developers.name', 'like', $like)
                    ->orWhere('developers.email', 'like', $like)
                    ->orWhere('developers.team', 'like', $like));
            })
            ->when($status !== null, fn (Builder $query) => $query->where('developers.status', $status))
            ->orderBy('developers.name')
            ->orderBy('developers.id')
            ->paginate(self::PER_PAGE)
            ->withQueryString()
            ->through(fn (Developer $developer): array => [
                'id' => $developer->id,
                'name' => $developer->name,
                'email' => $developer->email,
                'team' => $developer->team,
                'status' => $developer->status->value,
                'devices_count' => (int) $developer->getAttribute('devices_count'),
                'claude_accounts_count' => (int) $developer->getAttribute('claude_accounts_count'),
                'sessions_count' => (int) $developer->getAttribute('sessions_count'),
                'actual_consumed_tokens' => (int) $developer->getAttribute('actual_consumed_tokens'),
                'total_token_activity' => (int) $developer->getAttribute('total_token_activity'),
                'last_activity_at' => $this->iso($developer->getAttribute('last_activity_at')),
                'last_sync_at' => $this->iso($developer->getAttribute('last_sync_at')),
            ]);

        return Inertia::render('Developers/Index', [
            'developers' => $developers,
            'filters' => [
                'search' => $search === '' ? null : $search,
                'status' => $status?->value,
            ],
            'range' => $range->toArray(),
        ]);
    }

    public function store(StoreDeveloperRequest $request): RedirectResponse
    {
        $developer = DB::transaction(function () use ($request): Developer {
            $developer = Developer::create([
                ...$request->safe()->only(['name', 'email', 'team']),
                'status' => DeveloperStatus::Active,
            ]);

            AuditLog::record('developer.created', $developer, ['after' => $this->auditable($developer)]);

            return $developer;
        });

        return to_route('developers.show', $developer)->with('success', 'Developer created.');
    }

    public function update(UpdateDeveloperRequest $request, Developer $developer): RedirectResponse
    {
        $before = $this->auditable($developer);
        $developer->fill($request->safe()->only(['name', 'email', 'team', 'status']));

        if (! $developer->isDirty()) {
            return back()->with('success', 'No changes to save.');
        }

        $action = match (true) {
            ! $developer->isDirty('status') => 'developer.updated',
            $developer->status === DeveloperStatus::Inactive => 'developer.deactivated',
            default => 'developer.reactivated',
        };

        DB::transaction(function () use ($developer, $before, $action): void {
            $developer->save();
            $after = $this->auditable($developer);
            $changed = array_keys(array_diff_assoc($after, $before));

            AuditLog::record($action, $developer, [
                'before' => array_intersect_key($before, array_flip($changed)),
                'after' => array_intersect_key($after, array_flip($changed)),
            ]);
        });

        return back()->with('success', match ($action) {
            'developer.deactivated' => 'Developer deactivated. Devices and history are kept.',
            'developer.reactivated' => 'Developer reactivated.',
            default => 'Developer updated.',
        });
    }

    public function show(Request $request, Developer $developer, TokenAnalytics $tokens, ActivityStats $activity): Response
    {
        $requested = UsageFilters::fromRequest($request);
        $filters = new UsageFilters(
            $requested->range,
            $developer->id,
            $requested->deviceId,
            $requested->accountId,
            $requested->projectId,
            $requested->modelId,
        );

        $devices = $developer->devices()->orderBy('hostname')->orderBy('id')->get();
        $accounts = $developer->claudeAccounts()
            ->with(['devices' => fn ($query) => $query->select(['devices.id', 'devices.device_uid', 'devices.hostname'])->orderBy('devices.hostname')])
            ->orderByDesc('last_seen_at')
            ->orderBy('id')
            ->get();

        return Inertia::render('Developers/Show', [
            'developer' => [
                'id' => $developer->id,
                'name' => $developer->name,
                'email' => $developer->email,
                'team' => $developer->team,
                'status' => $developer->status->value,
                'created_at' => $this->iso($developer->created_at),
                'last_activity_at' => $this->iso($developer->sessions()->max('last_activity_at')),
                'last_sync_at' => $this->iso($devices->max('last_sync_at')),
            ],
            'range' => $filters->range->toArray(),
            'filters' => [
                'device' => $filters->deviceId,
                'account' => $filters->accountId,
                'project' => $filters->projectId,
                'model' => $filters->modelId,
            ],
            'filterOptions' => $this->filterOptions($developer),
            'totals' => $tokens->totals($filters),
            'sessionsCount' => $activity->sessionsCount($filters),
            'trend' => $tokens->trend($filters),
            'breakdowns' => collect(self::DETAIL_DIMENSIONS)
                ->mapWithKeys(fn (Dimension $dimension): array => [$dimension->value => $tokens->breakdown($filters, $dimension)])
                ->all(),
            'devices' => $devices->map(fn (Device $device): array => [
                'id' => $device->id,
                'device_uid' => $device->device_uid,
                'hostname' => $device->hostname,
                'platform' => $device->platform,
                'platform_version' => $device->platform_version,
                'architecture' => $device->architecture,
                'agent_version' => $device->agent_version,
                'claude_code_version' => $device->claude_code_version,
                'status' => $device->status->value,
                'connection' => $device->connectionState()->value,
                'last_seen_at' => $this->iso($device->last_seen_at),
                'last_sync_at' => $this->iso($device->last_sync_at),
            ])->values()->all(),
            'accounts' => $accounts->map(fn (ClaudeAccount $account): array => [
                'id' => $account->id,
                'email' => $account->email,
                'display_name' => $account->display_name,
                'status' => $account->status,
                'first_seen_at' => $this->iso($account->first_seen_at),
                'last_seen_at' => $this->iso($account->last_seen_at),
                'devices' => $account->devices->map(fn (Device $device): array => [
                    'device_uid' => $device->device_uid,
                    'label' => $device->hostname ?? $device->device_uid,
                ])->values()->all(),
            ])->values()->all(),
            'recentSessions' => $activity->recentSessions($filters),
            'pairingCodeTtlMinutes' => (int) config('monitor.pairing_code_ttl_minutes'),
        ]);
    }

    /**
     * Range-scoped SUM of one rollup metric for the outer `developers` row (org-tz dates, inclusive).
     */
    private function rangeRollupSum(string $metric, DateRange $range): QueryBuilder
    {
        return DB::table('usage_daily_rollups as r')
            ->selectRaw("COALESCE(SUM(r.{$metric}), 0)")
            ->whereColumn('r.developer_id', 'developers.id')
            ->whereBetween('r.date', [$range->startDate(), $range->endDate()]);
    }

    /**
     * Filter options limited to what this developer has: own devices and accounts, and the projects
     * and models that appear in their usage or sessions. One query per dimension.
     *
     * @return array<string, list<array{id: int, label: string}>>
     */
    private function filterOptions(Developer $developer): array
    {
        $options = [];

        foreach (self::DETAIL_DIMENSIONS as $dimension) {
            $query = DB::table($dimension->table().' as d')
                ->selectRaw('d.id as id, '.$dimension->labelSql('d').' as label');

            if (in_array($dimension, [Dimension::Device, Dimension::Account], true)) {
                $query->where('d.developer_id', $developer->id);
            } else {
                $column = $dimension->column();
                $query->whereIn('d.id', DB::table('usage_daily_rollups')
                    ->select($column)
                    ->where('developer_id', $developer->id)
                    ->whereNotNull($column)
                    ->union(DB::table('claude_sessions')->select($column)->where('developer_id', $developer->id)->whereNotNull($column)));
            }

            $options[$dimension->value] = $query->orderBy('label')->orderBy('d.id')->get()
                ->map(fn (object $row): array => ['id' => (int) $row->id, 'label' => (string) $row->label])
                ->values()
                ->all();
        }

        return $options;
    }

    /**
     * @return array{name: string, email: string, team: string|null, status: string}
     */
    private function auditable(Developer $developer): array
    {
        return [
            'name' => $developer->name,
            'email' => $developer->email,
            'team' => $developer->team,
            'status' => $developer->status->value,
        ];
    }

    /**
     * ISO-8601 UTC for Eloquent dates or raw UTC timestamps from aggregate subqueries.
     */
    private function iso(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $date = $value instanceof CarbonInterface
            ? CarbonImmutable::instance($value)
            : CarbonImmutable::parse((string) $value, 'UTC');

        return $date->utc()->format('Y-m-d\TH:i:s\Z');
    }
}
