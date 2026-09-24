<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\TrackingSetting;
use App\Support\OrgClock;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Retention (PRD §56): removes raw prompt messages and raw per-message usage older than `retention_days`,
 * and sync batches older than 90 days regardless of the policy (scheduled daily).
 *
 * Raw `session_usage` is pruned only with --include-usage, and then only for device-days that already have
 * `usage_daily_rollups` rows. It is off by default (and in the schedule) because the ingestion rebuilds
 * (RefreshDailyRollups, RecomputeSessionTotals, monitor:recalculate-tokens) recompute totals from raw usage and
 * would shrink history for pruned days. Rollups, sessions, devices and developers are never touched.
 */
#[Signature('monitor:prune
    {--dry-run : Count the rows that would be deleted without deleting them}
    {--include-usage : Also prune rolled-up raw session_usage (only once ingestion rebuilds are retention-aware)}')]
#[Description('Apply the retention policy to raw monitoring data (messages, usage, old sync batches)')]
class PruneMonitoringData extends Command
{
    private const int CHUNK = 1000;

    private const int SYNC_BATCH_DAYS = 90;

    public function handle(): int
    {
        $retentionDays = TrackingSetting::current()->retention_days;
        $dryRun = (bool) $this->option('dry-run');
        $now = OrgClock::now();

        $queries = [
            'session_messages' => $retentionDays === null ? null : fn (): Builder => DB::table('session_messages')
                ->where('recorded_at', '<', $now->subDays($retentionDays)),
            'session_usage' => $retentionDays === null || ! $this->option('include-usage') ? null : fn (): Builder => DB::table('session_usage')
                ->where('recorded_on', '<', OrgClock::dateFor($now->subDays($retentionDays)))
                ->whereExists(fn (Builder $rollups) => $rollups
                    ->selectRaw('1')
                    ->from('usage_daily_rollups')
                    ->whereColumn('usage_daily_rollups.device_id', 'session_usage.device_id')
                    ->whereColumn('usage_daily_rollups.date', 'session_usage.recorded_on')),
            'sync_batches' => fn (): Builder => DB::table('sync_batches')
                ->where('received_at', '<', $now->subDays(self::SYNC_BATCH_DAYS)),
        ];

        $counts = [];

        foreach ($queries as $table => $query) {
            $counts[$table] = match (true) {
                $query === null => 0,
                $dryRun => $query()->count(),
                default => $this->deleteInChunks($query),
            };
        }

        $this->info($dryRun ? 'Dry run, nothing deleted. Rows that would be deleted:' : 'Rows deleted:');

        foreach ($counts as $table => $count) {
            $this->line("  {$table} {$count}");
        }

        if (! $dryRun && array_sum($counts) > 0) {
            AuditLog::record('retention.pruned', null, ['retention_days' => $retentionDays, ...$counts]);
        }

        return self::SUCCESS;
    }

    /**
     * Delete matching rows by primary key in chunks, so no single statement holds long locks.
     *
     * @param  callable(): Builder  $query
     */
    private function deleteInChunks(callable $query): int
    {
        $deleted = 0;

        do {
            $ids = $query()->orderBy('id')->limit(self::CHUNK)->pluck('id')->all();

            if ($ids !== []) {
                $deleted += DB::table($query()->from)->whereIn('id', $ids)->delete();
            }
        } while (count($ids) === self::CHUNK);

        return $deleted;
    }
}
