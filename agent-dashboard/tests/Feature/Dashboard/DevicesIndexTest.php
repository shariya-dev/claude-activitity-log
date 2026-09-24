<?php

use App\Enums\SyncHealth;
use App\Models\AgentSyncState;
use App\Models\Developer;
use App\Models\Device;
use App\Models\TrackingSetting;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

/**
 * "Now" is 2026-09-22 04:00:00 UTC. Online ≤ 10 min, stale ≤ 24 h, otherwise offline.
 */
beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-22 10:00:00', 'Asia/Dhaka'));
    TrackingSetting::current()->update(['min_agent_version' => '1.2.0']);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * @return array<string, array<string, mixed>>
 */
function deviceIndexRows(User $user, array $query = []): array
{
    $rows = [];

    test()->actingAs($user)
        ->get(route('devices.index', $query))
        ->assertOk()
        ->assertInertia(function (Assert $page) use (&$rows) {
            $page->component('Devices/Index');
            $rows = $page->toArray()['props']['devices'];
        });

    return collect($rows)->keyBy('hostname')->all();
}

test('guests are redirected to login', function () {
    $this->get(route('devices.index'))->assertRedirect(route('login'));
});

test('viewers can list devices with the PRD §49 columns', function () {
    $device = Device::factory()->online()->create([
        'hostname' => 'alice-mbp',
        'platform' => 'macos',
        'platform_version' => '26.0',
        'architecture' => 'arm64',
        'agent_version' => '1.2.0',
        'claude_code_version' => '2.1.274',
    ]);

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('devices.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Devices/Index')
            ->where('min_agent_version', '1.2.0')
            ->has('devices', 1)
            ->where('devices.0.device_uid', $device->device_uid)
            ->where('devices.0.developer.id', $device->developer_id)
            ->where('devices.0.developer.name', $device->developer->name)
            ->where('devices.0.hostname', 'alice-mbp')
            ->where('devices.0.platform', 'macos')
            ->where('devices.0.platform_version', '26.0')
            ->where('devices.0.architecture', 'arm64')
            ->where('devices.0.agent_version', '1.2.0')
            ->where('devices.0.outdated', false)
            ->where('devices.0.claude_code_version', '2.1.274')
            ->where('devices.0.status', 'active')
            ->where('devices.0.connection', 'online')
            ->where('devices.0.health', 'healthy')
            ->where('devices.0.last_seen_at', '2026-09-22T03:58:00Z')
            ->has('devices.0', 14)
            ->has('options.platforms')
            ->has('options.developers', 1)
        );
});

test('connection state is derived at the threshold boundaries', function () {
    $viewer = User::factory()->viewer()->create();
    Device::factory()->create(['hostname' => 'at-10-min', 'last_seen_at' => '2026-09-22 03:50:00']);
    Device::factory()->create(['hostname' => 'past-10-min', 'last_seen_at' => '2026-09-22 03:49:59']);
    Device::factory()->create(['hostname' => 'at-24-h', 'last_seen_at' => '2026-09-21 04:00:00']);
    Device::factory()->create(['hostname' => 'past-24-h', 'last_seen_at' => '2026-09-21 03:59:59']);
    Device::factory()->create(['hostname' => 'never-seen', 'last_seen_at' => null]);

    $rows = deviceIndexRows($viewer);

    expect($rows['at-10-min']['connection'])->toBe('online')
        ->and($rows['past-10-min']['connection'])->toBe('stale')
        ->and($rows['at-24-h']['connection'])->toBe('stale')
        ->and($rows['past-24-h']['connection'])->toBe('offline')
        ->and($rows['never-seen']['connection'])->toBe('offline')
        ->and($rows['past-24-h']['health'])->toBe('offline')
        ->and($rows['at-24-h']['health'])->toBe('healthy');
});

test('sync health comes from agent_sync_states and disabled devices report disabled', function () {
    $viewer = User::factory()->viewer()->create();
    $failing = Device::factory()->online()->create(['hostname' => 'failing']);
    AgentSyncState::factory()->failing()->create(['device_id' => $failing->id]);
    Device::factory()->online()->disabled()->create(['hostname' => 'disabled', 'agent_version' => '1.2.0']);
    Device::factory()->uninstalled()->create(['hostname' => 'uninstalled']);

    $rows = deviceIndexRows($viewer);

    expect($rows['failing']['health'])->toBe(SyncHealth::SyncFailed->value)
        ->and($rows['disabled']['health'])->toBe('disabled')
        ->and($rows['disabled']['status'])->toBe('disabled')
        ->and($rows['uninstalled']['health'])->toBe('disabled')
        ->and($rows['uninstalled']['status'])->toBe('uninstalled');
});

