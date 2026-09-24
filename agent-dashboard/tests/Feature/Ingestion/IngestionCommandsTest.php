<?php

use App\Enums\SyncHealth;
use App\Models\AgentSyncState;
use App\Models\Device;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    $this->travelTo(Carbon::parse('2026-09-23T12:00:00Z'));
});

/**
 * Two projects, two sessions on two org days (2026-09-21 and 2026-09-22), two usage rows each.
 */
function seedRecalculationData(): void
{
    ingestionDevice();

    postSync(syncBody([
        'projects' => [syncProject('alpha'), syncProject('beta')],
        'sessions' => [
            syncSession('day-one', ['project_key' => projectKey('alpha'), 'first_seen_at' => syncIso('2026-09-21T05:00:00Z'), 'last_seen_at' => syncIso('2026-09-21T07:00:00Z')]),
            syncSession('day-two', ['project_key' => projectKey('beta'), 'first_seen_at' => syncIso('2026-09-22T05:00:00Z'), 'last_seen_at' => syncIso('2026-09-22T07:00:00Z')]),
        ],
        'usage' => [
            syncUsage('msg_d1_a', 'day-one', ['recorded_at' => syncIso('2026-09-21T06:00:00Z'), 'input_tokens' => 5, 'output_tokens' => 50, 'cache_creation_tokens' => 500, 'cache_read_tokens' => 5000]),
            syncUsage('msg_d1_b', 'day-one', ['recorded_at' => syncIso('2026-09-21T06:30:00Z'), 'input_tokens' => 1, 'output_tokens' => 2, 'cache_creation_tokens' => 3, 'cache_read_tokens' => 4]),
            syncUsage('msg_d2_a', 'day-two', ['recorded_at' => syncIso('2026-09-22T06:00:00Z'), 'input_tokens' => 7, 'output_tokens' => 70, 'cache_creation_tokens' => 700, 'cache_read_tokens' => 7000]),
            syncUsage('msg_d2_b', 'day-two', ['recorded_at' => syncIso('2026-09-22T06:30:00Z'), 'input_tokens' => 9, 'output_tokens' => 90, 'cache_creation_tokens' => 900, 'cache_read_tokens' => 9000]),
        ],
    ]))->assertOk()->assertJsonPath('sync.rejected', 0);
}

/**
 * @return array<string, mixed>
 */
function tokenSnapshot(): array
{
    $columns = tokenColumns();

    return [
        'usage' => DB::table('session_usage')->orderBy('source_message_id')->get(['source_message_id', ...$columns])->map(fn ($r) => (array) $r)->all(),
        'sessions' => DB::table('claude_sessions')->orderBy('source_session_id')->get(['source_session_id', 'activity_count', ...$columns])->map(fn ($r) => (array) $r)->all(),
        'projects' => DB::table('projects')->orderBy('project_key')->get(['project_key', 'session_count', ...$columns])->map(fn ($r) => (array) $r)->all(),
        'rollups' => rollupSnapshot(),
    ];
}

function corruptTokenTotals(): void
{
    $zeroed = array_fill_keys(tokenColumns(), 0);

    DB::table('session_usage')->update(['actual_consumed_tokens' => 0, 'total_token_activity' => 0]);
    DB::table('claude_sessions')->update($zeroed);
    DB::table('projects')->update($zeroed);
    DB::table('usage_daily_rollups')->update($zeroed + ['message_count' => 0]);
}

test('monitor:recalculate-tokens reproduces identical totals after corruption', function () {
    seedRecalculationData();
    $original = tokenSnapshot();

    expect($original['usage'])->toHaveCount(4)
        ->and($original['rollups'])->toHaveCount(2);

    corruptTokenTotals();
    expect(tokenSnapshot())->not->toEqual($original);

    $this->artisan('monitor:recalculate-tokens')->assertSuccessful();

    $restored = tokenSnapshot();
    expect($restored['usage'])->toEqual($original['usage'])
        ->and($restored['sessions'])->toEqual($original['sessions'])
        ->and($restored['projects'])->toEqual($original['projects'])
        ->and($restored['rollups'])->toEqual($original['rollups']);
});

