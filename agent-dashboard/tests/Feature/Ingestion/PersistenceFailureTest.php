<?php

use App\Actions\Ingestion\RefreshDailyRollups;
use App\Enums\SyncBatchStatus;
use App\Enums\SyncHealth;
use App\Models\AgentSyncState;
use App\Models\SyncBatch;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-09-23T10:42:00Z'));
    setTrackingCategories(['prompt' => true, 'git' => true]);
});

test('a failure inside the transaction returns 500, writes nothing and a retry of the same batch succeeds (AC17)', function () {
    $device = ingestionDevice();
    $body = ingestionExample('sync.request.full.json');

    // Throw on the first call only, then call through to the real action. Works whether the
    // action is resolved per request or held by a cached controller instance.
    $real = app(RefreshDailyRollups::class);
    $mock = Mockery::mock(RefreshDailyRollups::class);
    $mock->shouldReceive('handle')->once()->andThrow(new RuntimeException('forced rollup failure'));
    $mock->shouldReceive('handle')->andReturnUsing(fn (array $pairs) => $real->handle($pairs));
    $this->instance(RefreshDailyRollups::class, $mock);

    postSync($body)
        ->assertStatus(500)
        ->assertJsonPath('success', false)
        ->assertJsonPath('error.code', 'persistence_failed')
        ->assertJsonPath('error.retryable', true)
        ->assertJsonMissingPath('error.errors');

    foreach (['claude_sessions', 'session_usage', 'session_messages', 'projects', 'project_locations', 'claude_accounts', 'claude_account_device', 'usage_daily_rollups'] as $table) {
        expect(DB::table($table)->count())->toBe(0, "{$table} should be empty after a failed batch");
    }

    $batch = SyncBatch::where('device_id', $device->id)->sole();
    expect($batch->status)->toBe(SyncBatchStatus::Failed)
        ->and($batch->error_code)->toBe('persistence_failed')
        ->and($batch->response)->toBeNull();

    $state = AgentSyncState::where('device_id', $device->id)->sole();
    expect($state->last_failure_at)->not->toBeNull()
        ->and($state->last_error_code)->toBe('persistence_failed')
        ->and($state->consecutive_failures)->toBe(1)
        ->and($state->health)->toBe(SyncHealth::SyncFailed)
        ->and($state->cursor)->toBeNull();

    expect($device->refresh()->last_sync_at)->toBeNull();

    // Retry the byte-identical body with the same batch_id.
    postSync($body)
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('sync', ['accepted' => 10, 'created' => 10, 'updated' => 0, 'rejected' => 0]);

    expect(ingestionTableCounts())->toMatchArray([
        'claude_sessions' => 2,
        'session_usage' => 3,
        'session_messages' => 2,
        'projects' => 2,
        'claude_accounts' => 1,
    ])->and(DB::table('usage_daily_rollups')->count())->toBeGreaterThan(0);

    $batch->refresh();
    expect($batch->status)->toBe(SyncBatchStatus::Succeeded)
        ->and(SyncBatch::where('device_id', $device->id)->count())->toBe(1);

    $state->refresh();
    expect($state->health)->toBe(SyncHealth::Healthy)
        ->and($state->consecutive_failures)->toBe(0)
        ->and($state->sequence)->toBe(42);
});
