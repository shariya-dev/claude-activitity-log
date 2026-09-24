<?php

use App\Models\ClaudeAccount;
use App\Models\ClaudeModel;
use App\Models\Developer;
use App\Models\Device;
use App\Models\Project;
use App\Models\UsageDailyRollup;
use App\Queries\Analytics\DateRange;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\Granularity;
use App\Queries\Analytics\TokenAnalytics;
use App\Queries\Analytics\UsageFilters;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

const TOKEN_KEYS = [
    'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens',
    'actual_consumed_tokens', 'total_token_activity', 'message_count',
];

function seedRollup(string $date, Device $device, ?Project $project, ?ClaudeAccount $account, ?ClaudeModel $model, int $scale): UsageDailyRollup
{
    return UsageDailyRollup::factory()->create([
        'date' => $date,
        'device_id' => $device->id,
        'developer_id' => $device->developer_id,
        'project_id' => $project?->id,
        'claude_account_id' => $account?->id,
        'claude_model_id' => $model?->id,
        'input_tokens' => 10 * $scale,
        'output_tokens' => 20 * $scale,
        'cache_creation_tokens' => 30 * $scale,
        'cache_read_tokens' => 400 * $scale,
        'message_count' => $scale,
    ]);
}

/**
 * @return array<string, int>
 */
function expectedTotals(iterable $rollups): array
{
    $sums = array_fill_keys(TOKEN_KEYS, 0);

    foreach ($rollups as $rollup) {
        foreach (TOKEN_KEYS as $key) {
            $sums[$key] += (int) $rollup->{$key};
        }
    }

    return $sums;
}

function weekRange(): DateRange
{
    return DateRange::preset('week');
}

function countQueries(Closure $callback): int
{
    DB::flushQueryLog();
    DB::enableQueryLog();
    $callback();
    $count = count(DB::getQueryLog());
    DB::disableQueryLog();

    return $count;
}

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-22 10:00:00', 'Asia/Dhaka'));

    $this->alice = Developer::factory()->create(['name' => 'Alice', 'email' => 'alice@6am.test']);
    $this->bob = Developer::factory()->create(['name' => 'Bob', 'email' => 'bob@6am.test']);
    $this->aliceMac = Device::factory()->for($this->alice)->create(['hostname' => 'alice-mbp', 'platform' => 'macos']);
    $this->aliceLinux = Device::factory()->for($this->alice)->create(['hostname' => 'alice-box', 'platform' => 'linux']);
    $this->bobWin = Device::factory()->for($this->bob)->create(['hostname' => null, 'platform' => 'windows']);
    $this->work = ClaudeAccount::factory()->for($this->alice)->create(['email' => 'alice@work.test']);
    $this->personal = ClaudeAccount::factory()->for($this->alice)->create(['email' => null, 'display_name' => 'Alice Personal']);
    $this->api = Project::factory()->create(['name' => 'Billing-Api']);
    $this->cms = Project::factory()->create(['name' => 'Content-CMS']);
    $this->opus = ClaudeModel::factory()->create(['name' => 'claude-opus-4-1']);
    $this->sonnet = ClaudeModel::factory()->create(['name' => 'claude-sonnet-4-5']);

    // In range (week 2026-09-21 … 2026-09-27).
    seedRollup('2026-09-21', $this->aliceMac, $this->api, $this->work, $this->opus, 5);
    seedRollup('2026-09-21', $this->aliceMac, $this->cms, $this->work, $this->sonnet, 3);
    seedRollup('2026-09-22', $this->aliceLinux, $this->api, $this->personal, $this->opus, 7);
    seedRollup('2026-09-22', $this->aliceMac, $this->api, $this->personal, $this->sonnet, 2);
    seedRollup('2026-09-24', $this->bobWin, $this->cms, null, $this->sonnet, 11);
    seedRollup('2026-09-24', $this->bobWin, null, null, null, 4);
    seedRollup('2026-09-27', $this->aliceMac, $this->api, $this->personal, $this->opus, 1);
    // Outside the week, same month.
    seedRollup('2026-09-20', $this->aliceMac, $this->api, $this->work, $this->opus, 100);
    seedRollup('2026-09-28', $this->bobWin, $this->cms, null, $this->sonnet, 200);
    seedRollup('2026-09-03', $this->aliceLinux, $this->api, $this->personal, $this->opus, 50);
    // Other months of the year.
    seedRollup('2026-02-14', $this->aliceMac, $this->api, $this->work, $this->opus, 1000);
    seedRollup('2025-12-31', $this->aliceMac, $this->api, $this->work, $this->opus, 5000);
});

