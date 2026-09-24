<?php

use App\Actions\Agent\DisableDevice;
use App\Actions\Agent\EnableDevice;
use App\Enums\DeviceStatus;
use App\Models\ClaudeSession;
use App\Models\Device;
use App\Models\SyncBatch;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Agent\ContractExamples;

uses(RefreshDatabase::class);

/*
| Contract §9.2: a dashboard Disable answers 403 device_disabled (the agent stops syncing and probes
| hourly); Enable resumes on the same token without a re-pair. Re-pair and /deregister still revoke.
*/

beforeEach(function () {
    $this->travelTo(now()->parse('2026-09-23T12:00:00Z'));
    $this->admin = User::factory()->admin()->create();
    $this->device = Device::factory()->create([
        'device_uid' => 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W',
        'agent_state' => 'ok',
        'last_seen_at' => now()->subHour(),
    ]);
    $this->headers = ContractExamples::agentHeaders($this->device);
});

dataset('device.active endpoints', [
    'POST /sync' => ['POST', '/api/agent/v1/sync', 'sync.request.minimal'],
    'POST /heartbeat' => ['POST', '/api/agent/v1/heartbeat', 'heartbeat.request'],
    'GET /settings' => ['GET', '/api/agent/v1/settings', null],
    'GET /sync/status' => ['GET', '/api/agent/v1/sync/status', null],
]);

test('a disabled device keeps its token and gets 403 device_disabled', function (string $method, string $uri, ?string $body) {
    app(DisableDevice::class)->handle($this->device, $this->admin);
    $this->app['auth']->forgetGuards();

    $response = $this->json($method, $uri, $body === null ? [] : ContractExamples::load($body), $this->headers)
        ->assertHeader('X-Settings-Version', '1')
        ->assertHeader('X-Server-Time', '2026-09-23T12:00:00Z');

    ContractExamples::assertErrorEnvelope($response, 403, 'device_disabled');
    $response->assertExactJson(ContractExamples::load('error.device_disabled'));

    $this->device->refresh();
    expect($this->device->tokens()->count())->toBe(1)
        ->and($this->device->status)->toBe(DeviceStatus::Disabled)
        ->and($this->device->last_seen_at?->toIso8601ZuluString())->toBe('2026-09-23T11:00:00Z')
        ->and(SyncBatch::count())->toBe(0);
})->with('device.active endpoints');

test('disabling keeps the device history', function () {
    $sessions = ClaudeSession::factory()->count(2)->for($this->device)->create();

    app(DisableDevice::class)->handle($this->device, $this->admin);

    expect(ClaudeSession::where('device_id', $this->device->id)->pluck('id')->all())
        ->toEqualCanonicalizing($sessions->pluck('id')->all());
});

test('enabling resumes sync on the same token without a re-pair', function () {
    app(DisableDevice::class)->handle($this->device, $this->admin);
    $this->app['auth']->forgetGuards();
    $this->getJson('/api/agent/v1/settings', $this->headers)->assertForbidden();

    app(EnableDevice::class)->handle($this->device->refresh(), $this->admin);
    $this->app['auth']->forgetGuards();

    $this->postJson('/api/agent/v1/heartbeat', ContractExamples::load('heartbeat.request'), $this->headers)->assertOk();
    $this->postJson('/api/agent/v1/sync', ContractExamples::load('sync.request.minimal'), $this->headers)
        ->assertOk()
        ->assertJsonPath('success', true);

    expect($this->device->refresh()->tokens()->count())->toBe(1)
        ->and($this->device->status)->toBe(DeviceStatus::Active);
});

test('a disabled device can still deregister with its token, which then is revoked', function () {
    app(DisableDevice::class)->handle($this->device, $this->admin);
    $this->app['auth']->forgetGuards();

    $this->postJson('/api/agent/v1/deregister', [], $this->headers)->assertNoContent();

    $this->device->refresh();
    expect($this->device->status)->toBe(DeviceStatus::Uninstalled)
        ->and($this->device->tokens()->count())->toBe(0);

    $this->app['auth']->forgetGuards();
    ContractExamples::assertErrorEnvelope($this->postJson('/api/agent/v1/deregister', [], $this->headers), 401, 'unauthenticated');
});

test('an uninstalled device with a surviving token gets the exact device_uninstalled envelope', function (string $method, string $uri, ?string $body) {
    $this->device->update(['status' => DeviceStatus::Uninstalled, 'uninstalled_at' => now()]);

    $response = $this->json($method, $uri, $body === null ? [] : ContractExamples::load($body), $this->headers)
        ->assertHeader('X-Settings-Version', '1')
        ->assertHeader('X-Server-Time', '2026-09-23T12:00:00Z');

    ContractExamples::assertErrorEnvelope($response, 403, 'device_uninstalled');
    $response->assertExactJson(ContractExamples::load('error.device_uninstalled'));
})->with('device.active endpoints');
