<?php

use App\Actions\Ingestion\RefreshDailyRollups;
use App\Models\ClaudeAccount;
use App\Models\ClaudeModel;
use App\Models\ClaudeSession;
use App\Models\Device;
use App\Models\Project;
use App\Models\SessionUsage;
use App\Models\UsageDailyRollup;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

uses(TestCase::class, RefreshDatabase::class);

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
});

function rollupDimsHash(string $date, int $developerId, int $deviceId, ?int $projectId, ?int $accountId, ?int $modelId): string
{
    return hash('sha256', implode('|', [$date, $developerId, $deviceId, $projectId ?? '', $accountId ?? '', $modelId ?? '']));
}

test('it rebuilds rollups for the given device-date pairs from session_usage', function () {
    $device = Device::factory()->create();
    $project = Project::factory()->create();
    $account = ClaudeAccount::factory()->for($device->developer)->create();
    $model = ClaudeModel::factory()->create();
    $session = ClaudeSession::factory()->for($device)->create([
        'project_id' => $project->id, 'claude_account_id' => $account->id, 'claude_model_id' => $model->id,
    ]);

    // 2026-09-20 in Asia/Dhaka: 04:00Z and 17:59Z (23:59 local); 18:00Z is already 2026-09-21.
    SessionUsage::factory()->create([
        'claude_session_id' => $session->id, 'recorded_at' => '2026-09-20T04:00:00Z',
        'input_tokens' => 100000, 'output_tokens' => 20000, 'cache_creation_tokens' => 30000, 'cache_read_tokens' => 500000,
    ]);
    SessionUsage::factory()->create([
        'claude_session_id' => $session->id, 'recorded_at' => '2026-09-20T17:59:00Z',
        'input_tokens' => 1, 'output_tokens' => 2, 'cache_creation_tokens' => 3, 'cache_read_tokens' => 4,
    ]);
    SessionUsage::factory()->create([
        'claude_session_id' => $session->id, 'recorded_at' => '2026-09-20T18:00:00Z',
        'input_tokens' => 7, 'output_tokens' => 7, 'cache_creation_tokens' => 7, 'cache_read_tokens' => 7,
    ]);

    // A stale row for the refreshed pair (must be replaced) ...
    $stale = UsageDailyRollup::factory()->create(['device_id' => $device->id, 'date' => '2026-09-20']);
    // ... and rows outside the pair (must stay untouched).
    $otherDevice = UsageDailyRollup::factory()->create(['date' => '2026-09-20']);
    $otherDate = UsageDailyRollup::factory()->create(['device_id' => $device->id, 'date' => '2026-09-19']);

    app(RefreshDailyRollups::class)->handle([[$device->id, '2026-09-20']]);

    expect(UsageDailyRollup::whereKey($stale->id)->exists())->toBeFalse()
        ->and(UsageDailyRollup::whereKey($otherDevice->id)->exists())->toBeTrue()
        ->and(UsageDailyRollup::whereKey($otherDate->id)->exists())->toBeTrue()
        ->and(UsageDailyRollup::where('device_id', $device->id)->whereDate('date', '2026-09-21')->exists())->toBeFalse();

    $row = UsageDailyRollup::where('device_id', $device->id)->whereDate('date', '2026-09-20')->sole();
    expect($row->developer_id)->toBe($device->developer_id)
        ->and($row->project_id)->toBe($project->id)
        ->and($row->claude_account_id)->toBe($account->id)
        ->and($row->claude_model_id)->toBe($model->id)
        ->and($row->input_tokens)->toBe(100001)
        ->and($row->output_tokens)->toBe(20002)
        ->and($row->cache_creation_tokens)->toBe(30003)
        ->and($row->cache_read_tokens)->toBe(500004)
        ->and($row->actual_consumed_tokens)->toBe(150006)
        ->and($row->total_token_activity)->toBe(650010)
        ->and($row->message_count)->toBe(2)
        ->and($row->dims_hash)->toBe(rollupDimsHash('2026-09-20', $device->developer_id, $device->id, $project->id, $account->id, $model->id));

    app(RefreshDailyRollups::class)->handle([[$device->id, '2026-09-21']]);

    $next = UsageDailyRollup::where('device_id', $device->id)->whereDate('date', '2026-09-21')->sole();
    expect($next->total_token_activity)->toBe(28)
        ->and($next->message_count)->toBe(1);
});

test('usage with different dimensions produces one row per dimension set, nulls hashed as empty', function () {
    $device = Device::factory()->create();
    $model = ClaudeModel::factory()->create();
    $bare = ClaudeSession::factory()->for($device)->create(['project_id' => null, 'claude_account_id' => null, 'claude_model_id' => null]);
    $modelled = ClaudeSession::factory()->for($device)->create(['claude_model_id' => $model->id]);

    SessionUsage::factory()->create(['claude_session_id' => $bare->id, 'claude_model_id' => null, 'recorded_at' => '2026-09-20T04:00:00Z']);
    SessionUsage::factory()->create(['claude_session_id' => $modelled->id, 'claude_model_id' => $model->id, 'recorded_at' => '2026-09-20T05:00:00Z']);

    app(RefreshDailyRollups::class)->handle([[$device->id, '2026-09-20']]);

    $rows = UsageDailyRollup::where('device_id', $device->id)->get();
    expect($rows)->toHaveCount(2)
        ->and($rows->pluck('dims_hash')->sort()->values()->all())->toBe(collect([
            rollupDimsHash('2026-09-20', $device->developer_id, $device->id, null, null, null),
            rollupDimsHash('2026-09-20', $device->developer_id, $device->id, null, null, $model->id),
        ])->sort()->values()->all());
});

test('refreshing a pair with no usage removes its rollups', function () {
    $device = Device::factory()->create();
    UsageDailyRollup::factory()->create(['device_id' => $device->id, 'date' => '2026-09-20']);

    app(RefreshDailyRollups::class)->handle([[$device->id, '2026-09-20']]);

    expect(UsageDailyRollup::where('device_id', $device->id)->count())->toBe(0);
});

test('refreshing is idempotent', function () {
    $device = Device::factory()->create();
    $session = ClaudeSession::factory()->for($device)->create();
    SessionUsage::factory()->count(3)->create(['claude_session_id' => $session->id, 'recorded_at' => '2026-09-20T04:00:00Z']);

    $pairs = [[$device->id, '2026-09-20']];
    app(RefreshDailyRollups::class)->handle($pairs);
    $first = UsageDailyRollup::get()->map->only(['date', 'dims_hash', 'total_token_activity', 'message_count'])->all();

    app(RefreshDailyRollups::class)->handle($pairs);
    $second = UsageDailyRollup::get()->map->only(['date', 'dims_hash', 'total_token_activity', 'message_count'])->all();

    expect($second)->toEqual($first)
        ->and(UsageDailyRollup::count())->toBe(1);
});