afterEach(function () {
    Carbon::setTestNow();
});

test('totals sum the rollups inside the range and return all seven metrics as ints', function () {
    $totals = app(TokenAnalytics::class)->totals(new UsageFilters(weekRange()));

    $expected = expectedTotals(UsageDailyRollup::query()->whereBetween('date', ['2026-09-21', '2026-09-27'])->get());

    expect($totals)->toBe($expected)
        ->and($totals['message_count'])->toBe(33)
        ->and($totals['actual_consumed_tokens'])->toBe(33 * 60)
        ->and($totals['total_token_activity'])->toBe(33 * 460);
});

test('totals equal the sum of seeded rollups under every filter combination', function () {
    $dims = [
        'developerId' => ['developer_id', $this->alice->id],
        'deviceId' => ['device_id', $this->aliceMac->id],
        'accountId' => ['claude_account_id', $this->work->id],
        'projectId' => ['project_id', $this->api->id],
        'modelId' => ['claude_model_id', $this->opus->id],
    ];
    $names = array_keys($dims);
    $inRange = UsageDailyRollup::query()->whereBetween('date', ['2026-09-21', '2026-09-27'])->get();
    $analytics = app(TokenAnalytics::class);

    for ($mask = 0; $mask < 2 ** count($names); $mask++) {
        $args = [];
        $expected = $inRange;

        foreach ($names as $bit => $name) {
            if ($mask & (1 << $bit)) {
                [$column, $value] = $dims[$name];
                $args[$name] = $value;
                $expected = $expected->where($column, $value);
            }
        }

        expect($analytics->totals(new UsageFilters(weekRange(), ...$args)))
            ->toBe(expectedTotals($expected), 'filters: '.json_encode($args));
    }
});

test('totals are all zero when nothing matches', function () {
    $totals = app(TokenAnalytics::class)->totals(new UsageFilters(DateRange::preset('today'), developerId: $this->bob->id));

    expect($totals)->toBe(array_fill_keys(TOKEN_KEYS, 0));
});

test('daily trend zero-fills every day of the range', function () {
    $trend = app(TokenAnalytics::class)->trend(new UsageFilters(weekRange()), Granularity::Day);

    expect(array_column($trend, 'period'))->toBe([
        '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27',
    ])
        ->and(array_column($trend, 'message_count'))->toBe([8, 9, 0, 15, 0, 0, 1])
        ->and($trend[0]['label'])->toBe('Sep 21')
        ->and($trend[2])->toBe(['period' => '2026-09-23', 'label' => 'Sep 23', ...array_fill_keys(TOKEN_KEYS, 0)])
        ->and($trend[3]['total_token_activity'])->toBe(15 * 460);
});

test('trend defaults to the automatic granularity', function () {
    $trend = app(TokenAnalytics::class)->trend(new UsageFilters(weekRange()));

    expect($trend)->toHaveCount(7);
});

