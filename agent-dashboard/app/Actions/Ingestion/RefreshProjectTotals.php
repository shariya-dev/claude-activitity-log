<?php

namespace App\Actions\Ingestion;

use App\Support\OrgClock;
use Illuminate\Support\Facades\DB;

/**
 * Refreshes the denormalized project columns (session count, token sums, activity span) from `claude_sessions`.
 */
class RefreshProjectTotals
{
    private const CHUNK = 1000;

    /**
     * @param  array<int, int>  $projectIds
     */
    public function handle(array $projectIds): void
    {
        $now = OrgClock::now();

        foreach (array_chunk(array_values(array_unique($projectIds)), self::CHUNK) as $ids) {
            $in = implode(',', array_fill(0, count($ids), '?'));

            DB::update(
                <<<SQL
                UPDATE projects p
                LEFT JOIN (
                    SELECT project_id,
                        COUNT(*) AS session_count,
                        SUM(input_tokens) AS input_tokens,
                        SUM(output_tokens) AS output_tokens,
                        SUM(cache_creation_tokens) AS cache_creation_tokens,
                        SUM(cache_read_tokens) AS cache_read_tokens,
                        SUM(actual_consumed_tokens) AS actual_consumed_tokens,
                        SUM(total_token_activity) AS total_token_activity,
                        MIN(started_at) AS first_activity_at,
                        MAX(last_activity_at) AS last_activity_at
                    FROM claude_sessions
                    WHERE project_id IN ({$in})
                    GROUP BY project_id
                ) s ON s.project_id = p.id
                SET p.session_count = COALESCE(s.session_count, 0),
                    p.input_tokens = COALESCE(s.input_tokens, 0),
                    p.output_tokens = COALESCE(s.output_tokens, 0),
                    p.cache_creation_tokens = COALESCE(s.cache_creation_tokens, 0),
                    p.cache_read_tokens = COALESCE(s.cache_read_tokens, 0),
                    p.actual_consumed_tokens = COALESCE(s.actual_consumed_tokens, 0),
                    p.total_token_activity = COALESCE(s.total_token_activity, 0),
                    p.first_activity_at = COALESCE(s.first_activity_at, p.first_activity_at),
                    p.last_activity_at = COALESCE(s.last_activity_at, p.last_activity_at),
                    p.updated_at = ?
                WHERE p.id IN ({$in})
                SQL,
                [...$ids, $now, ...$ids],
            );
        }
    }
}