test('monitor:recalculate-tokens also rebuilds deleted rollups', function () {
    seedRecalculationData();
    $original = rollupSnapshot();

    DB::table('usage_daily_rollups')->delete();

    $this->artisan('monitor:recalculate-tokens')->assertSuccessful();

    expect(rollupSnapshot())->toEqual($original);
});

test('monitor:recalculate-tokens --from/--to limits the org-date range', function () {
    seedRecalculationData();
    $original = tokenSnapshot();

    corruptTokenTotals();

    $this->artisan('monitor:recalculate-tokens', ['--from' => '2026-09-22', '--to' => '2026-09-22'])->assertSuccessful();

    $usage = DB::table('session_usage')->get()->keyBy('source_message_id');
    $originalUsage = collect($original['usage'])->keyBy('source_message_id');

    expect((int) $usage['msg_d2_a']->total_token_activity)->toBe((int) $originalUsage['msg_d2_a']['total_token_activity'])
        ->and((int) $usage['msg_d2_b']->actual_consumed_tokens)->toBe((int) $originalUsage['msg_d2_b']['actual_consumed_tokens'])
        ->and((int) $usage['msg_d1_a']->total_token_activity)->toBe(0)
        ->and((int) $usage['msg_d1_b']->actual_consumed_tokens)->toBe(0);

    $rollups = DB::table('usage_daily_rollups')->get()->keyBy(fn ($row) => Carbon::parse($row->date)->format('Y-m-d'));
    expect((int) $rollups['2026-09-22']->total_token_activity)->toBe(9999 + 7777)
        ->and((int) $rollups['2026-09-22']->message_count)->toBe(2)
        ->and((int) $rollups['2026-09-21']->total_token_activity)->toBe(0);

    $session = DB::table('claude_sessions')->where('source_session_id', 'day-two')->first();
    expect((int) $session->total_token_activity)->toBe(9999 + 7777);
});

test('monitor:mark-offline refreshes agent_sync_states.health', function () {
    $offline = Device::factory()->create(['last_seen_at' => now()->subDays(2)]);
    AgentSyncState::factory()->create([
        'device_id' => $offline->id,
        'health' => SyncHealth::Healthy,
        'last_success_at' => now()->subDays(2),
    ]);

    $recent = Device::factory()->create(['last_seen_at' => now()->subMinute()]);
    AgentSyncState::factory()->create([
        'device_id' => $recent->id,
        'health' => SyncHealth::Offline,
        'last_success_at' => now()->subMinutes(2),
        'last_failure_at' => now()->subHour(),
    ]);

    $failing = Device::factory()->create(['last_seen_at' => now()->subMinute()]);
    AgentSyncState::factory()->create([
        'device_id' => $failing->id,
        'health' => SyncHealth::Healthy,
        'last_success_at' => now()->subHour(),
        'last_failure_at' => now()->subMinutes(5),
        'last_error_code' => 'persistence_failed',
        'consecutive_failures' => 2,
    ]);

    $disabled = Device::factory()->disabled()->create(['last_seen_at' => now()->subMinute()]);
    AgentSyncState::factory()->create([
        'device_id' => $disabled->id,
        'health' => SyncHealth::Healthy,
        'last_success_at' => now()->subMinutes(2),
    ]);

    $this->artisan('monitor:mark-offline')->assertSuccessful();

    $health = fn (Device $device) => AgentSyncState::where('device_id', $device->id)->sole()->health;

    expect($health($offline))->toBe(SyncHealth::Offline)
        ->and($health($recent))->toBe(SyncHealth::Healthy)
        ->and($health($failing))->toBe(SyncHealth::SyncFailed)
        ->and($health($disabled))->toBe(SyncHealth::Disabled);
});

test('monitor:mark-offline is scheduled every five minutes', function () {
    $events = collect(app(Schedule::class)->events())
        ->filter(fn ($event) => str_contains((string) $event->command, 'monitor:mark-offline'));

    expect($events)->toHaveCount(1)
        ->and($events->first()->expression)->toBe('*/5 * * * *');
});
