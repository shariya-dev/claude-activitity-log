<?php

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

test('a 500-usage batch is ingested in under 1.5 seconds', function () {
    $this->travelTo(Carbon::parse('2026-09-23T12:00:00Z'));
    ingestionDevice();

    $start = Carbon::parse('2026-09-23T06:00:00Z');
    $usage = [];
    for ($i = 0; $i < 500; $i++) {
        $usage[] = syncUsage(sprintf('msg_perf_%04d', $i), 'perf-session', [
            'model' => 'claude-sonnet-5',
            'recorded_at' => syncIso($start->copy()->addSeconds($i * 7)),
            'input_tokens' => $i,
            'output_tokens' => $i * 2,
            'cache_creation_tokens' => $i * 3,
            'cache_read_tokens' => $i * 4,
        ]);
    }

    $body = syncBody([
        'projects' => [syncProject('perf')],
        'sessions' => [syncSession('perf-session', [
            'project_key' => projectKey('perf'),
            'model' => 'claude-sonnet-5',
            'first_seen_at' => syncIso($start),
            'last_seen_at' => syncIso($start->copy()->addSeconds(499 * 7)),
        ])],
        'usage' => $usage,
    ]);

    $t0 = hrtime(true);
    $response = postSync($body);
    $elapsedMs = (hrtime(true) - $t0) / 1_000_000;

    fwrite(STDERR, sprintf("\n[perf] 500-usage sync batch ingested in %.1f ms\n", $elapsedMs));

    $response->assertOk()->assertJsonPath('sync.accepted', 502)->assertJsonPath('sync.rejected', 0);

    expect(DB::table('session_usage')->count())->toBe(500)
        ->and($elapsedMs)->toBeLessThan(1500.0);
})->group('perf');
