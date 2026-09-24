<?php

use App\Models\ClaudeSession;
use App\Models\SessionUsage;
use App\Models\UsageDailyRollup;
use App\Support\TokenMath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-09-23T12:00:00Z'));
});

test('a split message sent across batches keeps the per-column maximum and recomputes calc columns', function () {
    ingestionDevice();

    foreach ([100, 866, 100] as $output) {
        postSync(syncBody([
            'sessions' => [syncSession('split-session')],
            'usage' => [syncUsage('msg_split', 'split-session', [
                'input_tokens' => 7,
                'output_tokens' => $output,
                'cache_creation_tokens' => 1200,
                'cache_read_tokens' => 5000,
            ])],
        ]))->assertOk()->assertJsonPath('sync.rejected', 0);
    }

    $usage = SessionUsage::sole();
    $expected = TokenMath::forRow(['input_tokens' => 7, 'output_tokens' => 866, 'cache_creation_tokens' => 1200, 'cache_read_tokens' => 5000]);

    expect($usage->output_tokens)->toBe(866)
        ->and($usage->input_tokens)->toBe(7)
        ->and($usage->actual_consumed_tokens)->toBe($expected['actual_consumed_tokens'])
        ->and($usage->actual_consumed_tokens)->toBe(2073)
        ->and($usage->total_token_activity)->toBe($expected['total_token_activity'])
        ->and($usage->total_token_activity)->toBe(7073);

    $session = ClaudeSession::sole();
    expect($session->output_tokens)->toBe(866)
        ->and($session->actual_consumed_tokens)->toBe(2073)
        ->and($session->total_token_activity)->toBe(7073)
        ->and($session->activity_count)->toBe(1);

    $rollup = UsageDailyRollup::sole();
    expect($rollup->output_tokens)->toBe(866)
        ->and($rollup->actual_consumed_tokens)->toBe(2073)
        ->and($rollup->total_token_activity)->toBe(7073)
        ->and($rollup->message_count)->toBe(1);
});

test('the PRD §20 example yields actual 150000 and total 650000 on the session and the rollup (AC24-26)', function () {
    ingestionDevice();

    postSync(syncBody([
        'sessions' => [syncSession('prd-session')],
        'usage' => [syncUsage('msg_prd', 'prd-session', [
            'input_tokens' => 100000,
            'output_tokens' => 20000,
            'cache_creation_tokens' => 30000,
            'cache_read_tokens' => 500000,
        ])],
    ]))->assertOk();

    $usage = SessionUsage::sole();
    expect($usage->actual_consumed_tokens)->toBe(150000)
        ->and($usage->total_token_activity)->toBe(650000);

    $session = ClaudeSession::sole();
    expect($session->input_tokens)->toBe(100000)
        ->and($session->output_tokens)->toBe(20000)
        ->and($session->cache_creation_tokens)->toBe(30000)
        ->and($session->cache_read_tokens)->toBe(500000)
        ->and($session->actual_consumed_tokens)->toBe(150000)
        ->and($session->total_token_activity)->toBe(650000);

    $rollup = UsageDailyRollup::sole();
    expect($rollup->date->format('Y-m-d'))->toBe('2026-09-23')
        ->and($rollup->cache_read_tokens)->toBe(500000)
        ->and($rollup->actual_consumed_tokens)->toBe(150000)
        ->and($rollup->total_token_activity)->toBe(650000)
        ->and($rollup->message_count)->toBe(1);
});

test('session totals sum several usage rows', function () {
    ingestionDevice();

    postSync(syncBody([
        'sessions' => [syncSession('multi')],
        'usage' => [
            syncUsage('msg_a', 'multi', ['input_tokens' => 1, 'output_tokens' => 2, 'cache_creation_tokens' => 3, 'cache_read_tokens' => 4]),
            syncUsage('msg_b', 'multi', ['input_tokens' => 10, 'output_tokens' => 20, 'cache_creation_tokens' => 30, 'cache_read_tokens' => 40]),
        ],
    ]))->assertOk();

    $session = ClaudeSession::sole();
    expect($session->activity_count)->toBe(2)
        ->and($session->input_tokens)->toBe(11)
        ->and($session->output_tokens)->toBe(22)
        ->and($session->cache_creation_tokens)->toBe(33)
        ->and($session->cache_read_tokens)->toBe(44)
        ->and($session->actual_consumed_tokens)->toBe(66)
        ->and($session->total_token_activity)->toBe(110);
});
