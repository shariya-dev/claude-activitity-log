<?php

use App\Models\ClaudeAccount;
use App\Models\ClaudeModel;
use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\Project;
use App\Models\UsageDailyRollup;
use App\Models\User;
use App\Queries\Analytics\ActivityStats;
use App\Queries\Analytics\DateRange;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\TokenAnalytics;
use App\Queries\Analytics\UsageFilters;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-22 10:00:00', 'Asia/Dhaka'));
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * One developer on three platforms with accounts, projects, models, sessions and rollups; plus an unrelated developer.
 *
 * @return array{developer: Developer, devices: array<string, Device>, account: ClaudeAccount, project: Project, model: ClaudeModel, other: Developer}
 */
function developersShowSeed(): array
{
    $developer = Developer::factory()->create(['name' => 'Multi Platform', 'email' => 'multi@example.test']);
    $devices = [];

    foreach (['macos', 'windows', 'linux'] as $platform) {
        $devices[$platform] = Device::factory()->for($developer)->create([
            'platform' => $platform,
            'hostname' => "host-{$platform}",
            'last_seen_at' => now()->subMinutes(2),
            'last_sync_at' => CarbonImmutable::parse('2026-09-22 03:00:00', 'UTC'),
        ]);
    }

    $account = ClaudeAccount::factory()->for($developer)->create(['email' => 'claude-multi@example.test']);
    $account->devices()->attach([$devices['macos']->id, $devices['linux']->id]);
    $project = Project::factory()->create(['name' => 'monitor']);
    $model = ClaudeModel::factory()->create(['name' => 'claude-opus-5-5']);

    $scale = 1;
    foreach ($devices as $device) {
        foreach (['2026-09-21', '2026-09-22', '2026-09-01'] as $date) {
            UsageDailyRollup::factory()->create([
                'date' => $date,
                'device_id' => $device->id,
                'developer_id' => $developer->id,
                'claude_account_id' => $device->platform === 'windows' ? null : $account->id,
                'project_id' => $project->id,
                'claude_model_id' => $model->id,
                'input_tokens' => 10 * $scale,
                'output_tokens' => 20 * $scale,
                'cache_creation_tokens' => 30 * $scale,
                'cache_read_tokens' => 400 * $scale,
                'message_count' => $scale,
            ]);
            $scale++;
        }

        ClaudeSession::factory()->for($device)->create([
            'developer_id' => $developer->id,
            'claude_account_id' => $device->platform === 'windows' ? null : $account->id,
            'project_id' => $project->id,
            'claude_model_id' => $model->id,
            'started_at' => CarbonImmutable::parse('2026-09-21 02:00:00', 'UTC'),
            'last_activity_at' => CarbonImmutable::parse('2026-09-21 04:00:00', 'UTC'),
        ]);
    }

    $other = Developer::factory()->create();
    $otherDevice = Device::factory()->for($other)->create(['hostname' => 'someone-else']);
    UsageDailyRollup::factory()->create([
        'date' => '2026-09-22', 'device_id' => $otherDevice->id, 'developer_id' => $other->id,
        'input_tokens' => 999_999,
    ]);
    ClaudeSession::factory()->for($otherDevice)->create([
        'developer_id' => $other->id,
        'started_at' => CarbonImmutable::parse('2026-09-21 05:00:00', 'UTC'),
        'last_activity_at' => CarbonImmutable::parse('2026-09-21 06:00:00', 'UTC'),
    ]);
    ClaudeAccount::factory()->for($other)->create();

    return compact('developer', 'devices', 'account', 'project', 'model', 'other');
}

function developersShowProps(mixed $test, Developer $developer, array $query = []): array
{
    return $test->actingAs(User::factory()->viewer()->create())
        ->get(route('developers.show', ['developer' => $developer, ...$query]))
        ->assertOk()
        ->viewData('page')['props'];
}

test('show totals, trend and breakdowns equal the analytics queries with the developer filter', function () {
    ['developer' => $developer] = developersShowSeed();

    $props = developersShowProps($this, $developer, ['range' => 'week']);

    $filters = new UsageFilters(DateRange::preset('week'), $developer->id);
    $analytics = app(TokenAnalytics::class);

    expect($props['totals'])->toBe($analytics->totals($filters))
        ->and($props['totals']['actual_consumed_tokens'])->toBeGreaterThan(0)
        ->and($props['trend'])->toBe($analytics->trend($filters))
        ->and($props['breakdowns']['device'])->toBe($analytics->breakdown($filters, Dimension::Device))
        ->and($props['breakdowns']['account'])->toBe($analytics->breakdown($filters, Dimension::Account))
        ->and($props['breakdowns']['project'])->toBe($analytics->breakdown($filters, Dimension::Project))
        ->and($props['breakdowns']['model'])->toBe($analytics->breakdown($filters, Dimension::Model))
        ->and($props['sessionsCount'])->toBe(app(ActivityStats::class)->sessionsCount($filters))
        ->and($props['sessionsCount'])->toBe(3)
        ->and($props['recentSessions'])->toBe(app(ActivityStats::class)->recentSessions($filters));
});