test('weekly trend buckets by ISO week starting Monday', function () {
    $trend = app(TokenAnalytics::class)->trend(new UsageFilters(DateRange::preset('month')), Granularity::Week);

    expect(array_column($trend, 'period'))->toBe(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'])
        ->and(array_column($trend, 'message_count'))->toBe([50, 0, 100, 33, 200])
        ->and($trend[3]['label'])->toBe('Sep 21 – Sep 27');
});

test('monthly trend buckets by calendar month across the year', function () {
    $trend = app(TokenAnalytics::class)->trend(new UsageFilters(DateRange::preset('year')), Granularity::Month);

    expect($trend)->toHaveCount(12)
        ->and($trend[0]['period'])->toBe('2026-01')
        ->and($trend[0]['label'])->toBe('Jan 2026')
        ->and($trend[1]['message_count'])->toBe(1000)
        ->and($trend[8]['message_count'])->toBe(50 + 100 + 33 + 200)
        ->and($trend[11]['message_count'])->toBe(0);
});

test('yearly trend buckets by calendar year', function () {
    $range = new DateRange(
        CarbonImmutable::parse('2024-06-01', 'Asia/Dhaka')->startOfDay(),
        CarbonImmutable::parse('2026-12-31', 'Asia/Dhaka')->endOfDay(),
        'custom',
    );

    $trend = app(TokenAnalytics::class)->trend(new UsageFilters($range, developerId: $this->alice->id), Granularity::Year);

    expect(array_column($trend, 'period'))->toBe(['2024', '2025', '2026'])
        ->and(array_column($trend, 'label'))->toBe(['2024', '2025', '2026'])
        ->and(array_column($trend, 'message_count'))->toBe([0, 5000, 1000 + 50 + 100 + 5 + 3 + 7 + 2 + 1]);
});

test('breakdown orders by total token activity, honours the limit and labels nulls Unknown', function () {
    $analytics = app(TokenAnalytics::class);
    $filters = new UsageFilters(weekRange());

    $byProject = $analytics->breakdown($filters, Dimension::Project);

    expect(array_column($byProject, 'label'))->toBe(['Billing-Api', 'Content-CMS', 'Unknown'])
        ->and(array_column($byProject, 'id'))->toBe([$this->api->id, $this->cms->id, null])
        ->and(array_column($byProject, 'message_count'))->toBe([15, 14, 4])
        ->and(array_keys($byProject[0]))->toBe(['id', 'label', ...TOKEN_KEYS])
        ->and($analytics->breakdown($filters, Dimension::Project, 2))->toHaveCount(2);
});

test('breakdown covers every dimension with its label format', function () {
    $analytics = app(TokenAnalytics::class);
    $filters = new UsageFilters(weekRange());

    $rows = fn (Dimension $d) => array_map(
        fn (array $row) => [$row['label'], $row['message_count']],
        $analytics->breakdown($filters, $d),
    );

    expect($rows(Dimension::Developer))->toBe([['Alice <alice@6am.test>', 18], ['Bob <bob@6am.test>', 15]])
        ->and($rows(Dimension::Device))->toBe([
            [$this->bobWin->device_uid.' (windows)', 15], ['alice-mbp (macos)', 11], ['alice-box (linux)', 7],
        ])
        ->and($rows(Dimension::Account))->toBe([['Unknown', 15], ['Alice Personal', 10], ['alice@work.test', 8]])
        ->and($rows(Dimension::Model))->toBe([['claude-sonnet-4-5', 16], ['claude-opus-4-1', 13], ['Unknown', 4]]);
});

test('breakdown applies filters', function () {
    $rows = app(TokenAnalytics::class)->breakdown(
        new UsageFilters(weekRange(), developerId: $this->alice->id, modelId: $this->opus->id),
        Dimension::Device,
    );

    expect($rows)->toHaveCount(2)
        ->and($rows[0]['label'])->toBe('alice-box (linux)')
        ->and($rows[0]['message_count'])->toBe(7)
        ->and($rows[1]['message_count'])->toBe(6);
});

test('an account without email or display name is labelled by id', function () {
    $anonymous = ClaudeAccount::factory()->for($this->bob)->create(['email' => null, 'display_name' => null]);
    seedRollup('2026-09-25', $this->bobWin, null, $anonymous, null, 1);

    $labels = array_column(app(TokenAnalytics::class)->breakdown(new UsageFilters(weekRange()), Dimension::Account), 'label');

    expect($labels)->toContain("Account #{$anonymous->id}");
});

test('totals, trend and breakdown each run at most two queries', function () {
    $analytics = app(TokenAnalytics::class);
    $filters = new UsageFilters(DateRange::preset('year'), developerId: $this->alice->id, projectId: $this->api->id);

    expect(countQueries(fn () => $analytics->totals($filters)))->toBeLessThanOrEqual(2)
        ->and(countQueries(fn () => $analytics->trend($filters)))->toBeLessThanOrEqual(2)
        ->and(countQueries(fn () => $analytics->trend($filters, Granularity::Week)))->toBeLessThanOrEqual(2);

    foreach (Dimension::cases() as $dimension) {
        expect(countQueries(fn () => $analytics->breakdown($filters, $dimension)))->toBeLessThanOrEqual(2);
    }
});
