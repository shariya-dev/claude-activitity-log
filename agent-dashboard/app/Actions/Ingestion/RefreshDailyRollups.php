<?php

namespace App\Actions\Ingestion;

use App\Support\OrgClock;
use Illuminate\Support\Facades\DB;

/**
 * Rebuilds `usage_daily_rollups` for the given (device, org-day) pairs: delete, then insert-select from `session_usage`.
 *
 * Every rollup row of a device-day is rebuilt, so dimension moves (project/account reassignment) and recalculated
 * token values are picked up. `dims_hash` matches UsageDailyRollupFactory: sha256("date|developer|device|project|account|model").
 */
class RefreshDailyRollups
{
    private const CHUNK = 500;

    /**
     * @param  array<int|string, array{0: int, 1: string}>  $deviceDatePairs  [[device_id, 'Y-m-d'], ...]
     */
    public function handle(array $deviceDatePairs): void
    {
        $datesByDevice = [];

        foreach ($deviceDatePairs as [$deviceId, $date]) {
            $datesByDevice[(int) $deviceId][$date] = $date;
        }

        $now = OrgClock::now();

        foreach ($datesByDevice as $deviceId => $dates) {
            foreach (array_chunk(array_values($dates), self::CHUNK) as $chunk) {
                $in = implode(',', array_fill(0, count($chunk), '?'));

                DB::delete("DELETE FROM usage_daily_rollups WHERE device_id = ? AND date IN ({$in})", [$deviceId, ...$chunk]);

                DB::insert(
                    <<<SQL
                    INSERT INTO usage_daily_rollups (
                        date, developer_id, device_id, project_id, claude_account_id, claude_model_id, dims_hash,
                        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
                        actual_consumed_tokens, total_token_activity, message_count, updated_at
                    )
                    SELECT recorded_on, developer_id, device_id, project_id, claude_account_id, claude_model_id,
                        SHA2(CONCAT_WS('|', recorded_on, developer_id, device_id,
                            COALESCE(project_id, ''), COALESCE(claude_account_id, ''), COALESCE(claude_model_id, '')), 256),
                        SUM(input_tokens), SUM(output_tokens), SUM(cache_creation_tokens), SUM(cache_read_tokens),
                        SUM(actual_consumed_tokens), SUM(total_token_activity), COUNT(*), ?
                    FROM session_usage
                    WHERE device_id = ? AND recorded_on IN ({$in})
                    GROUP BY recorded_on, developer_id, device_id, project_id, claude_account_id, claude_model_id
                    SQL,
                    [$now, $deviceId, ...$chunk],
                );
            }
        }
    }
}
