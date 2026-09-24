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
     * Devices whose agent was last seen inside the range.
     */
    public function activeDevices(DateRange $r): int
    {
        return DB::table('devices')
            ->whereBetween('last_seen_at', [$r->start->utc(), $r->end->utc()])
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
