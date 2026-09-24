<?php

/*
|--------------------------------------------------------------------------
| Token validation helpers (H23, PRD Phase 8)
|--------------------------------------------------------------------------
|
| Expected values are computed here independently of the application:
| the Actual/Total formulas are written inline (App\Support\TokenMath is
| never called), org days are derived with plain PHP DateTime, and the SQL
| cross-check aggregates raw `session_usage` rows (never the rollups).
|
*/

use App\Models\ClaudeAccount;
use App\Models\ClaudeModel;
use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\Project;
use App\Models\User;
use App\Queries\Analytics\DateRange;
use App\Queries\Analytics\UsageFilters;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Ingestion/helpers.php';

if (! function_exists('tvRawColumns')) {
    /**
     * @return list<string>
     */
    function tvRawColumns(): array
    {
        return ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens'];
    }
}

if (! function_exists('tvMetricColumns')) {
    /**
     * The six token metrics, optionally followed by message_count.
     *
     * @return list<string>
     */
    function tvMetricColumns(bool $withCount = true): array
    {
        $columns = [...tvRawColumns(), 'actual_consumed_tokens', 'total_token_activity'];

        return $withCount ? [...$columns, 'message_count'] : $columns;
    }
}

if (! function_exists('tvMetrics')) {
    /**
     * Expected metrics from raw sums, with the PRD §20 formulas written inline:
     * actual = input + output + cache_creation; total = actual + cache_read.
     *
     * @return array<string, int>
     */
    function tvMetrics(int $input, int $output, int $cacheCreation, int $cacheRead, ?int $messageCount = null): array
    {
        $actual = $input + $output + $cacheCreation;

        $metrics = [
            'input_tokens' => $input,
            'output_tokens' => $output,
            'cache_creation_tokens' => $cacheCreation,
            'cache_read_tokens' => $cacheRead,
            'actual_consumed_tokens' => $actual,
            'total_token_activity' => $actual + $cacheRead,
        ];

        return $messageCount === null ? $metrics : $metrics + ['message_count' => $messageCount];
    }
}

if (! function_exists('tvOnly')) {
    /**
     * Keep only the metric columns (in canonical order), cast to int.
     *
     * @param  array<string, mixed>|object  $row
     * @return array<string, int>
     */
    function tvOnly(array|object $row, bool $withCount = true): array
    {
        $row = (array) $row;
        $out = [];

        foreach (tvMetricColumns($withCount) as $column) {
            $out[$column] = (int) $row[$column];
        }

        return $out;
    }
}

if (! function_exists('tvOrgDay')) {
    /**
     * Org-timezone calendar day of a contract UTC timestamp, with plain PHP DateTime (not OrgClock).
     */
    function tvOrgDay(string $utcIso, string $timezone = 'Asia/Dhaka'): string
    {
        return (new DateTimeImmutable($utcIso))->setTimezone(new DateTimeZone($timezone))->format('Y-m-d');
    }
}

if (! function_exists('tvPeriod')) {
    /**
     * Trend bucket key of an org day: Y-m-d (day), Monday Y-m-d (week), Y-m (month), Y (year).
     */
    function tvPeriod(string $day, string $granularity): string
    {
        $date = new DateTimeImmutable($day);

        return match ($granularity) {
            'day' => $day,
            'week' => $date->modify('-'.((int) $date->format('N') - 1).' days')->format('Y-m-d'),
            'month' => $date->format('Y-m'),
            'year' => $date->format('Y'),
        };
    }
}

if (! function_exists('tvDedupe')) {
    /**
     * Collapse deliveries of the same message (keyed by session + source_message_id) with a per-field max
     * and the earliest recorded_at — the dedup rule of docs/contracts/claude-data-contract.md.
     *
     * @param  list<array<string, mixed>>  $deliveries  each: session, message, recorded_at, model + raw token columns + any extra keys
     * @return list<array<string, mixed>>
     */
    function tvDedupe(array $deliveries): array
    {
        $messages = [];

        foreach ($deliveries as $delivery) {
            $key = $delivery['session'].'|'.$delivery['message'];

            if (! isset($messages[$key])) {
                $messages[$key] = $delivery;

                continue;
            }

            foreach (tvRawColumns() as $column) {
                $messages[$key][$column] = max($messages[$key][$column], $delivery[$column]);
            }

            if (strcmp($delivery['recorded_at'], $messages[$key]['recorded_at']) < 0) {
                $messages[$key]['recorded_at'] = $delivery['recorded_at'];
            }

            $messages[$key]['model'] = $delivery['model'] ?? $messages[$key]['model'];
        }

        return array_values($messages);
    }
}

