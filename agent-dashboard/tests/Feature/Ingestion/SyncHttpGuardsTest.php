<?php

use App\Enums\SyncBatchStatus;
use App\Models\SyncBatch;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-09-23T12:00:00Z'));
});

test('unauthenticated requests get the 401 unauthenticated envelope', function () {
    postSync(smallSyncBody())
        ->assertUnauthorized()
        ->assertExactJson(ingestionExample('error.unauthenticated.json'));
});

test('a revoked token gets the 401 unauthenticated envelope and nothing is stored', function () {
    $device = ingestionDevice(actingAs: false);
    $token = $device->createToken('agent', ['agent'])->plainTextToken;
    $device->tokens()->delete();

    test()->withToken($token)->postJson('/api/agent/v1/sync', smallSyncBody())
        ->assertUnauthorized()
        ->assertExactJson(ingestionExample('error.unauthenticated.json'));

    expect(SyncBatch::count())->toBe(0);
});

test('a disabled device gets 403 device_disabled and nothing is stored', function () {
    ingestionDevice(['status' => 'disabled', 'disabled_at' => now()]);

    postSync(smallSyncBody())
        ->assertForbidden()
        ->assertExactJson(ingestionExample('error.device_disabled.json'));

    expect(DB::table('claude_sessions')->count())->toBe(0)
        ->and(SyncBatch::count())->toBe(0);
});