test('entity filters narrow the totals and cannot escape the developer', function () {
    ['developer' => $developer, 'devices' => $devices, 'other' => $other] = developersShowSeed();

    $props = developersShowProps($this, $developer, ['range' => 'week', 'device' => $devices['linux']->id]);
    $expected = app(TokenAnalytics::class)->totals(
        new UsageFilters(DateRange::preset('week'), $developer->id, $devices['linux']->id),
    );

    expect($props['totals'])->toBe($expected)
        ->and($props['filters'])->toBe(['device' => $devices['linux']->id, 'account' => null, 'project' => null, 'model' => null]);

    $foreignDevice = $other->devices()->firstOrFail();
    $escaped = $this->actingAs(User::factory()->viewer()->create())
        ->get(route('developers.show', $developer).'?'.http_build_query([
            'range' => 'week', 'device' => $foreignDevice->id, 'developer' => $other->id,
        ]))
        ->assertOk()
        ->viewData('page')['props'];

    expect($escaped['developer']['id'])->toBe($developer->id)
        ->and($escaped['totals']['input_tokens'])->toBe(0)
        ->and($escaped['recentSessions'])->toBe([]);
});

test('a developer with three devices on three platforms shows them under one identity', function () {
    ['developer' => $developer, 'account' => $account] = developersShowSeed();

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('developers.show', $developer))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Developers/Show')
            ->where('developer.id', $developer->id)
            ->where('developer.name', 'Multi Platform')
            ->where('developer.email', 'multi@example.test')
            ->where('developer.status', 'active')
            ->where('developer.last_sync_at', '2026-09-22T03:00:00Z')
            ->where('developer.last_activity_at', '2026-09-21T04:00:00Z')
            ->has('devices', 3)
            ->where('devices', fn ($devices) => collect($devices)->pluck('platform')->sort()->values()->all() === ['linux', 'macos', 'windows'])
            ->where('devices.0.connection', 'online')
            ->has('devices.0', fn (Assert $device) => $device->hasAll([
                'id', 'device_uid', 'hostname', 'platform', 'platform_version', 'architecture', 'agent_version',
                'claude_code_version', 'status', 'connection', 'last_seen_at', 'last_sync_at',
            ]))
            ->has('accounts', 1)
            ->where('accounts.0.id', $account->id)
            ->where('accounts.0.email', 'claude-multi@example.test')
            ->has('accounts.0.devices', 2)
            ->has('accounts.0', fn (Assert $row) => $row->hasAll([
                'id', 'email', 'display_name', 'status', 'first_seen_at', 'last_seen_at', 'devices',
            ]))
            ->where('pairingCodeTtlMinutes', 15));
});

test('filter options are limited to the developer own devices, accounts, projects and models', function () {
    ['developer' => $developer, 'devices' => $devices, 'account' => $account, 'project' => $project, 'model' => $model] = developersShowSeed();
    Project::factory()->create(['name' => 'unrelated project']);
    ClaudeModel::factory()->create(['name' => 'unrelated-model']);

    $options = developersShowProps($this, $developer)['filterOptions'];

    expect(array_keys($options))->toBe(['device', 'account', 'project', 'model'])
        ->and(collect($options['device'])->pluck('id')->sort()->values()->all())
        ->toBe(collect($devices)->pluck('id')->sort()->values()->all())
        ->and($options['device'][0]['label'])->toBe('host-linux (linux)')
        ->and($options['account'])->toBe([['id' => $account->id, 'label' => 'claude-multi@example.test']])
        ->and($options['project'])->toBe([['id' => $project->id, 'label' => 'monitor']])
        ->and($options['model'])->toBe([['id' => $model->id, 'label' => 'claude-opus-5-5']]);
});

test('an inactive developer detail page still shows history', function () {
    ['developer' => $developer] = developersShowSeed();
    $developer->update(['status' => 'inactive']);

    $props = developersShowProps($this, $developer, ['range' => 'week']);

    expect($props['developer']['status'])->toBe('inactive')
        ->and($props['devices'])->toHaveCount(3)
        ->and($props['totals']['total_token_activity'])->toBeGreaterThan(0);
});

test('the detail page query count does not grow with devices and accounts', function () {
    ['developer' => $developer] = developersShowSeed();
    $viewer = User::factory()->viewer()->create();

    $countQueries = function () use ($viewer, $developer): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->actingAs($viewer)->get(route('developers.show', $developer))->assertOk();
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $count;
    };

    $before = $countQueries();

    $newDevices = Device::factory()->count(4)->for($developer)->create();
    foreach ($newDevices as $device) {
        ClaudeAccount::factory()->for($developer)->create()->devices()->attach($device->id);
    }

    expect($countQueries())->toBe($before);
});

test('unknown developers return 404', function () {
    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('developers.show', ['developer' => 999_999]))
        ->assertNotFound();
});
