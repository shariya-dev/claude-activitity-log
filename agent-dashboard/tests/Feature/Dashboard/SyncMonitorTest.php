<?php

use App\Models\AgentSyncState;
use App\Models\Device;
use App\Models\SyncBatch;
use App\Models\TrackingSetting;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-22 10:00:00', 'Asia/Dhaka'));
    TrackingSetting::current()->update(['min_agent_version' => '1.2.0']);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * One device per health state plus an outdated healthy one.
 *
 * @return array<string, Device>
 */
function syncMonitorFleet(): array
{
    $healthy = Device::factory()->online()->create(['hostname' => 'healthy', 'agent_version' => '1.2.0']);
    AgentSyncState::factory()->synced()->create(['device_id' => $healthy->id, 'records_created_total' => 40, 'records_updated_total' => 4, 'records_rejected_total' => 1]);

    $outdated = Device::factory()->online()->create(['hostname' => 'outdated', 'agent_version' => '1.0.0']);

    $offline = Device::factory()->offline()->create(['hostname' => 'offline', 'agent_version' => '1.2.0']);

    $failing = Device::factory()->online()->create(['hostname' => 'failing', 'agent_version' => '1.2.0']);
    AgentSyncState::factory()->failing()->create([
        'device_id' => $failing->id,
        'last_error_message' => str_repeat('x', 400),
    ]);

    $disabled = Device::factory()->disabled()->create(['hostname' => 'disabled', 'agent_version' => '1.2.0']);

    return compact('healthy', 'outdated', 'offline', 'failing', 'disabled');
}

test('guests are redirected and viewers can open the sync monitor', function () {
    $this->get(route('sync.index'))->assertRedirect(route('login'));

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('sync.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Sync/Index'));
});

test('summary cards count Healthy, Offline, Sync Failed, Disabled and Outdated', function () {
    syncMonitorFleet();

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('sync.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('counts', [
                'healthy' => 2,
                'offline' => 1,
                'sync_failed' => 1,
                'disabled' => 1,
                'uninstalled' => 0,
                'outdated' => 1,
                'total' => 5,
            ])
            ->has('devices', 5)
            ->where('filters.health', null)
        );
});

test('device rows carry sync totals, last error and truncated message', function () {
    $fleet = syncMonitorFleet();

    $rows = [];
    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('sync.index'))
        ->assertInertia(function (Assert $page) use (&$rows) {
            $rows = collect($page->toArray()['props']['devices'])->keyBy('hostname')->all();
        });

    expect($rows['healthy'])->toMatchArray([
        'device_uid' => $fleet['healthy']->device_uid,
        'developer' => $fleet['healthy']->developer->name,
        'health' => 'healthy',
        'agent_version' => '1.2.0',
        'records_created_total' => 40,
        'records_updated_total' => 4,
        'records_rejected_total' => 1,
    ])
        ->and($rows['healthy']['last_success_at'])->not->toBeNull()
        ->and($rows['failing']['health'])->toBe('sync_failed')
        ->and($rows['failing']['last_error_code'])->toBe('persistence_failed')
        ->and($rows['failing']['last_failure_at'])->toBe('2026-09-22T04:00:00Z')
        ->and(mb_strlen($rows['failing']['last_error_message']))->toBeLessThanOrEqual(200)
        ->and($rows['outdated']['outdated'])->toBeTrue()
        ->and($rows['outdated']['records_created_total'])->toBe(0)
        ->and($rows['offline']['health'])->toBe('offline')
        ->and($rows['disabled']['health'])->toBe('disabled')
        ->and(array_key_first($rows))->toBe('failing');
});

test('health filter narrows the device table but not the summary', function (string $health, string $hostname) {
    syncMonitorFleet();

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('sync.index', ['health' => $health]))
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.health', $health)
            ->has('devices', $health === 'healthy' ? 2 : 1)
            ->where('devices.0.hostname', $hostname)
            ->where('counts.total', 5)
        );
})->with([
    'healthy' => ['healthy', 'outdated'],
    'offline' => ['offline', 'offline'],
    'sync failed' => ['sync_failed', 'failing'],
    'disabled' => ['disabled', 'disabled'],
]);

test('an unknown health filter is ignored', function () {
    syncMonitorFleet();

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('sync.index', ['health' => 'bogus']))
        ->assertInertia(fn (Assert $page) => $page->where('filters.health', null)->has('devices', 5));
});

test('recent failures lists failed and rejection-bearing batches from the last 7 days with rejections', function () {
    $device = Device::factory()->create(['hostname' => 'alice-mbp']);
    $failed = SyncBatch::factory()->failed()->create(['device_id' => $device->id, 'received_at' => now()->subHour()]);
    $rejecting = SyncBatch::factory()->create([
        'device_id' => $device->id,
        'received_at' => now()->subDays(2),
        'rejected' => 1,
        'rejections' => [['type' => 'usage', 'source_id' => 'msg_9', 'reason' => 'invalid_tokens']],
    ]);
    SyncBatch::factory()->create(['device_id' => $device->id, 'received_at' => now()->subMinutes(5)]);
    SyncBatch::factory()->failed()->create(['device_id' => $device->id, 'received_at' => now()->subDays(8)]);

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('sync.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->has('recent_failures', 2)
            ->where('recent_failures.0.id', $failed->id)
            ->where('recent_failures.0.status', 'failed')
            ->where('recent_failures.0.error_code', 'persistence_failed')
            ->where('recent_failures.0.device_uid', $device->device_uid)
            ->where('recent_failures.0.hostname', 'alice-mbp')
            ->where('recent_failures.0.developer', $device->developer->name)
            ->where('recent_failures.1.id', $rejecting->id)
            ->where('recent_failures.1.rejections', [['type' => 'usage', 'source_id' => 'msg_9', 'reason' => 'invalid_tokens']])
            ->missing('recent_failures.0.response')
        );
});

test('outdated counts only active agents and uninstalled devices are reported within disabled', function () {
    Device::factory()->online()->create(['agent_version' => '1.0.0']);
    Device::factory()->disabled()->create(['agent_version' => '1.0.0']);
    Device::factory()->uninstalled()->create(['hostname' => 'gone', 'agent_version' => '1.0.0']);

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('sync.index', ['health' => 'disabled']))
        ->assertInertia(fn (Assert $page) => $page
            ->where('counts.outdated', 1)
            ->where('counts.disabled', 2)
            ->where('counts.uninstalled', 1)
            ->has('devices', 2)
            ->where('devices.1.hostname', 'gone')
            ->where('devices.1.status', 'uninstalled')
        );
});

test('sync monitor never exposes credentials, fingerprints, cursors or network data', function () {
    $device = Device::factory()->create(['last_public_ip' => '203.0.113.9']);
    AgentSyncState::factory()->failing()->create(['device_id' => $device->id, 'cursor' => 'opaque-cursor-value']);
    SyncBatch::factory()->failed()->create(['device_id' => $device->id, 'received_at' => now()->subHour(), 'response' => ['cursor' => 'replay-cursor-value']]);
    $token = $device->createToken('agent', ['agent'])->plainTextToken;

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('sync.index'))
        ->assertOk()
        ->assertDontSee('203.0.113.9')
        ->assertDontSee($device->machine_fingerprint)
        ->assertDontSee('opaque-cursor-value')
        ->assertDontSee('replay-cursor-value')
        ->assertDontSee(explode('|', $token)[1]);
});