if (! function_exists('tvGroup')) {
    /**
     * Expected metrics per group from deduped message rows (PHP arithmetic only).
     *
     * @param  list<array<string, mixed>>  $rows
     * @param  callable(array<string, mixed>): (string|int|null)  $key
     * @return array<string, array<string, int>>
     */
    function tvGroup(array $rows, callable $key): array
    {
        $sums = [];

        foreach ($rows as $row) {
            $k = (string) ($key($row) ?? '');
            $sums[$k] ??= ['input_tokens' => 0, 'output_tokens' => 0, 'cache_creation_tokens' => 0, 'cache_read_tokens' => 0, 'count' => 0];

            foreach (tvRawColumns() as $column) {
                $sums[$k][$column] += $row[$column];
            }

            $sums[$k]['count']++;
        }

        ksort($sums, SORT_STRING);

        return array_map(fn (array $s): array => tvMetrics(
            $s['input_tokens'], $s['output_tokens'], $s['cache_creation_tokens'], $s['cache_read_tokens'], $s['count'],
        ), $sums);
    }
}

if (! function_exists('tvTotal')) {
    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array<string, int>
     */
    function tvTotal(array $rows): array
    {
        return tvGroup($rows, fn (): string => 'all')['all'] ?? tvMetrics(0, 0, 0, 0, 0);
    }
}

if (! function_exists('tvSql')) {
    /**
     * Independent SQL aggregate over raw `session_usage` rows, grouped by $keySql (null groups keyed '').
     * Also recomputes Actual/Total from the raw columns in SQL and asserts the stored per-row calc columns agree.
     *
     * @param  list<mixed>  $bindings
     * @return array<string, array<string, int>>
     */
    function tvSql(string $keySql, string $where = '1 = 1', array $bindings = []): array
    {
        $rows = DB::select(
            "SELECT {$keySql} AS k,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cache_creation_tokens) AS cache_creation_tokens,
                SUM(cache_read_tokens) AS cache_read_tokens,
                SUM(actual_consumed_tokens) AS actual_consumed_tokens,
                SUM(total_token_activity) AS total_token_activity,
                COUNT(*) AS message_count,
                SUM(input_tokens + output_tokens + cache_creation_tokens) AS formula_actual,
                SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) AS formula_total
            FROM session_usage
            WHERE {$where}
            GROUP BY k",
            $bindings,
        );

        $out = [];

        foreach ($rows as $row) {
            expect((int) $row->actual_consumed_tokens)->toBe((int) $row->formula_actual, "stored actual != raw formula for group [{$row->k}]")
                ->and((int) $row->total_token_activity)->toBe((int) $row->formula_total, "stored total != raw formula for group [{$row->k}]");

            $out[(string) ($row->k ?? '')] = tvOnly($row);
        }

        ksort($out, SORT_STRING);

        return $out;
    }
}

if (! function_exists('tvSqlTotal')) {
    /**
     * @param  list<mixed>  $bindings
     * @return array<string, int>
     */
    function tvSqlTotal(string $where = '1 = 1', array $bindings = []): array
    {
        return tvSql("'all'", $where, $bindings)['all'] ?? tvMetrics(0, 0, 0, 0, 0);
    }
}

if (! function_exists('tvKeyed')) {
    /**
     * Key H07/dashboard rows by a field (null => ''), keeping only metric columns.
     *
     * @param  iterable<array<string, mixed>>  $rows
     * @return array<string, array<string, int>>
     */
    function tvKeyed(iterable $rows, string $keyField, bool $withCount = true): array
    {
        $out = [];

        foreach ($rows as $row) {
            $out[(string) ($row[$keyField] ?? '')] = tvOnly($row, $withCount);
        }

        ksort($out, SORT_STRING);

        return $out;
    }
}

