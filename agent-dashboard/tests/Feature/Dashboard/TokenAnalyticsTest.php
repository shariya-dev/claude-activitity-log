<?php

use App\Models\ClaudeAccount;
use App\Models\ClaudeModel;
use App\Models\Developer;
use App\Models\Device;
use App\Models\Project;
use App\Models\UsageDailyRollup;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

const ANALYTICS_PAGE_METRICS = [
    'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens',
    'actual_consumed_tokens', 'total_token_activity', 'message_count',
];

const ANALYTICS_PAGE_ALL_TIME = ['range' => 'custom', 'from' => '2025-01-01', 'to' => '2026-12-31'];

function analyticsPageRollup(string $date, Device $device, ?Project $project, ?ClaudeAccount $account, ?ClaudeModel $model, int $scale): void
{
    UsageDailyRollup::factory()->create([
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
 * @param  iterable<array<string, int>>  $rows
 * @return array<string, int>
 */
function analyticsPageSum(iterable $rows): array
{
    $sums = array_fill_keys(ANALYTICS_PAGE_METRICS, 0);

    foreach ($rows as $row) {
        foreach (ANALYTICS_PAGE_METRICS as $key) {
            $sums[$key] += $row[$key];
        }
    }

    return $sums;
}

/**
 * @param  array<string, mixed>  $query
 */
function analyticsPage(array $query = []): TestResponse
{
    return test()->actingAs(User::factory()->viewer()->create())
        ->get(route('analytics.tokens', $query));
}

function assertAnalyticsConsistent(TestResponse $response): void
{
    $props = $response->assertOk()->inertiaProps();
    $totals = array_intersect_key($props['totals'], array_flip(ANALYTICS_PAGE_METRICS));

    expect(analyticsPageSum($props['trend']))->toBe($totals, 'sum of trend points must equal totals')
        ->and(count($props['breakdown']))->toBeLessThan($props['breakdownLimit'])
        ->and(analyticsPageSum($props['breakdown']))->toBe($totals, 'sum of the full breakdown must equal totals');
}

beforeEach(function () {
    $this->withoutVite();
    config(['monitor.timezone' => 'Asia/Dhaka']);
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-22 10:00:00', 'Asia/Dhaka'));

    $this->alice = Developer::factory()->create(['name' => 'Alice', 'email' => 'alice@6am.test']);
    $this->bob = Developer::factory()->create(['name' => 'Bob', 'email' => 'bob@6am.test']);
    $this->aliceMac = Device::factory()->for($this->alice)->create(['hostname' => 'alice-mbp', 'platform' => 'macos']);
    $this->bobWin = Device::factory()->for($this->bob)->create(['hostname' => 'bob-pc', 'platform' => 'windows']);
    $this->work = ClaudeAccount::factory()->for($this->alice)->create(['email' => 'alice@work.test']);
    $this->api = Project::factory()->create(['name' => 'Api']);
    $this->cms = Project::factory()->create(['name' => 'Cms']);
    $this->opus = ClaudeModel::factory()->create(['name' => 'claude-opus-4-1']);
    $this->sonnet = ClaudeModel::factory()->create(['name' => 'claude-sonnet-4-5']);

    // This week (2026-09-21 … 2026-09-27).
    analyticsPageRollup('2026-09-21', $this->aliceMac, $this->api, $this->work, $this->opus, 5);
    analyticsPageRollup('2026-09-22', $this->aliceMac, $this->cms, $this->work, $this->sonnet, 3);
    analyticsPageRollup('2026-09-24', $this->bobWin, $this->cms, null, $this->sonnet, 11);
    analyticsPageRollup('2026-09-27', $this->bobWin, null, null, null, 4);
    // Earlier: other weeks, months and a previous year.
    analyticsPageRollup('2026-09-03', $this->aliceMac, $this->api, $this->work, $this->opus, 50);
    analyticsPageRollup('2026-02-14', $this->bobWin, $this->api, null, $this->opus, 1000);
    analyticsPageRollup('2025-12-31', $this->aliceMac, $this->cms, $this->work, $this->sonnet, 5000);
});

afterEach(function () {
    Carbon::setTestNow();
});

test('guests are redirected to login', function () {
    $this->get(route('analytics.tokens'))->assertRedirect(route('login'));
});

test('the page renders with defaults and every prop', function () {
    analyticsPage()
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Analytics/Tokens')
            ->where('range', ['preset' => 'week', 'from' => '2026-09-21', 'to' => '2026-09-27'])
            ->where('filters', ['developer' => null, 'device' => null, 'account' => null, 'project' => null, 'model' => null])
            ->has('options', 5)
            ->has('options.developer', 2)
            ->has('options.device', 2)
            ->has('options.account', 1)
            ->has('options.project', 2)
            ->has('options.model', 2)
            ->where('granularity', ['value' => 'day', 'auto' => true])
            ->where('group', 'developer')
            ->where('metric', 'total')
            ->where('breakdownLimit', 25)
            ->where('totals.message_count', 23)
            ->where('totals.actual_consumed_tokens', 23 * 60)
            ->where('totals.total_token_activity', 23 * 460)
            ->has('trend', 7)
            ->where('trend.0', fn ($point) => $point['period'] === '2026-09-21' && $point['total_token_activity'] === 5 * 460)
            ->has('breakdown', 2)
            ->where('breakdown.0.label', 'Bob <bob@6am.test>')
            ->where('breakdown.0.total_token_activity', 15 * 460));
});

test('trend and full breakdown sum to totals for every dimension filter and group', function (string $param, string $model, string $group) {
    $query = [...ANALYTICS_PAGE_ALL_TIME, $param => $this->{$model}->id, 'group' => $group];

    $response = analyticsPage($query);
    assertAnalyticsConsistent($response);

    $column = ['developer' => 'developer_id', 'device' => 'device_id', 'account' => 'claude_account_id', 'project' => 'project_id', 'model' => 'claude_model_id'][$param];
    $expected = UsageDailyRollup::query()->where($column, $this->{$model}->id)->sum('total_token_activity');

    expect($response->inertiaProps('totals.total_token_activity'))->toBe((int) $expected)
        ->and($response->inertiaProps("filters.{$param}"))->toBe($this->{$model}->id)
        ->and($response->inertiaProps('group'))->toBe($group);
})->with([
    'developer' => ['developer', 'alice'],
    'device' => ['device', 'bobWin'],
    'account' => ['account', 'work'],
    'project' => ['project', 'api'],
    'model' => ['model', 'sonnet'],
])->with(['developer', 'device', 'account', 'project', 'model']);

test('trend and full breakdown sum to totals for every granularity', function (string $granularity, int $points) {
    $response = analyticsPage([...ANALYTICS_PAGE_ALL_TIME, 'granularity' => $granularity, 'group' => 'project']);

    assertAnalyticsConsistent($response);

    expect($response->inertiaProps('granularity'))->toBe(['value' => $granularity, 'auto' => false])
        ->and($response->inertiaProps('trend'))->toHaveCount($points)
        ->and($response->inertiaProps('totals.message_count'))->toBe(6073);
})->with([
    'day' => ['day', 730],
    'week' => ['week', 105],
    'month' => ['month', 24],
    'year' => ['year', 2],
]);

test('every metric is accepted', function (string $metric) {
    expect(analyticsPage(['metric' => $metric])->assertOk()->inertiaProps('metric'))->toBe($metric);
})->with(['total', 'actual', 'cache_read', 'input', 'output', 'cache_creation']);

test('invalid group, metric and granularity fall back to defaults', function (array $query) {
    $response = analyticsPage($query);

    assertAnalyticsConsistent($response);

    expect($response->inertiaProps('group'))->toBe('developer')
        ->and($response->inertiaProps('metric'))->toBe('total')
        ->and($response->inertiaProps('granularity'))->toBe(['value' => 'day', 'auto' => true]);
})->with([
    'unknown values' => [['group' => 'session', 'metric' => 'cost', 'granularity' => 'hour']],
    'empty values' => [['group' => '', 'metric' => '', 'granularity' => '']],
    'array values' => [['group' => ['project'], 'metric' => ['input'], 'granularity' => ['week']]],
    'wrong case' => [['group' => 'Project', 'metric' => 'INPUT', 'granularity' => 'Week']],
]);

test('invalid dates and ids fall back to defaults', function (array $query) {
    $response = analyticsPage($query);

    assertAnalyticsConsistent($response);

    expect($response->inertiaProps('range'))->toBe(['preset' => 'week', 'from' => '2026-09-21', 'to' => '2026-09-27'])
        ->and($response->inertiaProps('filters'))->toBe(['developer' => null, 'device' => null, 'account' => null, 'project' => null, 'model' => null])
        ->and($response->inertiaProps('totals.message_count'))->toBe(23);
})->with([
    'unknown preset' => [['range' => 'decade']],
    'custom without dates' => [['range' => 'custom']],
    'custom reversed' => [['range' => 'custom', 'from' => '2026-09-30', 'to' => '2026-09-01']],
    'custom malformed' => [['range' => 'custom', 'from' => '09/01/2026', 'to' => 'soon']],
    'custom too long' => [['range' => 'custom', 'from' => '2020-01-01', 'to' => '2026-01-01']],
    'custom arrays' => [['range' => 'custom', 'from' => ['2026-09-01'], 'to' => ['2026-09-30']]],
    'bad ids' => [['developer' => 'abc', 'device' => '-3', 'account' => '0', 'project' => ['1'], 'model' => '1.5']],
]);

test('a valid custom range is used as given', function () {
    $response = analyticsPage(['range' => 'custom', 'from' => '2026-09-01', 'to' => '2026-09-30']);

    assertAnalyticsConsistent($response);

    expect($response->inertiaProps('range'))->toBe(['preset' => 'custom', 'from' => '2026-09-01', 'to' => '2026-09-30'])
        ->and($response->inertiaProps('totals.message_count'))->toBe(73);
});

test('granularity is chosen automatically from the range length', function () {
    expect(analyticsPage(['range' => 'month'])->inertiaProps('granularity'))->toBe(['value' => 'day', 'auto' => true])
        ->and(analyticsPage(['range' => 'custom', 'from' => '2026-06-01', 'to' => '2026-09-30'])->inertiaProps('granularity'))->toBe(['value' => 'week', 'auto' => true])
        ->and(analyticsPage(['range' => 'year'])->inertiaProps('granularity'))->toBe(['value' => 'month', 'auto' => true]);
});

test('the breakdown is limited to 25 rows', function () {
    foreach (range(1, 30) as $i) {
        analyticsPageRollup('2026-09-23', $this->aliceMac, Project::factory()->create(['name' => "Project {$i}"]), null, null, $i);
    }

    analyticsPage(['group' => 'project'])
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('breakdown', 25)
            ->where('breakdown.0.label', 'Project 30'));
});

test('the PRD section 20 example shows 650,000 / 150,000 / 500,000', function () {
    UsageDailyRollup::query()->delete();

    UsageDailyRollup::factory()->create([
        'date' => '2026-09-22',
        'device_id' => $this->aliceMac->id,
        'developer_id' => $this->alice->id,
        'input_tokens' => 100_000,
        'output_tokens' => 20_000,
        'cache_creation_tokens' => 30_000,
        'cache_read_tokens' => 500_000,
        'message_count' => 1,
    ]);

    analyticsPage()
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('totals.total_token_activity', 650_000)
            ->where('totals.actual_consumed_tokens', 150_000)
            ->where('totals.cache_read_tokens', 500_000)
            ->where('breakdown.0.total_token_activity', 650_000)
            ->where('breakdown.0.actual_consumed_tokens', 150_000)
            ->where('trend.1.total_token_activity', 650_000));
});

test('inactive users cannot open the page', function () {
    $this->actingAs(User::factory()->viewer()->create(['is_active' => false]))
        ->get(route('analytics.tokens'))
        ->assertRedirect();
});
