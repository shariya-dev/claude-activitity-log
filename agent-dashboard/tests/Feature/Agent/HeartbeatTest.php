<?php

use App\Models\Device;
use App\Models\TrackingSetting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Agent\ContractExamples;

uses(RefreshDatabase::class);

const HEARTBEAT_URL = '/api/agent/v1/heartbeat';

beforeEach(function () {
    $this->travelTo(now()->parse('2026-09-23T12:16:00Z'));
    $this->device = Device::factory()->create([
        'hostname' => 'old-host',
        'agent_version' => '0.9.0',
        'agent_state' => 'backoff',
        'last_seen_at' => now()->subHour(),
        'last_sync_at' => now()->subMinutes(30),
        'last_public_ip' => '192.0.2.1',
    ]);
});

function updateSettings(array $attributes): void
{
    $setting = TrackingSetting::current();
    $setting->forceFill($attributes);
    $setting->bumpVersion();
    $setting->save();
}

test('a heartbeat records liveness, versions and state and returns the contract response', function () {
    $response = $this->postJson(HEARTBEAT_URL, ContractExamples::load('heartbeat.request'), ContractExamples::agentHeaders($this->device))
        ->assertOk()
        ->assertHeader('X-Settings-Version', '1')
        ->assertHeader('X-Server-Time', '2026-09-23T12:16:00Z');

    expect(ContractExamples::shape($response->json()))->toBe(ContractExamples::shape(ContractExamples::load('heartbeat.response')))
        ->and($response->json())->toBe(['server_time' => '2026-09-23T12:16:00Z', 'settings_version' => 1, 'sync_requested' => false]);

    $device = $this->device->fresh();
    expect($device->last_seen_at?->toIso8601ZuluString())->toBe('2026-09-23T12:16:00Z')
        ->and($device->agent_version)->toBe('1.0.0')
        ->and($device->claude_code_version)->toBe('2.1.274')
        ->and($device->platform_version)->toBe('6.8.0-45-generic')
        ->and($device->agent_state)->toBe('ok')
        ->and($device->hostname)->toBe('dev-laptop-01')
        ->and($device->last_local_activity_at?->toIso8601ZuluString())->toBe('2026-09-23T12:14:02Z')
        ->and($device->last_sync_at?->toIso8601ZuluString())->toBe('2026-09-23T11:46:00Z');
});

test('the settings version in the body is the current one', function () {
    updateSettings(['sync_interval_seconds' => 180]);

    $this->postJson(HEARTBEAT_URL, ContractExamples::load('heartbeat.request'), ContractExamples::agentHeaders($this->device))
        ->assertOk()
        ->assertJsonPath('settings_version', 2)
        ->assertHeader('X-Settings-Version', '2');
});

test('the public IP is nulled while the Network category is off', function () {
    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
        ->postJson(HEARTBEAT_URL, ContractExamples::load('heartbeat.request'), ContractExamples::agentHeaders($this->device))
        ->assertOk();

    expect($this->device->fresh()->last_public_ip)->toBeNull();
});

test('the public IP is stored while the Network category is on', function () {
    updateSettings(['network' => true]);

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
        ->postJson(HEARTBEAT_URL, ContractExamples::load('heartbeat.request'), ContractExamples::agentHeaders($this->device))
        ->assertOk();

    expect($this->device->fresh()->last_public_ip)->toBe('203.0.113.9');
});

test('the stored hostname is kept while the Device category is off', function () {
    updateSettings(['device' => false]);

    $this->postJson(HEARTBEAT_URL, [...ContractExamples::load('heartbeat.request'), 'hostname' => 'sent-anyway'], ContractExamples::agentHeaders($this->device))
        ->assertOk();

    expect($this->device->fresh()->hostname)->toBe('old-host');
});

test('a requested sync is returned exactly once', function () {
    $this->device->update(['sync_requested_at' => now()->subMinute()]);
    $headers = ContractExamples::agentHeaders($this->device);

    $this->postJson(HEARTBEAT_URL, ContractExamples::load('heartbeat.request'), $headers)
        ->assertOk()
        ->assertJsonPath('sync_requested', true);

    expect($this->device->fresh()->sync_requested_at)->toBeNull();

    $this->postJson(HEARTBEAT_URL, ContractExamples::load('heartbeat.request'), $headers)
        ->assertOk()
        ->assertJsonPath('sync_requested', false);
});

test('a disabled device gets 403 and nothing is written', function () {
    $this->device->update(['status' => 'disabled', 'disabled_at' => now()]);

    $this->postJson(HEARTBEAT_URL, ContractExamples::load('heartbeat.request'), ContractExamples::agentHeaders($this->device))
        ->assertForbidden()
        ->assertHeader('X-Settings-Version', '1')
        ->assertExactJson(ContractExamples::load('error.device_disabled'));

    expect($this->device->fresh()->agent_state)->toBe('backoff');
});

test('an outdated agent gets 426 after its status is persisted', function () {
    updateSettings(['min_agent_version' => '1.2.0']);
    $this->device->update(['sync_requested_at' => now()->subMinute()]);

    $this->postJson(HEARTBEAT_URL, ContractExamples::load('heartbeat.request'), ContractExamples::agentHeaders($this->device))
        ->assertStatus(426)
        ->assertHeader('X-Settings-Version', '2')
        ->assertExactJson(ContractExamples::load('error.agent_outdated'));

    $device = $this->device->fresh();
    expect($device->last_seen_at?->toIso8601ZuluString())->toBe('2026-09-23T12:16:00Z')
        ->and($device->agent_version)->toBe('1.0.0')
        ->and($device->agent_state)->toBe('ok')
        ->and($device->sync_requested_at)->not->toBeNull();
});

test('an invalid body is 422 invalid_payload and persists nothing', function () {
    $payload = [...ContractExamples::load('heartbeat.request'), 'agent_state' => 'sleeping', 'agent_version' => '0.1.0'];
    unset($payload['last_error']);
    updateSettings(['min_agent_version' => '1.2.0']);

    $this->postJson(HEARTBEAT_URL, $payload, ContractExamples::agentHeaders($this->device))
        ->assertStatus(422)
        ->assertJsonPath('success', false)
        ->assertJsonPath('error.code', 'invalid_payload')
        ->assertJsonPath('error.retryable', false)
        ->assertJsonStructure(['error' => ['errors' => ['agent_state', 'last_error']]]);

    expect($this->device->fresh()->agent_state)->toBe('backoff');
});

test('timestamps with an offset are rejected', function () {
    $payload = [...ContractExamples::load('heartbeat.request'), 'last_local_activity_at' => '2026-09-23T18:14:02+06:00'];

    $this->postJson(HEARTBEAT_URL, $payload, ContractExamples::agentHeaders($this->device))
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['errors' => ['last_local_activity_at']]]);
});

test('a heartbeat without a token is 401', function () {
    $this->postJson(HEARTBEAT_URL, ContractExamples::load('heartbeat.request'))->assertUnauthorized();
});
