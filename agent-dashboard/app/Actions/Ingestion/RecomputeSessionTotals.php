<?php

namespace App\Actions\Ingestion;

use App\Enums\SessionStatus;
use App\Support\OrgClock;
use Illuminate\Support\Facades\DB;

/**
 * Recomputes denormalized session columns from `session_usage` in one statement per chunk.
 *
 * Token totals are sums of the per-message values TokenMath already produced; no formula is repeated here.
 */
class RecomputeSessionTotals
{
    private const CHUNK = 1000;

    /**
     * @param  array<int, int>  $sessionIds
     */
    public function handle(array $sessionIds): void
    {
        $now = OrgClock::now();
        $activeSince = $now->subMinutes((int) config('monitor.session_active_minutes'));

        foreach (array_chunk(array_values(array_unique($sessionIds)), self::CHUNK) as $ids) {
            $in = implode(',', array_fill(0, count($ids), '?'));

            DB::update(
                <<<SQL
                UPDATE claude_sessions s
                LEFT JOIN (
                    SELECT claude_session_id,
                        SUM(input_tokens) AS input_tokens,
                        SUM(output_tokens) AS output_tokens,
                        SUM(cache_creation_tokens) AS cache_creation_tokens,
                        SUM(cache_read_tokens) AS cache_read_tokens,
                        SUM(actual_consumed_tokens) AS actual_consumed_tokens,
                        SUM(total_token_activity) AS total_token_activity,
                        COUNT(*) AS activity_count
                    FROM session_usage
                    WHERE claude_session_id IN ({$in})
                    GROUP BY claude_session_id
                ) u ON u.claude_session_id = s.id
                SET s.input_tokens = COALESCE(u.input_tokens, 0),
                    s.output_tokens = COALESCE(u.output_tokens, 0),
                    s.cache_creation_tokens = COALESCE(u.cache_creation_tokens, 0),
                    s.cache_read_tokens = COALESCE(u.cache_read_tokens, 0),
                    s.actual_consumed_tokens = COALESCE(u.actual_consumed_tokens, 0),
                    s.total_token_activity = COALESCE(u.total_token_activity, 0),
                    s.activity_count = COALESCE(u.activity_count, 0),
                    s.duration_seconds = GREATEST(TIMESTAMPDIFF(SECOND, s.started_at, s.last_activity_at), 0),
                    s.claude_model_id = COALESCE((
                        SELECT su.claude_model_id FROM session_usage su
                        WHERE su.claude_session_id = s.id AND su.claude_model_id IS NOT NULL
                        ORDER BY su.recorded_at DESC, su.id DESC
                        LIMIT 1
                    ), s.claude_model_id),
                    s.status = CASE
                        WHEN s.ended_at IS NOT NULL THEN ?
                        WHEN s.last_activity_at >= ? THEN ?
                        ELSE ?
                    END,
                    s.updated_at = ?
                WHERE s.id IN ({$in})
                SQL,
                [
                    ...$ids,
                    SessionStatus::Ended->value,
                    $activeSince,
                    SessionStatus::Active->value,
                    SessionStatus::Idle->value,
                    $now,
                    ...$ids,
                ],
            );
        }
    }
}
