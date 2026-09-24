<?php

namespace App\Queries\Analytics;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Shared claude_sessions list query and row shape for ActivityStats::recentSessions() and SessionSearch.
 * Session token columns are the per-session totals maintained by ingestion; no session_usage aggregation.
 *
 * @internal
 *
 * @phpstan-type SessionRow array{id: int, source_session_id: string, developer: string, project: string|null, model: string|null, device: string, started_at: string, last_activity_at: string, duration_seconds: int, actual_consumed_tokens: int, total_token_activity: int}
 */
final class SessionRows
{
    /**
     * Sessions joined to their labels, with the dimension filters applied (no date condition).
     */
    public static function query(UsageFilters $f): Builder
    {
        $query = DB::table('claude_sessions as s')
            ->join('developers as dev', 'dev.id', '=', 's.developer_id')
            ->join('devices as dv', 'dv.id', '=', 's.device_id')
            ->leftJoin('projects as p', 'p.id', '=', 's.project_id')
            ->leftJoin('claude_models as m', 'm.id', '=', 's.claude_model_id')
            ->select([
                's.id', 's.source_session_id', 'dev.name as developer', 'p.name as project', 'm.name as model',
                'dv.hostname', 'dv.device_uid', 's.started_at', 's.last_activity_at', 's.duration_seconds',
                's.actual_consumed_tokens', 's.total_token_activity',
            ]);

        return $f->applyDimensions($query, 's');
    }

    /**
     * Restrict to sessions whose start time falls inside the range (org-tz day boundaries, stored UTC).
     */
    public static function startedIn(Builder $query, DateRange $range, string $table = 's'): Builder
    {
        return $query->whereBetween("{$table}.started_at", [$range->start->utc(), $range->end->utc()]);
    }

    /**
     * @return SessionRow
     */
    public static function map(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'source_session_id' => (string) $row->source_session_id,
            'developer' => (string) $row->developer,
            'project' => $row->project === null ? null : (string) $row->project,
            'model' => $row->model === null ? null : (string) $row->model,
            'device' => (string) ($row->hostname ?? $row->device_uid),
            'started_at' => self::iso((string) $row->started_at),
            'last_activity_at' => self::iso((string) $row->last_activity_at),
            'duration_seconds' => (int) $row->duration_seconds,
            'actual_consumed_tokens' => (int) $row->actual_consumed_tokens,
            'total_token_activity' => (int) $row->total_token_activity,
        ];
    }

    public static function iso(string $utcTimestamp): string
    {
        return CarbonImmutable::parse($utcTimestamp, 'UTC')->format('Y-m-d\TH:i:s\Z');
    }
}
