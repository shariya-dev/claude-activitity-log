<?php

use App\Actions\Agent\DeregisterDevice;
use App\Actions\Agent\DisableDevice;
use App\Actions\Agent\EnableDevice;
use App\Actions\Agent\RecordHeartbeat;
use App\Actions\Agent\RegisterDevice;
use App\Actions\Agent\RequestManualSync;
use App\Actions\Agent\Support\InvalidPairingCode;
use App\Enums\DeviceStatus;
use App\Enums\SyncHealth;
use App\Models\AgentSyncState;
use App\Models\AuditLog;
use App\Models\Developer;
use App\Models\Device;
use App\Models\PairingCode;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Agent\ContractExamples;
use Tests\TestCase;

uses(TestCase::class, RefreshDatabase::class);

beforeEach(function () {
    $this->travelTo(now()->parse('2026-09-23T10:00:00Z'));
    $this->admin = User::factory()->admin()->create();
});

test('DisableDevice disables, keeps tokens so the agent gets 403, marks health and audits', function () {
    $device = Device::factory()->create();
    AgentSyncState::factory()->for($device)->create();
    $device->createToken('agent', ['agent']);

    app(DisableDevice::class)->handle($device, $this->admin);

    $device->refresh();
    expect($device->status)->toBe(DeviceStatus::Disabled)
        ->and($device->disabled_at?->toIso8601ZuluString())->toBe('2026-09-23T10:00:00Z')
        ->and($device->tokens()->count())->toBe(1)
        ->and($device->syncState?->health)->toBe(SyncHealth::Disabled);

    $audit = AuditLog::where('action', 'device.disabled')->sole();
    expect($audit->user_id)->toBe($this->admin->id)
        ->and($audit->subject_id)->toBe($device->id);
});

test('EnableDevice re-activates on the existing token and audits', function () {
    $device = Device::factory()->disabled()->create();
    AgentSyncState::factory()->for($device)->create(['health' => SyncHealth::Disabled]);
    $device->createToken('agent', ['agent']);

    app(EnableDevice::class)->handle($device, $this->admin);

    $device->refresh();
    expect($device->status)->toBe(DeviceStatus::Active)
        ->and($device->disabled_at)->toBeNull()
        ->and($device->tokens()->count())->toBe(1)
        ->and($device->syncState?->health)->toBe(SyncHealth::Offline)
        ->and(AuditLog::where('action', 'device.enabled')->where('user_id', $this->admin->id)->count())->toBe(1);
});

test('RequestManualSync flags the device and audits', function () {
    $device = Device::factory()->create();

    app(RequestManualSync::class)->handle($device, $this->admin);

    expect($device->fresh()->sync_requested_at?->toIso8601ZuluString())->toBe('2026-09-23T10:00:00Z')
        ->and(AuditLog::where('action', 'sync.requested')->where('user_id', $this->admin->id)->where('subject_id', $device->id)->count())->toBe(1);
});

test('DeregisterDevice uninstalls, revokes tokens and audits without an actor', function () {
    $device = Device::factory()->create();
    $device->createToken('agent', ['agent']);

    app(DeregisterDevice::class)->handle($device);

    $device->refresh();
    expect($device->status)->toBe(DeviceStatus::Uninstalled)
        ->and($device->uninstalled_at)->not->toBeNull()
        ->and($device->tokens()->count())->toBe(0)
        ->and(AuditLog::where('action', 'device.uninstalled')->whereNull('user_id')->count())->toBe(1);
});

test('RegisterDevice returns the device and a working plaintext token', function () {
    $developer = Developer::factory()->create();
    PairingCode::factory()->withCode('K7Q2-M9XD')->for($developer)->create();

    $result = app(RegisterDevice::class)->handle('K7Q2-M9XD', ContractExamples::load('register.request')['device']);

    expect($result['device'])->toBeInstanceOf(Device::class)
        ->and($result['device']->developer_id)->toBe($developer->id)
        ->and($result['token'])->toBeString()
        ->and($result['device']->tokens()->sole()->abilities)->toBe(['agent']);
});

test('RegisterDevice throws the generic exception for a bad code', function () {
    app(RegisterDevice::class)->handle('NOPE-NOPE', ContractExamples::load('register.request')['device']);
})->throws(InvalidPairingCode::class);

test('RecordHeartbeat returns the contract fields', function () {
    $device = Device::factory()->create(['sync_requested_at' => now()]);

    $result = app(RecordHeartbeat::class)->handle($device, ContractExamples::load('heartbeat.request'), '203.0.113.9');

    expect($result)->toBe([
        'server_time' => '2026-09-23T10:00:00Z',
        'settings_version' => 1,
        'sync_requested' => true,
    ]);
});

test('EnableDevice leaves a device that is not disabled untouched', function () {
    $device = Device::factory()->uninstalled()->create();

    app(EnableDevice::class)->handle($device, $this->admin);

    expect($device->fresh()->status)->toBe(DeviceStatus::Uninstalled)
        ->and(AuditLog::where('action', 'device.enabled')->count())->toBe(0);
});

test('DisableDevice leaves an uninstalled device untouched', function () {
    $device = Device::factory()->uninstalled()->create();

    app(DisableDevice::class)->handle($device, $this->admin);

    expect($device->fresh()->status)->toBe(DeviceStatus::Uninstalled)
        ->and(AuditLog::where('action', 'device.disabled')->count())->toBe(0);
});

test('RegisterDevice turns a concurrent duplicate insert into a re-pair', function () {
    $developer = Developer::factory()->create();
    PairingCode::factory()->withCode('K7Q2-M9XD')->for($developer)->create();
    $info = ContractExamples::load('register.request')['device'];

    // Simulate the other request winning the race: the row appears right before this request inserts.
    $raced = false;
    Device::creating(function () use (&$raced, $developer, $info) {
        if (! $raced) {
            $raced = true;
            Device::factory()->create(['developer_id' => $developer->id, 'machine_fingerprint' => $info['machine_fingerprint']]);
        }
    });

    $result = app(RegisterDevice::class)->handle('K7Q2-M9XD', $info);

    expect(Device::count())->toBe(1)
        ->and($result['device']->id)->toBe(Device::sole()->id);
});
