<?php

namespace App\Queries\Analytics;

use App\Enums\DeveloperStatus;
use App\Models\Developer;
use Illuminate\Support\Facades\DB;

/**
 * Activity counts from claude_sessions, devices and developers (no token aggregation here).
 *
 * @phpstan-import-type SessionRow from SessionRows
 */
final class ActivityStats
{
    /**
     * Active, non-deleted developers.
     */
    public function totalDevelopers(): int
    {
        return Developer::query()->where('status', DeveloperStatus::Active)->count();
    }

    /**
     * Devices whose agent was last seen inside the range, or that had session activity overlapping it.
     * last_seen_at alone only holds the latest heartbeat, so past ranges also need the session history.
     */
    public function activeDevices(DateRange $r): int
    {
        $start = $r->start->utc();
        $end = $r->end->utc();

        return DB::table('devices as dv')
            ->whereBetween('dv.last_seen_at', [$start, $end])
            ->orWhereExists(fn ($sessions) => $sessions->selectRaw('1')
                ->from('claude_sessions as s')
                ->whereColumn('s.device_id', 'dv.id')
                ->where('s.last_activity_at', '>=', $start)
                ->where('s.started_at', '<=', $end))
            ->count();
    }

    /**
     * Sessions started inside the range, with the dimension filters applied.
     */
    public function sessionsCount(UsageFilters $f): int
    {
        $query = $f->applyDimensions(DB::table('claude_sessions as s'), 's');

        return SessionRows::startedIn($query, $f->range)->count();
    }

    /**
     * Distinct projects with session activity overlapping the range.
     */
    public function activeProjects(DateRange $r): int
    {
        return DB::table('claude_sessions')
            ->whereNotNull('project_id')
            ->where('last_activity_at', '>=', $r->start->utc())
            ->where('started_at', '<=', $r->end->utc())
            ->distinct()
            ->count('project_id');
    }

    /**
     * Sessions active during the range (overlapping it), most recent activity first.
     *
     * @return list<SessionRow>
     */
    public function recentSessions(UsageFilters $f, int $limit = 10): array
    {
        return SessionRows::query($f)
            ->where('s.last_activity_at', '>=', $f->range->start->utc())
            ->where('s.started_at', '<=', $f->range->end->utc())
            ->orderByDesc('s.last_activity_at')
            ->orderByDesc('s.id')
            ->limit(max(1, $limit))
            ->get()
            ->map(fn (object $row): array => SessionRows::map($row))
            ->values()
            ->all();
    }
}
