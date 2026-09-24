<?php

namespace App\Queries\Analytics;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Token metrics, read only from usage_daily_rollups (never raw session_usage).
 * Every method runs a single SQL query.
 *
 * @phpstan-type TokenTotals array{input_tokens: int, output_tokens: int, cache_creation_tokens: int, cache_read_tokens: int, actual_consumed_tokens: int, total_token_activity: int, message_count: int}
 */
final class TokenAnalytics
{
    public const METRICS = [
        'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens',
        'actual_consumed_tokens', 'total_token_activity', 'message_count',
    ];

    /**
     * @return TokenTotals
     */
    public function totals(UsageFilters $f): array
    {
        $row = $this->rollups($f)->selectRaw($this->sumsSql())->first();

        return $this->metrics($row);
    }

    /**
     * @return list<array{period: string, label: string, input_tokens: int, output_tokens: int, cache_creation_tokens: int, cache_read_tokens: int, actual_consumed_tokens: int, total_token_activity: int, message_count: int}>
     */
    public function trend(UsageFilters $f, ?Granularity $g = null): array
    {
        $g ??= Granularity::auto($f->range);

        $rows = $this->rollups($f)
            ->selectRaw($g->periodSql('r.date').' as period, '.$this->sumsSql())
            ->groupBy('period')
            ->get()
            ->keyBy('period');

        $trend = [];
        $lastDay = $f->range->end->startOfDay();

        for ($periodStart = $g->periodStart($f->range->start); $periodStart->lessThanOrEqualTo($lastDay); $periodStart = $g->next($periodStart)) {
            $period = $g->periodKey($periodStart);

            $trend[] = [
                'period' => $period,
                'label' => $g->label($periodStart),
                ...$this->metrics($rows->get($period)),
            ];
        }

        return $trend;
    }

    /**
     * @return list<array{id: int|null, label: string, input_tokens: int, output_tokens: int, cache_creation_tokens: int, cache_read_tokens: int, actual_consumed_tokens: int, total_token_activity: int, message_count: int}>
     */
    public function breakdown(UsageFilters $f, Dimension $by, int $limit = 10): array
    {
        $column = 'r.'.$by->column();

        return $this->rollups($f)
            ->leftJoin($by->table().' as d', 'd.id', '=', $column)
            ->selectRaw("{$column} as id, MAX({$by->labelSql('d')}) as label, ".$this->sumsSql())
            ->groupBy($column)
            ->orderByDesc('total_token_activity')
            ->orderBy('label')
            ->limit(max(1, $limit))
            ->get()
            ->map(fn (object $row): array => [
                'id' => $row->id === null ? null : (int) $row->id,
                'label' => $row->id === null ? 'Unknown' : (string) $row->label,
                ...$this->metrics($row),
            ])
            ->values()
            ->all();
    }

    private function rollups(UsageFilters $f): Builder
    {
        $query = DB::table('usage_daily_rollups as r')
            ->whereBetween('r.date', [$f->range->startDate(), $f->range->endDate()]);

        return $f->applyDimensions($query, 'r');
    }

    private function sumsSql(): string
    {
        return implode(', ', array_map(
            fn (string $metric): string => "COALESCE(SUM(r.{$metric}), 0) as {$metric}",
            self::METRICS,
        ));
    }

    /**
     * @return TokenTotals
     */
    private function metrics(?object $row): array
    {
        return [
            'input_tokens' => (int) ($row->input_tokens ?? 0),
            'output_tokens' => (int) ($row->output_tokens ?? 0),
            'cache_creation_tokens' => (int) ($row->cache_creation_tokens ?? 0),
            'cache_read_tokens' => (int) ($row->cache_read_tokens ?? 0),
            'actual_consumed_tokens' => (int) ($row->actual_consumed_tokens ?? 0),
            'total_token_activity' => (int) ($row->total_token_activity ?? 0),
            'message_count' => (int) ($row->message_count ?? 0),
        ];
    }
}
