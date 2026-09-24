<?php

use App\Models\AgentSyncState;
use App\Models\ClaudeSession;
use App\Models\Device;
use App\Models\TrackingSetting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Agent\ContractExamples;

uses(RefreshDatabase::class);

const SYNC_STATUS_URL = '/api/agent/v1/sync/status';

test('a device that never synced gets an empty status', function () {
    $device = Device::factory()->create();
    AgentSyncState::factory()->for($device)->create();

    $response = $this->getJson(SYNC_STATUS_URL, ContractExamples::agentHeaders($device))
        ->assertOk()
        ->assertHeader('X-Settings-Version', '1');

    expect(ContractExamples::shape($response->json()))->toBe(ContractExamples::shape(ContractExamples::load('sync-status.response')))
        ->and($response->json())->toBe([
            'last_batch_id' => null,
            'cursor' => null,
            'sequence' => 0,
            'last_success_at' => null,
            'sessions_known' => 0,
        ]);
});

test('the status reflects the server sync state and this device\'s sessions', function () {
    $example = ContractExamples::load('sync-status.response');
    $device = Device::factory()->create();
    AgentSyncState::factory()->for($device)->create([
        'last_batch_uuid' => $example['last_batch_id'],
        'cursor' => $example['cursor'],
        'sequence' => $example['sequence'],
        'last_success_at' => $example['last_success_at'],
    ]);
    ClaudeSession::factory()->count(3)->for($device)->create();
    ClaudeSession::factory()->create();

    $this->getJson(SYNC_STATUS_URL, ContractExamples::agentHeaders($device))
        ->assertOk()
        ->assertExactJson([...$example, 'sessions_known' => 3]);
});

test('a device without a sync state row still gets a status', function () {
    $device = Device::factory()->create();

    $this->getJson(SYNC_STATUS_URL, ContractExamples::agentHeaders($device))
        ->assertOk()
        ->assertJsonPath('sequence', 0)
        ->assertJsonPath('cursor', null);
});

test('sync status never returns 426', function () {
    $setting = TrackingSetting::current();
    $setting->min_agent_version = '9.0.0';
    $setting->save();

    $this->getJson(SYNC_STATUS_URL, ContractExamples::agentHeaders(Device::factory()->create()))->assertOk();
});

test('a disabled device gets 403', function () {
    $this->getJson(SYNC_STATUS_URL, ContractExamples::agentHeaders(Device::factory()->disabled()->create()))
        ->assertForbidden()
        ->assertJsonPath('error.code', 'device_disabled');
});
