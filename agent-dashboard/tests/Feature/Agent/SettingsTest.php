<?php

use App\Enums\InitialSyncRange;
use App\Models\Device;
use App\Models\TrackingSetting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Agent\ContractExamples;

uses(RefreshDatabase::class);

const SETTINGS_URL = '/api/agent/v1/settings';

beforeEach(function () {
    $this->travelTo(now()->parse('2026-09-23T08:00:00Z'));
    $this->device = Device::factory()->create(['first_seen_at' => '2026-09-17T09:15:42Z']);
});

test('the payload matches the contract example shape and defaults', function () {
    $example = ContractExamples::load('settings.response');

    $response = $this->getJson(SETTINGS_URL, ContractExamples::agentHeaders($this->device))
        ->assertOk()
        ->assertHeader('X-Settings-Version', '1')
        ->assertHeader('X-Server-Time', '2026-09-23T08:00:00Z');

    expect(ContractExamples::shape($response->json()))->toBe(ContractExamples::shape($example))
        ->and(array_diff_key($response->json(), ['initial_sync' => true]))->toBe(array_diff_key($example, ['initial_sync' => true]))
        ->and($response->json('initial_sync'))->toBe(['range' => '7d', 'since' => '2026-09-10T09:15:42Z']);
});

test('initial_sync.since is first_seen_at minus the range, and null for all', function (InitialSyncRange $range, ?string $since) {
    $setting = TrackingSetting::current();
    $setting->initial_sync_range = $range;
    $setting->save();

    $this->getJson(SETTINGS_URL, ContractExamples::agentHeaders($this->device))
        ->assertOk()
        ->assertJsonPath('initial_sync', ['range' => $range->value, 'since' => $since]);
})->with([
    '1d' => [InitialSyncRange::OneDay, '2026-09-16T09:15:42Z'],
    '30d' => [InitialSyncRange::ThirtyDays, '2026-08-18T09:15:42Z'],
    'all' => [InitialSyncRange::All, null],
]);

test('an outdated X-Agent-Version gets 426', function () {
    $setting = TrackingSetting::current();
    $setting->min_agent_version = '1.2.0';
    $setting->save();

    $this->getJson(SETTINGS_URL, ContractExamples::agentHeaders($this->device, '1.1.9'))
        ->assertStatus(426)
        ->assertHeader('X-Settings-Version', '1')
        ->assertExactJson(ContractExamples::load('error.agent_outdated'));
});

test('without X-Agent-Version the stored agent version is compared', function (string $stored, int $status) {
    $setting = TrackingSetting::current();
    $setting->min_agent_version = '1.2.0';
    $setting->save();
    $this->device->update(['agent_version' => $stored]);

    $headers = ContractExamples::agentHeaders($this->device);
    unset($headers['X-Agent-Version']);

    $this->getJson(SETTINGS_URL, $headers)->assertStatus($status);
})->with([
    'outdated' => ['1.0.0', 426],
    'current' => ['1.2.0', 200],
]);

test('a disabled device gets 403', function () {
    $this->device->update(['status' => 'disabled', 'disabled_at' => now()]);

    $this->getJson(SETTINGS_URL, ContractExamples::agentHeaders($this->device))
        ->assertForbidden()
        ->assertJsonPath('error.code', 'device_disabled');
});

test('settings require a device token', function () {
    $this->getJson(SETTINGS_URL, ['X-Agent-Version' => '1.0.0'])->assertUnauthorized();
});

test('a malformed X-Agent-Version falls back to the stored agent version', function () {
    $setting = TrackingSetting::current();
    $setting->min_agent_version = '1.2.0';
    $setting->save();
    $this->device->update(['agent_version' => '1.2.0']);

    $this->getJson(SETTINGS_URL, ContractExamples::agentHeaders($this->device, 'garbage'))->assertOk();
});

test('authenticated endpoints are throttled to 60 requests per minute per device', function () {
    $headers = ContractExamples::agentHeaders($this->device);

    foreach (range(1, 60) as $attempt) {
        $this->getJson(SETTINGS_URL, $headers)->assertOk();
    }

    $this->getJson(SETTINGS_URL, $headers)
        ->assertStatus(429)
        ->assertHeader('Retry-After');
});
