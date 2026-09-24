<?php

use App\Enums\SyncBatchStatus;
use App\Enums\SyncHealth;
use App\Models\AgentSyncState;
use App\Models\SyncBatch;
use App\Models\TrackingSetting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-09-23T10:42:00Z'));
});

test('the full contract example is ingested with the expected counts, cursor and state (AC16 first send)', function () {
    setTrackingCategories(['prompt' => true, 'git' => true]);
    $device = ingestionDevice();
    $body = ingestionExample('sync.request.full.json');

    $response = postSync($body)
        ->assertOk()
        ->assertHeader('X-Settings-Version', (string) TrackingSetting::current()->version)
        ->assertJsonPath('success', true)
        ->assertJsonPath('batch_id', $body['sync']['batch_id'])
        ->assertJsonPath('sync', ['accepted' => 10, 'created' => 10, 'updated' => 0, 'rejected' => 0])
        ->assertJsonPath('rejected_records', [])
        ->assertJsonPath('settings_version', TrackingSetting::current()->version);

    expect($response->json('server_time'))->toBeString();

    $cursor = decodeSyncCursor($response->json('cursor'));
    expect($cursor)->toHaveKeys(['sequence', 'batch_id', 'acked_at'])
        ->and($cursor['sequence'])->toBe(42)
        ->and($cursor['batch_id'])->toBe($body['sync']['batch_id'])
        ->and($cursor['acked_at'])->toBeString();

    expect(ingestionTableCounts())->toMatchArray([
        'claude_accounts' => 1,
        'claude_account_device' => 1,
        'projects' => 2,
        'project_locations' => 2,
        'claude_sessions' => 2,
        'session_usage' => 3,
        'session_messages' => 2,
        'claude_models' => 3,
    ]);

    $batch = SyncBatch::where('device_id', $device->id)->sole();
    expect($batch->batch_uuid)->toBe($body['sync']['batch_id'])
        ->and($batch->status)->toBe(SyncBatchStatus::Succeeded)
        ->and($batch->accepted)->toBe(10)
        ->and($batch->created)->toBe(10)
        ->and($batch->updated)->toBe(0)
        ->and($batch->rejected)->toBe(0)
        ->and($batch->completed_at)->not->toBeNull();

    $state = AgentSyncState::where('device_id', $device->id)->sole();
    expect($state->sequence)->toBe(42)
        ->and($state->health)->toBe(SyncHealth::Healthy)
        ->and($state->cursor)->toBe($response->json('cursor'))
        ->and($state->last_batch_uuid)->toBe($body['sync']['batch_id'])
        ->and($state->last_success_at)->not->toBeNull()
        ->and($state->consecutive_failures)->toBe(0);

    $device->refresh();
    expect($device->last_sync_at)->not->toBeNull()
        ->and($device->claude_code_version)->toBe('2.1.274');
});

test('replaying the same batch returns the identical response and writes nothing (AC16)', function () {
    setTrackingCategories(['prompt' => true, 'git' => true]);
    $device = ingestionDevice();
    $body = ingestionExample('sync.request.full.json');

    $first = postSync($body)->assertOk();
    $countsAfterFirst = ingestionTableCounts();
    $rollupsAfterFirst = rollupSnapshot();

    $this->travel(5)->minutes();

    postSync($body)
        ->assertOk()
        ->assertExactJson($first->json());

    expect(ingestionTableCounts())->toBe($countsAfterFirst)
        ->and(rollupSnapshot())->toBe($rollupsAfterFirst)
        ->and(SyncBatch::where('device_id', $device->id)->count())->toBe(1);
});

test('a new batch id carrying the same records reports every record as updated', function () {
    setTrackingCategories(['prompt' => true, 'git' => true]);
    ingestionDevice();
    $body = ingestionExample('sync.request.full.json');

    postSync($body)->assertOk();
    $counts = ingestionTableCounts();

    postSync(withNewBatchId($body))
        ->assertOk()
        ->assertJsonPath('sync', ['accepted' => 10, 'created' => 0, 'updated' => 10, 'rejected' => 0])
        ->assertJsonPath('rejected_records', []);

    expect(ingestionTableCounts())->toBe($counts);
});

test('the minimal example matches its response counts when its session already exists', function () {
    ingestionDevice();
    $body = ingestionExample('sync.request.minimal.json');
    $expected = ingestionExample('sync.response.minimal.json');

    // The example response (created 1, updated 1) describes a continuation: the session was sent before.
    postSync(syncBody(['sessions' => $body['sessions']], ['sequence' => 43]))->assertOk();

    $response = postSync($body)
        ->assertOk()
        ->assertJsonPath('batch_id', $expected['batch_id'])
        ->assertJsonPath('sync', $expected['sync'])
        ->assertJsonPath('rejected_records', $expected['rejected_records']);

    expect(decodeSyncCursor($response->json('cursor'))['sequence'])->toBe(44);
});

test('the prompt-off example matches its response counts when account and project already exist', function () {
    ingestionDevice();
    $body = ingestionExample('sync.request.prompt-off.json');
    $expected = ingestionExample('sync.response.prompt-off.json');

    // The example response (created 3, updated 2) assumes the account and project were sent in an earlier batch.
    postSync(syncBody(['accounts' => $body['accounts'], 'projects' => $body['projects']], ['sequence' => 44]))->assertOk();

    postSync($body)
        ->assertOk()
        ->assertJsonPath('batch_id', $expected['batch_id'])
        ->assertJsonPath('sync', $expected['sync'])
        ->assertJsonPath('rejected_records', $expected['rejected_records']);

    expect(ingestionTableCounts())->toMatchArray([
        'claude_accounts' => 1,
        'projects' => 1,
        'claude_sessions' => 1,
        'session_usage' => 2,
        'session_messages' => 0,
    ]);
});

test('the minimal and prompt-off examples on an empty database accept every record', function (string $request) {
    ingestionDevice();
    $body = ingestionExample($request);

    postSync($body)
        ->assertOk()
        ->assertJsonPath('sync.accepted', syncRecordTotal($body))
        ->assertJsonPath('sync.created', syncRecordTotal($body))
        ->assertJsonPath('sync.updated', 0)
        ->assertJsonPath('sync.rejected', 0);
})->with([
    'minimal' => 'sync.request.minimal.json',
    'prompt-off' => 'sync.request.prompt-off.json',
]);
