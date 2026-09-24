<?php

use App\Actions\Ingestion\RecomputeSessionTotals;
use App\Enums\SessionStatus;
use App\Models\ClaudeModel;
use App\Models\ClaudeSession;
use App\Models\Device;
use App\Models\SessionUsage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

uses(TestCase::class, RefreshDatabase::class);

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-09-23T12:00:00Z'));
});

test('it sums usage into session totals, counts activity and derives duration and latest model', function () {
    $older = ClaudeModel::factory()->create();
    $latest = ClaudeModel::factory()->create();

    $session = ClaudeSession::factory()->create([
        'started_at' => '2026-09-23T08:00:00Z',
        'last_activity_at' => '2026-09-23T09:30:00Z',
        'ended_at' => null,
        'duration_seconds' => 1,
        'activity_count' => 99,
        'input_tokens' => 999_999,
        'actual_consumed_tokens' => 999_999,
        'total_token_activity' => 999_999,
        'claude_model_id' => null,
        'status' => SessionStatus::Active,
    ]);

    SessionUsage::factory()->create([
        'claude_session_id' => $session->id, 'claude_model_id' => $latest->id, 'recorded_at' => '2026-09-23T09:20:00Z',
        'input_tokens' => 100000, 'output_tokens' => 20000, 'cache_creation_tokens' => 30000, 'cache_read_tokens' => 500000,
    ]);
    SessionUsage::factory()->create([
        'claude_session_id' => $session->id, 'claude_model_id' => $older->id, 'recorded_at' => '2026-09-23T08:10:00Z',
        'input_tokens' => 1, 'output_tokens' => 2, 'cache_creation_tokens' => 3, 'cache_read_tokens' => 4,
    ]);
    SessionUsage::factory()->create([
        'claude_session_id' => $session->id, 'claude_model_id' => $older->id, 'recorded_at' => '2026-09-23T08:40:00Z',
        'input_tokens' => 10, 'output_tokens' => 20, 'cache_creation_tokens' => 30, 'cache_read_tokens' => 40,
    ]);

    app(RecomputeSessionTotals::class)->handle([$session->id]);

    $session->refresh();
    expect($session->activity_count)->toBe(3)
        ->and($session->input_tokens)->toBe(100011)
        ->and($session->output_tokens)->toBe(20022)
        ->and($session->cache_creation_tokens)->toBe(30033)
        ->and($session->cache_read_tokens)->toBe(500044)
        ->and($session->actual_consumed_tokens)->toBe(150066)
        ->and($session->total_token_activity)->toBe(650110)
        ->and($session->duration_seconds)->toBe(5400)
        ->and($session->claude_model_id)->toBe($latest->id)
        ->and($session->status)->toBe(SessionStatus::Idle);
});

test('status is ended when ended_at is set, active within 30 minutes, idle otherwise', function () {
    $device = Device::factory()->create();

    $ended = ClaudeSession::factory()->for($device)->create([
        'started_at' => now()->subMinutes(20), 'last_activity_at' => now()->subMinutes(5), 'ended_at' => now()->subMinutes(5),
        'status' => SessionStatus::Active,
    ]);
    $active = ClaudeSession::factory()->for($device)->create([
        'started_at' => now()->subHour(), 'last_activity_at' => now()->subMinutes(10), 'ended_at' => null,
        'status' => SessionStatus::Idle,
    ]);
    $idle = ClaudeSession::factory()->for($device)->create([
        'started_at' => now()->subHours(3), 'last_activity_at' => now()->subHours(2), 'ended_at' => null,
        'status' => SessionStatus::Active,
    ]);

    app(RecomputeSessionTotals::class)->handle([$ended->id, $active->id, $idle->id]);

    expect($ended->refresh()->status)->toBe(SessionStatus::Ended)
        ->and($active->refresh()->status)->toBe(SessionStatus::Active)
        ->and($idle->refresh()->status)->toBe(SessionStatus::Idle)
        ->and($active->duration_seconds)->toBe(50 * 60);
});

test('a session without usage gets zero totals and keeps its model', function () {
    $model = ClaudeModel::factory()->create();
    $session = ClaudeSession::factory()->create([
        'claude_model_id' => $model->id,
        'activity_count' => 5,
        'output_tokens' => 123,
        'total_token_activity' => 123,
    ]);

    app(RecomputeSessionTotals::class)->handle([$session->id]);

    $session->refresh();
    expect($session->activity_count)->toBe(0)
        ->and($session->output_tokens)->toBe(0)
        ->and($session->total_token_activity)->toBe(0)
        ->and($session->claude_model_id)->toBe($model->id);
});

test('only the given sessions are recomputed', function () {
    $target = ClaudeSession::factory()->create();
    $other = ClaudeSession::factory()->create(['output_tokens' => 777, 'activity_count' => 7]);
    SessionUsage::factory()->create(['claude_session_id' => $target->id]);
    SessionUsage::factory()->create(['claude_session_id' => $other->id]);

    app(RecomputeSessionTotals::class)->handle([$target->id]);

    expect($target->refresh()->activity_count)->toBe(1)
        ->and($other->refresh()->activity_count)->toBe(7)
        ->and($other->output_tokens)->toBe(777);
});
