<?php

use App\Actions\Agent\RecordHeartbeat;
use App\Actions\Agent\RegisterDevice;
use App\Models\Device;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Agent\ContractExamples;

uses(RefreshDatabase::class);

/*
| Contract §9.1: every agent-facing failure is the error envelope, including the 401, 429 and 500
| responses that Laravel renders itself (e2e F2/F3, platform matrix FU-2).
*/

dataset('authenticated agent endpoints', [
    'POST /sync' => ['POST', '/api/agent/v1/sync'],
    'POST /heartbeat' => ['POST', '/api/agent/v1/heartbeat'],
    'GET /settings' => ['GET', '/api/agent/v1/settings'],
    'GET /sync/status' => ['GET', '/api/agent/v1/sync/status'],
    'POST /deregister' => ['POST', '/api/agent/v1/deregister'],
]);

beforeEach(function () {
    $this->travelTo(now()->parse('2026-09-23T12:00:00Z'));
});

test('a request without a token gets the exact unauthenticated envelope', function (string $method, string $uri) {
    $response = $this->json($method, $uri, [], ['X-Agent-Version' => '1.0.0']);

    ContractExamples::assertErrorEnvelope($response, 401, 'unauthenticated');
    $response->assertExactJson(ContractExamples::load('error.unauthenticated'));
})->with('authenticated agent endpoints');

test('an unknown token gets the unauthenticated envelope', function (string $method, string $uri) {
    $response = $this->withToken('1|not-a-real-token')->json($method, $uri, [], ['X-Agent-Version' => '1.0.0']);

    ContractExamples::assertErrorEnvelope($response, 401, 'unauthenticated');
    $response->assertExactJson(ContractExamples::load('error.unauthenticated'));
})->with('authenticated agent endpoints');

test('a revoked token gets the unauthenticated envelope', function (string $method, string $uri) {
    $device = Device::factory()->create();
    $headers = ContractExamples::agentHeaders($device);
    $device->tokens()->delete();

    $response = $this->json($method, $uri, [], $headers);

    ContractExamples::assertErrorEnvelope($response, 401, 'unauthenticated');
})->with('authenticated agent endpoints');

test('dashboard authentication keeps its login redirect and default JSON 401', function () {
    $this->get(route('devices.index'))->assertRedirect(route('login'));

    $this->getJson(route('devices.index'))
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

test('the register throttle answers the rate_limited envelope with Retry-After', function () {
    foreach (range(1, 10) as $attempt) {
        $this->postJson('/api/agent/v1/register', ContractExamples::registerRequest('ZZZZ-ZZZZ'))->assertStatus(422);
    }

    $response = $this->postJson('/api/agent/v1/register', ContractExamples::registerRequest('ZZZZ-ZZZZ'))
        ->assertHeader('Retry-After');

    ContractExamples::assertErrorEnvelope($response, 429, 'rate_limited');
    $response->assertExactJson(ContractExamples::load('error.rate_limited'));
});

test('the device throttle answers the rate_limited envelope with Retry-After', function () {
    $headers = ContractExamples::agentHeaders(Device::factory()->create());

    foreach (range(1, 60) as $attempt) {
        $this->getJson('/api/agent/v1/sync/status', $headers)->assertOk();
    }

    $response = $this->getJson('/api/agent/v1/sync/status', $headers)->assertHeader('Retry-After');

    ContractExamples::assertErrorEnvelope($response, 429, 'rate_limited');
    $response->assertExactJson(ContractExamples::load('error.rate_limited'));
});

test('the throttle is checked before device status (contract §2 order)', function () {
    $headers = ContractExamples::agentHeaders(Device::factory()->disabled()->create());

    foreach (range(1, 60) as $attempt) {
        $this->getJson('/api/agent/v1/settings', $headers)->assertForbidden();
    }

    ContractExamples::assertErrorEnvelope($this->getJson('/api/agent/v1/settings', $headers), 429, 'rate_limited');
});

test('an unexpected heartbeat failure is a 500 envelope that never leaks the exception', function () {
    config(['app.debug' => true]);
    $mock = Mockery::mock(RecordHeartbeat::class);
    $mock->shouldReceive('handle')->andThrow(new RuntimeException('SQLSTATE secret-value-7f3a'));
    $this->instance(RecordHeartbeat::class, $mock);

    $response = $this->postJson(
        '/api/agent/v1/heartbeat',
        ContractExamples::load('heartbeat.request'),
        ContractExamples::agentHeaders(Device::factory()->create()),
    )->assertHeader('X-Settings-Version', '1');

    ContractExamples::assertErrorEnvelope($response, 500, 'persistence_failed');
    expect($response->getContent())->not->toContain('secret-value-7f3a')
        ->not->toContain('RuntimeException');
});

test('an unexpected register failure is a 500 envelope that never leaks the exception', function () {
    config(['app.debug' => true]);
    $mock = Mockery::mock(RegisterDevice::class);
    $mock->shouldReceive('handle')->andThrow(new RuntimeException('SQLSTATE secret-value-7f3a'));
    $this->instance(RegisterDevice::class, $mock);

    $response = $this->postJson('/api/agent/v1/register', ContractExamples::registerRequest());

    ContractExamples::assertErrorEnvelope($response, 500, 'persistence_failed');
    expect($response->getContent())->not->toContain('secret-value-7f3a');
});