test('a body for another device gets 422 invalid_payload', function () {
    ingestionDevice();

    postSync(syncBody([], [], ['device_id' => 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0X']))
        ->assertStatus(422)
        ->assertJsonPath('success', false)
        ->assertJsonPath('error.code', 'invalid_payload')
        ->assertJsonPath('error.retryable', false);

    expect(SyncBatch::count())->toBe(0);
});

test('envelope problems get 422 invalid_payload with errors', function (string $file, string $path) {
    ingestionDevice();

    $response = postSync(ingestionExample($file))
        ->assertStatus(422)
        ->assertJsonPath('success', false)
        ->assertJsonPath('error.code', 'invalid_payload')
        ->assertJsonPath('error.retryable', false);

    expect($response->json('error.errors'))->toBeArray()->toHaveKey($path);
    expect(SyncBatch::count())->toBe(0);
})->with([
    'missing batch id' => ['invalid/missing-batch-id.json', 'sync.batch_id'],
    'unknown platform' => ['invalid/unknown-platform.json', 'agent.platform'],
]);

test('a missing record array gets 422 invalid_payload', function () {
    ingestionDevice();
    $body = smallSyncBody();
    unset($body['usage']);

    postSync($body)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'invalid_payload');
});

test('a body that is not JSON gets 422 invalid_payload', function () {
    ingestionDevice();

    postRawSync('{not json')
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'invalid_payload');
});

test('arrays over their limit get 413 batch_too_large', function (string $file) {
    ingestionDevice();

    postSync(ingestionExample($file))
        ->assertStatus(413)
        ->assertJsonPath('success', false)
        ->assertJsonPath('error.code', 'batch_too_large')
        ->assertJsonPath('error.retryable', true);

    expect(DB::table('claude_sessions')->count())->toBe(0)
        ->and(SyncBatch::count())->toBe(0);
})->with([
    'oversize sessions' => 'invalid/oversize-sessions.json',
    'oversize usage' => 'invalid/oversize-usage.json',
]);

test('a body over 2 MB gets 413 batch_too_large', function () {
    ingestionDevice();

    $messages = [];
    for ($i = 0; $i < 30; $i++) {
        $messages[] = syncMessage('big-'.$i, 'guard-session', ['content' => str_repeat('a', 80000)]);
    }
    $body = syncBody(['sessions' => [syncSession('guard-session')], 'messages' => $messages]);

    expect(strlen(json_encode($body)))->toBeGreaterThan(2 * 1024 * 1024);

    postSync($body)
        ->assertStatus(413)
        ->assertJsonPath('error.code', 'batch_too_large');
});

test('a gzip body is accepted', function () {
    ingestionDevice();
    $body = smallSyncBody();

    postRawSync(gzencode(json_encode($body)), ['HTTP_CONTENT_ENCODING' => 'gzip'])
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('batch_id', $body['sync']['batch_id'])
        ->assertJsonPath('sync.created', 2);

    expect(DB::table('session_usage')->count())->toBe(1);
});

test('a gzip body over 2 MB once decompressed gets 413', function () {
    ingestionDevice();

    $messages = [];
    for ($i = 0; $i < 30; $i++) {
        $messages[] = syncMessage('big-'.$i, 'guard-session', ['content' => str_repeat('a', 80000)]);
    }
    $compressed = gzencode(json_encode(syncBody(['sessions' => [syncSession('guard-session')], 'messages' => $messages])));

    expect(strlen($compressed))->toBeLessThan(2 * 1024 * 1024);

    postRawSync($compressed, ['HTTP_CONTENT_ENCODING' => 'gzip'])
        ->assertStatus(413)
        ->assertJsonPath('error.code', 'batch_too_large');
});

test('an agent older than min_agent_version gets 426 agent_outdated', function () {
    setTrackingCategories(['min_agent_version' => '1.2.0']);
    ingestionDevice();

    postSync(syncBody([], [], ['agent_version' => '1.0.0']))
        ->assertStatus(426)
        ->assertJsonPath('success', false)
        ->assertJsonPath('error.code', 'agent_outdated')
        ->assertJsonPath('error.retryable', false);

    expect(SyncBatch::count())->toBe(0);
});

test('an agent at min_agent_version is accepted', function () {
    setTrackingCategories(['min_agent_version' => '1.2.0']);
    ingestionDevice();

    postSync(syncBody([], [], ['agent_version' => '1.2.0']))->assertOk();
});

test('a batch still processing and younger than 2 minutes gets 409 batch_in_progress', function () {
    $device = ingestionDevice();
    $body = smallSyncBody();

    SyncBatch::factory()->processing()->create([
        'device_id' => $device->id,
        'batch_uuid' => $body['sync']['batch_id'],
        'received_at' => now()->subSeconds(30),
    ]);

    postSync($body)
        ->assertStatus(409)
        ->assertJsonPath('success', false)
        ->assertJsonPath('error.code', 'batch_in_progress')
        ->assertJsonPath('error.retryable', true);

    expect(DB::table('claude_sessions')->count())->toBe(0);
});

test('a stale processing or failed batch is reprocessed', function (string $state, int $ageSeconds) {
    $device = ingestionDevice();
    $body = smallSyncBody();

    $factory = SyncBatch::factory();
    $factory = $state === 'failed' ? $factory->failed() : $factory->processing();
    $factory->create([
        'device_id' => $device->id,
        'batch_uuid' => $body['sync']['batch_id'],
        'received_at' => now()->subSeconds($ageSeconds),
    ]);

    postSync($body)
        ->assertOk()
        ->assertJsonPath('sync.created', 2);

    $batch = SyncBatch::where('device_id', $device->id)->sole();
    expect($batch->status)->toBe(SyncBatchStatus::Succeeded)
        ->and(DB::table('session_usage')->count())->toBe(1);
})->with([
    'processing for 3 minutes' => ['processing', 180],
    'failed a moment ago' => ['failed', 10],
]);

test('the same batch id on another device is a different batch', function () {
    $body = smallSyncBody();
    $other = ingestionDevice(['device_uid' => 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9ZZZ'], actingAs: false);

    SyncBatch::factory()->create([
        'device_id' => $other->id,
        'batch_uuid' => $body['sync']['batch_id'],
        'response' => ['success' => true, 'stale' => true],
    ]);

    ingestionDevice();

    postSync($body)->assertOk()->assertJsonPath('sync.created', 2)->assertJsonMissingPath('stale');
});