if (! function_exists('tvAssertIdentity')) {
    /**
     * actual + cache_read == total and actual == input + output + cache_creation for every row.
     *
     * @param  iterable<array<string, mixed>>  $rows
     */
    function tvAssertIdentity(iterable $rows, string $context): void
    {
        foreach ($rows as $key => $row) {
            expect((int) $row['actual_consumed_tokens'] + (int) $row['cache_read_tokens'])
                ->toBe((int) $row['total_token_activity'], "{$context} [{$key}]: actual + cache_read != total")
                ->and((int) $row['input_tokens'] + (int) $row['output_tokens'] + (int) $row['cache_creation_tokens'])
                ->toBe((int) $row['actual_consumed_tokens'], "{$context} [{$key}]: input + output + cache_creation != actual");
        }
    }
}

if (! function_exists('tvSumMetrics')) {
    /**
     * Column-wise sum of metric rows.
     *
     * @param  iterable<array<string, mixed>>  $rows
     * @return array<string, int>
     */
    function tvSumMetrics(iterable $rows, bool $withCount = true): array
    {
        $sum = array_fill_keys(tvMetricColumns($withCount), 0);

        foreach ($rows as $row) {
            foreach (tvMetricColumns($withCount) as $column) {
                $sum[$column] += (int) $row[$column];
            }
        }

        return $sum;
    }
}

if (! function_exists('tvFilters')) {
    /**
     * UsageFilters for a custom org-tz range, built through the same request parsing the dashboard uses.
     *
     * @param  array<string, int|null>  $dims  developer/device/account/project/model ids
     */
    function tvFilters(string $from, string $to, array $dims = []): UsageFilters
    {
        $range = DateRange::fromRequest(Request::create('/', 'GET', ['range' => 'custom', 'from' => $from, 'to' => $to]));

        return new UsageFilters(
            $range,
            $dims['developer'] ?? null,
            $dims['device'] ?? null,
            $dims['account'] ?? null,
            $dims['project'] ?? null,
            $dims['model'] ?? null,
        );
    }
}

if (! function_exists('tvPairedDevice')) {
    /**
     * A developer with one paired device (the pairing flow itself is covered by H05 tests).
     */
    function tvPairedDevice(string $developer, string $platform): Device
    {
        $dev = Developer::factory()->create(['name' => ucfirst($developer), 'email' => $developer.'@6am.test']);

        return Device::factory()->for($dev)->create([
            'device_uid' => 'dev_tv_'.$developer,
            'hostname' => $developer.'-'.$platform,
            'platform' => $platform,
            'last_sync_at' => null,
        ]);
    }
}

if (! function_exists('tvPostAs')) {
    /**
     * POST a sync body as the given device through the real agent API; asserts a fully accepted 200.
     *
     * @param  array<string, mixed>  $body
     */
    function tvPostAs(Device $device, array $body): TestResponse
    {
        Sanctum::actingAs($device, ['agent']);

        return postSync($body)
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('sync.rejected', 0);
    }
}

if (! function_exists('tvViewer')) {
    function tvViewer(): User
    {
        return User::factory()->viewer()->create();
    }
}

if (! function_exists('tvPage')) {
    /**
     * Dashboard GET as a viewer on the web guard; returns the Inertia props.
     *
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    function tvPage(string $route, array $params = []): array
    {
        return test()->actingAs(tvViewer(), 'web')
            ->get(route($route, $params))
            ->assertOk()
            ->inertiaProps();
    }
}

if (! function_exists('tvIds')) {
    /**
     * Name => id lookups for every dimension, read after ingestion.
     *
     * @return array{developer: array<string, int>, device: array<string, int>, project: array<string, int>, account: array<string, int>, model: array<string, int>, session: array<string, int>}
     */
    function tvIds(): array
    {
        return [
            'developer' => Developer::query()->pluck('id', 'email')->map(fn ($id): int => (int) $id)->all(),
            'device' => Device::query()->pluck('id', 'device_uid')->map(fn ($id): int => (int) $id)->all(),
            'project' => Project::query()->pluck('id', 'name')->map(fn ($id): int => (int) $id)->all(),
            'account' => ClaudeAccount::query()->pluck('id', 'email')->map(fn ($id): int => (int) $id)->all(),
            'model' => ClaudeModel::query()->pluck('id', 'name')->map(fn ($id): int => (int) $id)->all(),
            'session' => ClaudeSession::query()->pluck('id', 'source_session_id')->map(fn ($id): int => (int) $id)->all(),
        ];
    }
}
