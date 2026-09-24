<?php

use App\Models\Device;
use App\Models\TrackingSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

beforeEach(function () {
    Route::middleware(['auth:sanctum', 'settings.version', 'device.active'])
        ->get('/_test/device-probe', fn () => response()->json(['ok' => true]));
});

test('an active device passes and receives settings headers', function () {
    $this->travelTo(now()->parse('2026-09-22T12:34:56Z'));

    $setting = TrackingSetting::current();
    $setting->bumpVersion();
    $setting->save();

    Sanctum::actingAs(Device::factory()->create(), ['agent']);

    $this->getJson('/_test/device-probe')
        ->assertOk()
        ->assertExactJson(['ok' => true])
        ->assertHeader('X-Settings-Version', '2')
        ->assertHeader('X-Server-Time', '2026-09-22T12:34:56Z');
});

test('a disabled device is rejected with the error envelope and settings headers', function () {
    $this->travelTo(now()->parse('2026-09-22T12:34:56Z'));
    Sanctum::actingAs(Device::factory()->disabled()->create(), ['agent']);

    $this->getJson('/_test/device-probe')
        ->assertForbidden()
        ->assertHeader('X-Settings-Version', '1')
        ->assertHeader('X-Server-Time', '2026-09-22T12:34:56Z')
        ->assertExactJson([
            'success' => false,
            'error' => [
                'code' => 'device_disabled',
                'message' => 'This device has been disabled by an administrator.',
                'retryable' => false,
            ],
        ]);
});

test('an uninstalled device is rejected with the error envelope', function () {
    Sanctum::actingAs(Device::factory()->uninstalled()->create(), ['agent']);

    $this->getJson('/_test/device-probe')
        ->assertForbidden()
        ->assertJsonPath('success', false)
        ->assertJsonPath('error.code', 'device_uninstalled')
        ->assertJsonPath('error.retryable', false);
});

test('a user token is not a device', function () {
    $this->actingAs(User::factory()->create(), 'sanctum');

    $this->getJson('/_test/device-probe')
        ->assertUnauthorized()
        ->assertJsonPath('success', false)
        ->assertJsonPath('error.code', 'unauthenticated')
        ->assertJsonPath('error.retryable', false);
});

test('unauthenticated requests are rejected', function () {
    $this->getJson('/_test/device-probe')->assertUnauthorized();
});