test('agent version below the minimum is flagged outdated', function () {
    $viewer = User::factory()->viewer()->create();
    Device::factory()->online()->create(['hostname' => 'old', 'agent_version' => '1.1.9']);
    Device::factory()->online()->create(['hostname' => 'current', 'agent_version' => 'v1.2.0']);
    Device::factory()->online()->create(['hostname' => 'unknown', 'agent_version' => null]);

    $rows = deviceIndexRows($viewer);

    expect($rows['old']['outdated'])->toBeTrue()
        ->and($rows['current']['outdated'])->toBeFalse()
        ->and($rows['unknown']['outdated'])->toBeFalse();
});

test('default sort puts problems first', function () {
    $viewer = User::factory()->viewer()->create();
    Device::factory()->disabled()->create(['hostname' => 'disabled', 'agent_version' => '1.2.0']);
    Device::factory()->online()->create(['hostname' => 'healthy', 'agent_version' => '1.2.0']);
    Device::factory()->online()->create(['hostname' => 'outdated', 'agent_version' => '1.0.0']);
    Device::factory()->stale()->create(['hostname' => 'stale']);
    Device::factory()->offline()->create(['hostname' => 'offline']);
    $failing = Device::factory()->online()->create(['hostname' => 'failing']);
    AgentSyncState::factory()->failing()->create(['device_id' => $failing->id]);

    expect(array_keys(deviceIndexRows($viewer)))
        ->toBe(['failing', 'offline', 'stale', 'outdated', 'healthy', 'disabled']);
});

test('filters by platform, status, connection, outdated and developer', function () {
    $viewer = User::factory()->viewer()->create();
    $alice = Developer::factory()->create(['name' => 'Alice']);
    Device::factory()->online()->create(['hostname' => 'mac', 'platform' => 'macos', 'developer_id' => $alice->id, 'agent_version' => '1.2.0']);
    Device::factory()->stale()->create(['hostname' => 'win', 'platform' => 'windows', 'agent_version' => '1.0.0']);
    Device::factory()->offline()->disabled()->create(['hostname' => 'linux', 'platform' => 'linux', 'agent_version' => '1.2.0']);

    expect(array_keys(deviceIndexRows($viewer, ['platform' => 'windows'])))->toBe(['win'])
        ->and(array_keys(deviceIndexRows($viewer, ['status' => 'disabled'])))->toBe(['linux'])
        ->and(array_keys(deviceIndexRows($viewer, ['connection' => 'online'])))->toBe(['mac'])
        ->and(array_keys(deviceIndexRows($viewer, ['outdated' => '1'])))->toBe(['win'])
        ->and(array_keys(deviceIndexRows($viewer, ['outdated' => '0'])))->toEqualCanonicalizing(['mac', 'linux'])
        ->and(array_keys(deviceIndexRows($viewer, ['developer' => $alice->id])))->toBe(['mac'])
        ->and(array_keys(deviceIndexRows($viewer, ['platform' => 'bogus', 'status' => 'nope', 'connection' => 'x'])))->toHaveCount(3);
});

test('applied filters are echoed back', function () {
    $alice = Developer::factory()->create();

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('devices.index', ['platform' => 'linux', 'status' => 'active', 'connection' => 'stale', 'outdated' => '1', 'developer' => $alice->id]))
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.platform', 'linux')
            ->where('filters.status', 'active')
            ->where('filters.connection', 'stale')
            ->where('filters.outdated', true)
            ->where('filters.developer', $alice->id)
        );
});

test('device rows never expose credentials, fingerprints or network data', function () {
    $device = Device::factory()->online()->create(['last_public_ip' => '203.0.113.9']);
    $device->createToken('agent', ['agent']);

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('devices.index'))
        ->assertOk()
        ->assertDontSee('203.0.113.9')
        ->assertDontSee($device->machine_fingerprint)
        ->assertInertia(fn (Assert $page) => $page
            ->missing('devices.0.last_public_ip')
            ->missing('devices.0.machine_fingerprint')
            ->missing('devices.0.tokens')
        );
});
