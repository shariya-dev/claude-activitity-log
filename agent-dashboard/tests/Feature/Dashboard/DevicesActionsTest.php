<?php

use App\Enums\DeviceStatus;
use App\Enums\PairingPurpose;
use App\Enums\SyncHealth;
use App\Models\AuditLog;
use App\Models\ClaudeSession;
use App\Models\Device;
use App\Models\PairingCode;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

dataset('device actions', [
    'disable' => ['devices.disable'],
    'enable' => ['devices.enable'],
    'request sync' => ['devices.request-sync'],
    'repair code' => ['devices.repair-code'],
]);

test('viewers are forbidden from every device action', function (string $route) {
    $device = Device::factory()->create();

    $this->actingAs(User::factory()->viewer()->create())
        ->post(route($route, $device))
        ->assertForbidden();

    expect(AuditLog::query()->count())->toBe(0)
        ->and($device->fresh()->status)->toBe(DeviceStatus::Active);
})->with('device actions');

test('guests are redirected to login for every device action', function (string $route) {
    $this->post(route($route, Device::factory()->create()))->assertRedirect(route('login'));
})->with('device actions');

test('disable revokes tokens, audits, and keeps the device history listed', function () {
    $admin = User::factory()->admin()->create();
    $device = Device::factory()->create();
    $device->createToken('agent', ['agent']);
    $session = ClaudeSession::factory()->create([
        'device_id' => $device->id,
        'started_at' => now()->subHour(),
        'last_activity_at' => now()->subMinutes(30),
    ]);

    $this->actingAs($admin)
        ->from(route('devices.show', $device))
        ->post(route('devices.disable', $device))
        ->assertRedirect(route('devices.show', $device));

    $device->refresh();
    expect($device->status)->toBe(DeviceStatus::Disabled)
        ->and($device->disabled_at)->not->toBeNull()
        ->and($device->tokens()->count())->toBe(0)
        ->and($device->syncState?->health)->toBe(SyncHealth::Disabled)
        ->and(AuditLog::query()->where('action', 'device.disabled')->where('subject_id', $device->id)->where('user_id', $admin->id)->exists())->toBeTrue()
        ->and(ClaudeSession::query()->whereKey($session->id)->exists())->toBeTrue();

    $this->actingAs($admin)
        ->get(route('devices.show', $device))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('device.status', 'disabled')
            ->where('device.health', 'disabled')
            ->has('recent_sessions', 1)
            ->where('recent_sessions.0.id', $session->id)
        );

    $this->actingAs($admin)
        ->get(route('devices.index'))
        ->assertInertia(fn (Assert $page) => $page->has('devices', 1)->where('devices.0.status', 'disabled'));
});

test('enable re-activates a disabled device and audits it, but tokens stay revoked until re-pair', function () {
    $admin = User::factory()->admin()->create();
    $device = Device::factory()->create();
    $device->createToken('agent', ['agent']);
    $this->actingAs($admin)->post(route('devices.disable', $device));

    $this->actingAs($admin)
        ->post(route('devices.enable', $device))
        ->assertRedirect(route('devices.show', $device));

    $device->refresh();
    expect($device->status)->toBe(DeviceStatus::Active)
        ->and($device->disabled_at)->toBeNull()
        ->and($device->tokens()->count())->toBe(0)
        ->and($device->syncState?->health)->toBe(SyncHealth::Offline)
        ->and(AuditLog::query()->where('action', 'device.enabled')->where('subject_id', $device->id)->exists())->toBeTrue();
});

test('sync now sets sync_requested_at and audits sync.requested', function () {
    $admin = User::factory()->admin()->create();
    $device = Device::factory()->create(['sync_requested_at' => null]);

    $this->actingAs($admin)
        ->post(route('devices.request-sync', $device))
        ->assertRedirect(route('devices.show', $device));

    expect($device->fresh()->sync_requested_at)->not->toBeNull()
        ->and(AuditLog::query()->where('action', 'sync.requested')->where('subject_id', $device->id)->where('user_id', $admin->id)->exists())->toBeTrue();
});

test('sync now is refused for a device that is not active', function () {
    $device = Device::factory()->disabled()->create(['sync_requested_at' => null]);

    $this->actingAs(User::factory()->admin()->create())
        ->post(route('devices.request-sync', $device))
        ->assertRedirect(route('devices.show', $device));

    expect($device->fresh()->sync_requested_at)->toBeNull()
        ->and(AuditLog::query()->where('action', 'sync.requested')->exists())->toBeFalse();
});

test('re-pair code is issued for the device developer, audited, and flashed exactly once', function () {
    $admin = User::factory()->admin()->create();
    $device = Device::factory()->disabled()->create();

    $this->actingAs($admin)
        ->post(route('devices.repair-code', $device))
        ->assertRedirect(route('devices.show', $device))
        ->assertSessionHas('pairing_code');

    $code = session('pairing_code');
    expect($code)->toMatch('/^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/');

    $pairingCode = PairingCode::query()->sole();
    expect($pairingCode->developer_id)->toBe($device->developer_id)
        ->and($pairingCode->purpose)->toBe(PairingPurpose::Repair)
        ->and($pairingCode->code_hash)->toBe(PairingCode::hashCode($code));

    $audit = AuditLog::query()->where('action', 'pairing_code.issued')->sole();
    expect($audit->subject_id)->toBe($device->developer_id)
        ->and($audit->metadata)->toBe(['purpose' => 'repair'])
        ->and(json_encode($audit->metadata))->not->toContain($code);

    $this->get(route('devices.show', $device))
        ->assertInertia(fn (Assert $page) => expect($page->where('flash.pairing_code', $code)->toArray())
            ->toHaveKey('encryptHistory', true));

    $this->get(route('devices.show', $device))
        ->assertInertia(fn (Assert $page) => $page->where('flash.pairing_code', null));
});

test('re-pair code is refused when the developer is inactive or removed', function (string $state) {
    $device = Device::factory()->create();
    $state === 'inactive'
        ? $device->developer->update(['status' => 'inactive'])
        : $device->developer->delete();

    $this->actingAs(User::factory()->admin()->create())
        ->post(route('devices.repair-code', $device))
        ->assertRedirect(route('devices.show', $device))
        ->assertSessionMissing('pairing_code');

    expect(PairingCode::query()->count())->toBe(0);
})->with(['inactive', 'removed']);

test('disable and enable are refused for devices in the wrong state', function (string $factoryState, string $route) {
    $device = Device::factory()->{$factoryState}()->create();
    $status = $device->status;

    $this->actingAs(User::factory()->admin()->create())
        ->post(route($route, $device))
        ->assertRedirect(route('devices.show', $device));

    expect($device->fresh()->status)->toBe($status)
        ->and(AuditLog::query()->count())->toBe(0);
})->with([
    'disable an uninstalled device' => ['uninstalled', 'devices.disable'],
    'disable a disabled device' => ['disabled', 'devices.disable'],
    'enable an uninstalled device' => ['uninstalled', 'devices.enable'],
]);

test('an uninstalled device keeps its history listed', function () {
    $device = Device::factory()->uninstalled()->create();
    $session = ClaudeSession::factory()->create([
        'device_id' => $device->id,
        'started_at' => now()->subHour(),
        'last_activity_at' => now()->subMinutes(30),
    ]);

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('devices.show', $device))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('device.status', 'uninstalled')
            ->has('recent_sessions', 1)
            ->where('recent_sessions.0.id', $session->id)
        );
});

test('viewers see the device page without action rights', function () {
    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('devices.show', Device::factory()->create()))
        ->assertInertia(fn (Assert $page) => $page->where('can.manageAgents', false));
});
