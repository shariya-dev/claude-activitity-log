<?php

use App\Enums\SyncBatchStatus;
use App\Models\AgentSyncState;
use App\Models\ClaudeAccount;
use App\Models\ClaudeSession;
use App\Models\Device;
use App\Models\SyncBatch;
use App\Models\TrackingSetting;
use App\Models\UsageDailyRollup;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-22 10:00:00', 'Asia/Dhaka'));
    TrackingSetting::current()->update(['min_agent_version' => '1.2.0']);
});

afterEach(function () {
    Carbon::setTestNow();
});

test('unknown device uid is a 404', function () {
    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('devices.show', ['device' => 'dev_missing']))
        ->assertNotFound();
});

test('viewers see identity, versions, timeline and sync state', function () {
    $device = Device::factory()->online()->create([
        'hostname' => 'alice-mbp',
        'agent_version' => '1.1.0',
        'first_seen_at' => '2026-08-01 00:00:00',
        'sync_requested_at' => '2026-09-22 03:59:00',
    ]);
    AgentSyncState::factory()->failing()->create([
        'device_id' => $device->id,
        'cursor' => 'opaque-cursor',
        'records_created_total' => 12,
        'records_updated_total' => 3,
        'records_rejected_total' => 2,
        'last_error_message' => 'Payload too large.',
    ]);

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('devices.show', $device))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Devices/Show')
            ->where('device.device_uid', $device->device_uid)
            ->where('device.hostname', 'alice-mbp')
            ->where('device.outdated', true)
            ->where('device.health', 'sync_failed')
            ->where('device.connection', 'online')
            ->where('device.first_seen_at', '2026-08-01T00:00:00Z')
            ->where('device.sync_requested_at', '2026-09-22T03:59:00Z')
            ->where('device.developer.name', $device->developer->name)
            ->where('device.developer.deleted', false)
            ->where('sync_state.records_created_total', 12)
            ->where('sync_state.records_rejected_total', 2)
            ->where('sync_state.last_error_code', 'persistence_failed')
            ->where('sync_state.last_error_message', 'Payload too large.')
            ->missing('sync_state.cursor')
            ->where('min_agent_version', '1.2.0')
            ->where('range.preset', 'month')
        );
});

test('shows accounts seen on the device', function () {
    $device = Device::factory()->create();
    $account = ClaudeAccount::factory()->create(['developer_id' => $device->developer_id, 'email' => 'alice@example.test']);
    $device->claudeAccounts()->attach($account->id, ['first_seen_at' => '2026-09-01 00:00:00', 'last_seen_at' => '2026-09-21 00:00:00']);
    ClaudeAccount::factory()->create(['developer_id' => $device->developer_id, 'email' => 'other-device@example.test']);

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('devices.show', $device))
        ->assertInertia(fn (Assert $page) => $page
            ->has('accounts', 1)
            ->where('accounts.0.id', $account->id)
            ->where('accounts.0.email', 'alice@example.test')
            ->where('accounts.0.first_seen_at', '2026-09-01T00:00:00Z')
            ->where('accounts.0.last_seen_at', '2026-09-21T00:00:00Z')
        );
});

test('token totals, trend and recent sessions are scoped to the device and range', function () {
    $device = Device::factory()->create();
    $other = Device::factory()->create();
    UsageDailyRollup::factory()->create([
        'device_id' => $device->id, 'date' => '2026-09-21',
        'input_tokens' => 10, 'output_tokens' => 20, 'cache_creation_tokens' => 30, 'cache_read_tokens' => 40,
    ]);
    UsageDailyRollup::factory()->create(['device_id' => $other->id, 'date' => '2026-09-21']);
    $session = ClaudeSession::factory()->create([
        'device_id' => $device->id,
        'started_at' => '2026-09-21 02:00:00',
        'last_activity_at' => '2026-09-21 03:00:00',
    ]);
    ClaudeSession::factory()->create(['device_id' => $other->id, 'started_at' => '2026-09-21 02:00:00', 'last_activity_at' => '2026-09-21 03:00:00']);

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('devices.show', ['device' => $device, 'range' => 'week']))
        ->assertInertia(fn (Assert $page) => $page
            ->where('range.preset', 'week')
            ->where('totals.actual_consumed_tokens', 60)
            ->where('totals.total_token_activity', 100)
            ->has('trend', 7)
            ->has('recent_sessions', 1)
            ->where('recent_sessions.0.id', $session->id)
        );
});

test('lists the last 20 sync batches newest first with rejections', function () {
    $device = Device::factory()->create();
    foreach (range(1, 22) as $minutes) {
        SyncBatch::factory()->create(['device_id' => $device->id, 'received_at' => now()->subMinutes($minutes + 10)]);
    }
    $latest = SyncBatch::factory()->create([
        'device_id' => $device->id,
        'received_at' => now()->subMinute(),
        'rejected' => 2,
        'rejections' => [
            ['type' => 'usage', 'source_id' => 'msg_01', 'reason' => 'invalid_timestamp'],
            ['type' => 'session', 'source_id' => 'sess_02', 'reason' => 'unknown_project'],
        ],
        'response' => ['success' => true, 'cursor' => 'secret-replay'],
    ]);

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('devices.show', $device))
        ->assertDontSee('secret-replay')
        ->assertInertia(fn (Assert $page) => $page
            ->has('batches', 20)
            ->where('batches.0.id', $latest->id)
            ->where('batches.0.status', SyncBatchStatus::Succeeded->value)
            ->where('batches.0.rejected', 2)
            ->has('batches.0.rejections', 2)
            ->where('batches.0.rejections.0.reason', 'invalid_timestamp')
            ->where('batches.0.rejections.1.source_id', 'sess_02')
            ->where('batches.1.rejections', [])
            ->missing('batches.0.response')
        );
});

test('device detail never exposes credentials, fingerprints or network data', function () {
    $device = Device::factory()->create(['last_public_ip' => '203.0.113.9']);
    $token = $device->createToken('agent', ['agent'])->plainTextToken;

    $this->actingAs(User::factory()->admin()->create())
        ->get(route('devices.show', $device))
        ->assertOk()
        ->assertDontSee('203.0.113.9')
        ->assertDontSee($device->machine_fingerprint)
        ->assertDontSee(explode('|', $token)[1])
        ->assertInertia(fn (Assert $page) => $page
            ->missing('device.last_public_ip')
            ->missing('device.machine_fingerprint')
            ->missing('device.tokens')
        );
});
