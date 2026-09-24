<?php

use App\Models\ClaudeAccount;
use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\UsageDailyRollup;
use App\Models\User;
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
 * A developer with devices, an account, sessions and rollups; half inside "This Week" (2026-09-21 … 09-27), half before it.
 */
function developersIndexSeed(Developer $developer, int $scale = 1): void
{
    $devices = Device::factory()->count(2)->for($developer)->create([
        'last_sync_at' => CarbonImmutable::parse('2026-09-22 03:00:00', 'UTC'),
    ]);
    ClaudeAccount::factory()->for($developer)->create();

    ClaudeSession::factory()->for($devices[0])->create([
        'developer_id' => $developer->id,
        'started_at' => CarbonImmutable::parse('2026-09-21 02:00:00', 'UTC'),
        'last_activity_at' => CarbonImmutable::parse('2026-09-21 04:00:00', 'UTC'),
    ]);
    ClaudeSession::factory()->for($devices[1])->create([
        'developer_id' => $developer->id,
        'started_at' => CarbonImmutable::parse('2026-09-15 02:00:00', 'UTC'),
        'last_activity_at' => CarbonImmutable::parse('2026-09-15 04:00:00', 'UTC'),
    ]);

    foreach (['2026-09-21' => 1, '2026-09-10' => 100] as $date => $multiplier) {
        UsageDailyRollup::factory()->create([
            'date' => $date,
            'device_id' => $devices[0]->id,
            'developer_id' => $developer->id,
            'input_tokens' => 10 * $scale * $multiplier,
            'output_tokens' => 20 * $scale * $multiplier,
            'cache_creation_tokens' => 30 * $scale * $multiplier,
            'cache_read_tokens' => 400 * $scale * $multiplier,
        ]);
    }
}

test('the list shows range-scoped counts and token metrics per developer', function () {
    $developer = Developer::factory()->create(['name' => 'Alpha', 'email' => 'alpha@example.test', 'team' => 'Backend']);
    developersIndexSeed($developer);

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('developers.index', ['range' => 'week']))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Developers/Index')
            ->where('range.preset', 'week')
            ->where('filters.search', null)
            ->where('filters.status', null)
            ->has('developers.data', 1)
            ->where('developers.per_page', 25)
            ->where('developers.data.0.id', $developer->id)
            ->where('developers.data.0.name', 'Alpha')
            ->where('developers.data.0.email', 'alpha@example.test')
            ->where('developers.data.0.team', 'Backend')
            ->where('developers.data.0.status', 'active')
            ->where('developers.data.0.devices_count', 2)
            ->where('developers.data.0.claude_accounts_count', 1)
            ->where('developers.data.0.sessions_count', 1)
            ->where('developers.data.0.actual_consumed_tokens', 60)
            ->where('developers.data.0.total_token_activity', 460)
            ->where('developers.data.0.last_activity_at', '2026-09-21T04:00:00Z')
            ->where('developers.data.0.last_sync_at', '2026-09-22T03:00:00Z'));
});

test('developers without activity show zeros and no timestamps', function () {
    Developer::factory()->create();

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('developers.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('developers.data.0.devices_count', 0)
            ->where('developers.data.0.sessions_count', 0)
            ->where('developers.data.0.actual_consumed_tokens', 0)
            ->where('developers.data.0.total_token_activity', 0)
            ->where('developers.data.0.last_activity_at', null)
            ->where('developers.data.0.last_sync_at', null));
});

test('search matches name, email or team and status filters', function () {
    Developer::factory()->create(['name' => 'Grace Hopper', 'email' => 'grace@example.test', 'team' => 'Compilers']);
    Developer::factory()->create(['name' => 'Linus', 'email' => 'linus@example.test', 'team' => 'Kernel']);
    Developer::factory()->inactive()->create(['name' => 'Retired', 'email' => 'retired@example.test', 'team' => 'Kernel']);
    $viewer = User::factory()->viewer()->create();

    $names = fn (array $query) => collect(
        $this->actingAs($viewer)->get(route('developers.index', $query))->viewData('page')['props']['developers']['data']
    )->pluck('name')->sort()->values()->all();

    expect($names(['search' => 'grace']))->toBe(['Grace Hopper'])
        ->and($names(['search' => 'linus@']))->toBe(['Linus'])
        ->and($names(['search' => 'kernel']))->toBe(['Linus', 'Retired'])
        ->and($names(['status' => 'inactive']))->toBe(['Retired'])
        ->and($names(['status' => 'active', 'search' => 'kernel']))->toBe(['Linus'])
        ->and($names(['status' => 'bogus']))->toBe(['Grace Hopper', 'Linus', 'Retired']);
});

test('soft-deleted developers are not listed', function () {
    Developer::factory()->create(['name' => 'Kept']);
    Developer::factory()->create(['name' => 'Gone'])->delete();

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('developers.index'))
        ->assertInertia(fn (Assert $page) => $page->has('developers.data', 1)->where('developers.data.0.name', 'Kept'));
});

test('the list paginates 25 per page', function () {
    Developer::factory()->count(27)->create();

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('developers.index', ['page' => 2]))
        ->assertInertia(fn (Assert $page) => $page
            ->has('developers.data', 2)
            ->where('developers.total', 27)
            ->where('developers.current_page', 2));
});

test('the list query count does not grow with the number of developers', function () {
    $viewer = User::factory()->viewer()->create();

    $countQueries = function () use ($viewer): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->actingAs($viewer)->get(route('developers.index'))->assertOk();
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $count;
    };

    developersIndexSeed(Developer::factory()->create());
    $few = $countQueries();

    foreach (range(1, 5) as $i) {
        developersIndexSeed(Developer::factory()->create(), $i);
    }

    expect($countQueries())->toBe($few);
});

test('array query params are ignored instead of failing', function () {
    Developer::factory()->create();

    $this->actingAs(User::factory()->viewer()->create())
        ->get('/developers?search[]=x&status[]=active')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('filters.search', null)->where('filters.status', null)->has('developers.data', 1));
});

test('range scoping uses org-timezone day boundaries, inclusive', function () {
    $developer = Developer::factory()->create();
    $device = Device::factory()->for($developer)->create();

    // Monday 2026-09-21 01:00 Asia/Dhaka (inside) and Monday 2026-09-28 01:00 Asia/Dhaka (outside), both Sunday in UTC.
    foreach (['2026-09-20 19:00:00', '2026-09-27 19:00:00'] as $startedAt) {
        ClaudeSession::factory()->for($device)->create([
            'developer_id' => $developer->id,
            'started_at' => CarbonImmutable::parse($startedAt, 'UTC'),
            'last_activity_at' => CarbonImmutable::parse($startedAt, 'UTC')->addMinutes(5),
        ]);
    }

    foreach (['2026-09-20' => 1000, '2026-09-21' => 1, '2026-09-27' => 2, '2026-09-28' => 1000] as $date => $input) {
        UsageDailyRollup::factory()->create([
            'date' => $date, 'device_id' => $device->id, 'developer_id' => $developer->id,
            'input_tokens' => $input, 'output_tokens' => 0, 'cache_creation_tokens' => 0, 'cache_read_tokens' => 0,
        ]);
    }

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('developers.index', ['range' => 'week']))
        ->assertInertia(fn (Assert $page) => $page
            ->where('developers.data.0.sessions_count', 1)
            ->where('developers.data.0.actual_consumed_tokens', 3)
            ->where('developers.data.0.total_token_activity', 3));
});
