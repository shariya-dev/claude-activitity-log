<?php

namespace App\Console\Commands;

use App\Actions\Ingestion\RecomputeSessionTotals;
use App\Actions\Ingestion\RefreshDailyRollups;
use App\Actions\Ingestion\RefreshProjectTotals;
use App\Support\TokenMath;
use Carbon\CarbonImmutable;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Recomputes the calculated token columns of session_usage (via TokenMath only), then the
 * session totals, project totals and daily rollups that depend on them.
 */
#[Signature('monitor:recalculate-tokens {--from= : First org-timezone date (Y-m-d), inclusive} {--to= : Last org-timezone date (Y-m-d), inclusive}')]
#[Description('Recalculate token columns, session/project totals and daily rollups from raw usage')]
class RecalculateTokens extends Command
{
    private const int CHUNK = 1000;

    public function handle(
        RecomputeSessionTotals $recomputeSessionTotals,
        RefreshProjectTotals $refreshProjectTotals,
        RefreshDailyRollups $refreshDailyRollups,
    ): int {
        $from = $this->dateOption('from');
        $to = $this->dateOption('to');

        if ($from === false || $to === false) {
            return self::FAILURE;
        }

        if ($from !== null && $to !== null && $from > $to) {
            $this->error('--from must not be after --to.');

            return self::FAILURE;
        }

        $scanned = 0;
        $changed = 0;
        /** @var array<int, true> $sessionIds */
        $sessionIds = [];
        /** @var array<string, array{0: int, 1: string}> $pairs */
        $pairs = [];

        $this->usageInRange($from, $to)
            ->select([
                'id', 'claude_session_id', 'device_id', 'recorded_on',
                'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens',
                'actual_consumed_tokens', 'total_token_activity',
            ])
            ->chunkById(self::CHUNK, function (Collection $rows) use (&$scanned, &$changed, &$sessionIds, &$pairs): void {
                /** @var array<int, array{actual_consumed_tokens: int, total_token_activity: int}> $updates */
                $updates = [];

                foreach ($rows as $row) {
                    $scanned++;
                    $sessionIds[(int) $row->claude_session_id] = true;
                    $this->addPair($pairs, (int) $row->device_id, (string) $row->recorded_on);

                    $calculated = TokenMath::forRow([
                        'input_tokens' => (int) $row->input_tokens,
                        'output_tokens' => (int) $row->output_tokens,
                        'cache_creation_tokens' => (int) $row->cache_creation_tokens,
                        'cache_read_tokens' => (int) $row->cache_read_tokens,
                    ]);

                    if ($calculated['actual_consumed_tokens'] !== (int) $row->actual_consumed_tokens
                        || $calculated['total_token_activity'] !== (int) $row->total_token_activity) {
                        $updates[(int) $row->id] = $calculated;
                    }
                }

                $this->writeCalculated($updates);
                $changed += count($updates);
            }, 'id');

        // Rollup rows in range whose usage no longer exists are refreshed too (delete + re-insert).
        $this->rollupPairsInRange($from, $to, $pairs);

        $sessionIdList = array_keys($sessionIds);

        foreach (array_chunk($sessionIdList, self::CHUNK) as $chunk) {
            $recomputeSessionTotals->handle($chunk);
        }

        $projectIds = $this->projectIdsFor($sessionIdList);

        foreach (array_chunk($projectIds, self::CHUNK) as $chunk) {
            $refreshProjectTotals->handle($chunk);
        }

        $pairList = array_values($pairs);

        foreach (array_chunk($pairList, self::CHUNK) as $chunk) {
            $refreshDailyRollups->handle($chunk);
        }

        $range = ($from ?? 'beginning').' .. '.($to ?? 'latest');
        $this->info(sprintf(
            'Recalculated %s: %d usage rows scanned, %d changed; %d sessions, %d projects, %d rollup day-pairs refreshed.',
            $range,
            $scanned,
            $changed,
            count($sessionIdList),
            count($projectIds),
            count($pairList),
        ));

        return self::SUCCESS;
    }

    /**
     * The validated Y-m-d value of a date option, null when absent, false when invalid.
     */
    private function dateOption(string $name): string|false|null
    {
        $value = $this->option($name);

        if ($value === null || $value === '') {
            return null;
        }

        $value = (string) $value;
        $parsed = CarbonImmutable::createFromFormat('!Y-m-d', $value);

        if ($parsed === null || $parsed->format('Y-m-d') !== $value) {
            $this->error("--{$name} must be a date in Y-m-d format.");

            return false;
        }

        return $value;
    }

    private function usageInRange(?string $from, ?string $to): Builder
    {
        return DB::table('session_usage')
            ->when($from !== null, fn (Builder $query) => $query->where('recorded_on', '>=', $from))
            ->when($to !== null, fn (Builder $query) => $query->where('recorded_on', '<=', $to));
    }

    /**
     * Write changed calculated columns for one chunk in a single statement.
     *
     * @param  array<int, array{actual_consumed_tokens: int, total_token_activity: int}>  $updates
     */
    private function writeCalculated(array $updates): void
    {
        if ($updates === []) {
            return;
        }

        $actualCases = [];
        $totalCases = [];
        $actualBindings = [];
        $totalBindings = [];

        foreach ($updates as $id => $values) {
            $actualCases[] = 'WHEN ? THEN ?';
            $totalCases[] = 'WHEN ? THEN ?';
            array_push($actualBindings, $id, $values['actual_consumed_tokens']);
            array_push($totalBindings, $id, $values['total_token_activity']);
        }

        $ids = array_keys($updates);
        $placeholders = implode(', ', array_fill(0, count($ids), '?'));

        DB::update(
            'UPDATE session_usage SET '
            .'actual_consumed_tokens = CASE id '.implode(' ', $actualCases).' END, '
            .'total_token_activity = CASE id '.implode(' ', $totalCases).' END, '
            .'updated_at = ? '
            ."WHERE id IN ({$placeholders})",
            [...$actualBindings, ...$totalBindings, now(), ...$ids],
        );
    }

    /**
     * @param  array<string, array{0: int, 1: string}>  $pairs
     */
    private function addPair(array &$pairs, int $deviceId, string $date): void
    {
        $date = substr($date, 0, 10);
        $pairs[$deviceId.'|'.$date] = [$deviceId, $date];
    }

    /**
     * @param  array<string, array{0: int, 1: string}>  $pairs
     */
    private function rollupPairsInRange(?string $from, ?string $to, array &$pairs): void
    {
        DB::table('usage_daily_rollups')
            ->when($from !== null, fn (Builder $query) => $query->where('date', '>=', $from))
            ->when($to !== null, fn (Builder $query) => $query->where('date', '<=', $to))
            ->select(['device_id', 'date'])
            ->distinct()
            ->orderBy('device_id')
            ->orderBy('date')
            ->get()
            ->each(function (object $row) use (&$pairs): void {
                $this->addPair($pairs, (int) $row->device_id, (string) $row->date);
            });
    }

    /**
     * Distinct project ids of the given sessions.
     *
     * @param  list<int>  $sessionIds
     * @return list<int>
     */
    private function projectIdsFor(array $sessionIds): array
    {
        $projectIds = [];

        foreach (array_chunk($sessionIds, self::CHUNK) as $chunk) {
            DB::table('claude_sessions')
                ->whereIn('id', $chunk)
                ->whereNotNull('project_id')
                ->distinct()
                ->pluck('project_id')
                ->each(function (mixed $projectId) use (&$projectIds): void {
                    $projectIds[(int) $projectId] = true;
                });
        }

        return array_keys($projectIds);
    }
}
