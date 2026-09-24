<?php

use App\Models\AgentSyncState;
use App\Models\Developer;
use App\Models\Device;
use App\Models\TrackingSetting;
use App\Queries\Analytics\AgentHealth;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;

uses(RefreshDatabase::class);

/**
 * "Now" is 2026-09-22 04:00:00 UTC. Online ≤ 10 min, stale ≤ 24 h, otherwise offline.
 */
function healthDevice(?string $lastSeenUtc, string $agentVersion = '1.2.0', array $attributes = []): Device
{
    return Device::factory()->create([
        'last_seen_at' => $lastSeenUtc,
        'last_sync_at' => $lastSeenUtc,
        'agent_version' => $agentVersion,
        ...$attributes,
    ]);
}

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-22 10:00:00', 'Asia/Dhaka'));
    TrackingSetting::current()->update(['min_agent_version' => '1.2.0']);
});

afterEach(function () {
    Carbon::setTestNow();
});

test('summary classifies connection state at the thresholds', function () {
    healthDevice('2026-09-22 03:50:00');           // exactly 10 min → online
    healthDevice('2026-09-22 03:49:59');           // 10 min 1 s → stale
    healthDevice('2026-09-21 04:00:00');           // exactly 24 h → stale
    healthDevice('2026-09-21 03:59:59');           // 24 h 1 s → offline
    healthDevice(null);                            // never seen → offline

    expect(app(AgentHealth::class)->summary())->toBe([
        'online' => 1, 'stale' => 2, 'offline' => 2, 'disabled' => 0, 'uninstalled' => 0, 'outdated' => 0, 'sync_failed' => 0,
    ]);
});

test('summary counts disabled, uninstalled, outdated and sync-failed agents', function () {
    healthDevice('2026-09-22 03:59:00', '1.1.9');                       // outdated
    healthDevice('2026-09-22 03:59:00', '1.10.0');                      // newer (semver, not string compare)
    healthDevice('2026-09-22 03:59:00', '1.2.0');
    $failing = healthDevice('2026-09-22 03:59:00');
    AgentSyncState::factory()->for($failing)->failing()->create();
    Device::factory()->disabled()->create(['agent_version' => '0.9.0']);  // not also counted as outdated
    Device::factory()->uninstalled()->create();
    Device::factory()->uninstalled()->create();

    expect(app(AgentHealth::class)->summary())->toBe([
        'online' => 4, 'stale' => 0, 'offline' => 0, 'disabled' => 1, 'uninstalled' => 2, 'outdated' => 1, 'sync_failed' => 1,
    ]);
});

test('problem agents lists stale, offline, sync-failed and outdated active agents, oldest first', function () {
    $developer = Developer::factory()->create(['name' => 'Nadia Islam']);
    healthDevice('2026-09-22 03:59:00');                                                   // healthy → excluded
    $stale = healthDevice('2026-09-22 01:00:00', '1.2.0', ['developer_id' => $developer->id, 'hostname' => 'nadia-mbp', 'platform' => 'macos']);
    $offline = healthDevice('2026-09-18 12:00:00');
    $never = healthDevice(null);
    $outdated = healthDevice('2026-09-22 03:58:00', '1.0.0');
    $failing = healthDevice('2026-09-22 03:59:30');
    AgentSyncState::factory()->for($failing)->failing()->create();
    Device::factory()->disabled()->create(['last_seen_at' => '2026-09-01 00:00:00']);        // intentional → excluded
    Device::factory()->uninstalled()->create(['last_seen_at' => '2026-09-01 00:00:00']);     // intentional → excluded

    $rows = app(AgentHealth::class)->problemAgents();

    expect(array_column($rows, 'device_id'))->toBe([$never->id, $offline->id, $stale->id, $outdated->id, $failing->id])
        ->and($rows[2])->toBe([
            'device_id' => $stale->id,
            'device_uid' => $stale->device_uid,
            'hostname' => 'nadia-mbp',
            'developer' => 'Nadia Islam',
            'platform' => 'macos',
            'agent_version' => '1.2.0',
            'last_seen_at' => '2026-09-22T01:00:00Z',
            'last_sync_at' => '2026-09-22T01:00:00Z',
            'connection' => 'stale',
            'health' => 'healthy',
            'outdated' => false,
        ])
        ->and($rows[0]['last_seen_at'])->toBeNull()
        ->and($rows[1]['connection'])->toBe('offline')
        ->and($rows[1]['health'])->toBe('offline')
        ->and($rows[3]['outdated'])->toBeTrue()
        ->and($rows[4]['health'])->toBe('sync_failed')
        ->and($rows[4]['connection'])->toBe('online');
});

test('problem agents honours the limit', function () {
    healthDevice('2026-09-18 12:00:00');
    healthDevice('2026-09-17 12:00:00');
    healthDevice('2026-09-16 12:00:00');

    expect(app(AgentHealth::class)->problemAgents(2))->toHaveCount(2);
});

test('a stale stored offline health does not outlive a reconnect, and unknown versions are not outdated', function () {
    $back = healthDevice('2026-09-22 03:59:00', '1.2.0');
    AgentSyncState::factory()->for($back)->create(['health' => 'offline']);
    $unknown = healthDevice('2026-09-22 03:59:00', '1.2.0', ['agent_version' => null]);

    expect(app(AgentHealth::class)->problemAgents())->toBe([])
        ->and(app(AgentHealth::class)->summary()['outdated'])->toBe(0)
        ->and($unknown->agent_version)->toBeNull();
});
