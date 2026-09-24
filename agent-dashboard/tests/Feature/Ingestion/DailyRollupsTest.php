<?php

use App\Actions\Ingestion\RefreshDailyRollups;
use App\Models\ClaudeSession;
use App\Models\SessionUsage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    $this->travelTo(Carbon::parse('2026-09-23T06:00:00Z'));
});

test('usage on either side of org midnight lands on the correct org day', function () {
    $device = ingestionDevice();

    postSync(syncBody([
        'sessions' => [
            syncSession('late-evening', ['first_seen_at' => syncIso('2026-09-22T17:00:00Z'), 'last_seen_at' => syncIso('2026-09-22T17:45:00Z')]),
            syncSession('after-midnight', ['first_seen_at' => syncIso('2026-09-22T18:15:00Z'), 'last_seen_at' => syncIso('2026-09-22T18:45:00Z')]),
        ],
        'usage' => [
            // 17:30Z = 23:30 in Dhaka (UTC+6) => 2026-09-22
            syncUsage('msg_late', 'late-evening', ['recorded_at' => syncIso('2026-09-22T17:30:00Z'), 'output_tokens' => 111]),
            // 18:30Z = 00:30 in Dhaka => 2026-09-23
            syncUsage('msg_after', 'after-midnight', ['recorded_at' => syncIso('2026-09-22T18:30:00Z'), 'output_tokens' => 222]),
        ],
    ]))->assertOk()->assertJsonPath('sync.rejected', 0);

    expect(SessionUsage::where('source_message_id', 'msg_late')->sole()->recorded_on->format('Y-m-d'))->toBe('2026-09-22')
        ->and(SessionUsage::where('source_message_id', 'msg_after')->sole()->recorded_on->format('Y-m-d'))->toBe('2026-09-23');

    $rows = DB::table('usage_daily_rollups')->orderBy('date')->get();
    expect($rows)->toHaveCount(2)
        ->and(Carbon::parse($rows[0]->date)->format('Y-m-d'))->toBe('2026-09-22')
        ->and((int) $rows[0]->output_tokens)->toBe(111)
        ->and((int) $rows[0]->message_count)->toBe(1)
        ->and((int) $rows[0]->device_id)->toBe($device->id)
        ->and(Carbon::parse($rows[1]->date)->format('Y-m-d'))->toBe('2026-09-23')
        ->and((int) $rows[1]->output_tokens)->toBe(222)
        ->and((int) $rows[1]->message_count)->toBe(1);
});

test('rollups carry the session dimensions and a dims_hash of the six dims', function () {
    $device = ingestionDevice();

    postSync(syncBody([
        'accounts' => [syncAccount('dana')],
        'projects' => [syncProject('acme')],
        'sessions' => [syncSession('dims', ['project_key' => projectKey('acme'), 'account_key' => accountKey('dana'), 'model' => 'claude-sonnet-5'])],
        'usage' => [
            syncUsage('msg_d1', 'dims', ['model' => 'claude-sonnet-5']),
            syncUsage('msg_d2', 'dims', ['model' => 'claude-sonnet-5']),
        ],
    ]))->assertOk()->assertJsonPath('sync.rejected', 0);

    $session = ClaudeSession::sole();
    $row = DB::table('usage_daily_rollups')->sole();

    expect((int) $row->developer_id)->toBe($device->developer_id)
        ->and((int) $row->project_id)->toBe($session->project_id)
        ->and((int) $row->claude_account_id)->toBe($session->claude_account_id)
        ->and((int) $row->claude_model_id)->toBe($session->claude_model_id)
        ->and((int) $row->message_count)->toBe(2)
        ->and($row->dims_hash)->toBe(hash('sha256', implode('|', [
            '2026-09-23', $device->developer_id, $device->id, $session->project_id,
            $session->claude_account_id, $session->claude_model_id,
        ])));
});

test('refreshing the same device-date pairs twice leaves identical rollup rows', function () {
    $device = ingestionDevice();

    postSync(syncBody([
        'sessions' => [
            syncSession('late-evening', ['first_seen_at' => syncIso('2026-09-22T17:00:00Z'), 'last_seen_at' => syncIso('2026-09-22T17:45:00Z')]),
            syncSession('after-midnight', ['first_seen_at' => syncIso('2026-09-22T18:15:00Z'), 'last_seen_at' => syncIso('2026-09-22T18:45:00Z')]),
        ],
        'usage' => [
            syncUsage('msg_late', 'late-evening', ['recorded_at' => syncIso('2026-09-22T17:30:00Z')]),
            syncUsage('msg_after', 'after-midnight', ['recorded_at' => syncIso('2026-09-22T18:30:00Z')]),
        ],
    ]))->assertOk();

    $before = rollupSnapshot();
    $pairs = [[$device->id, '2026-09-22'], [$device->id, '2026-09-23']];

    app(RefreshDailyRollups::class)->handle($pairs);
    $once = rollupSnapshot();
    app(RefreshDailyRollups::class)->handle($pairs);
    $twice = rollupSnapshot();

    expect($once)->toBe($before)
        ->and($twice)->toBe($before)
        ->and($twice)->toHaveCount(2);
});
