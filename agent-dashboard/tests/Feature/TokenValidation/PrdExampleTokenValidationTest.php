<?php

use App\Models\ClaudeSession;
use App\Queries\Analytics\ActivityStats;
use App\Queries\Analytics\DateRange;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\Granularity;
use App\Queries\Analytics\SessionSearch;
use App\Queries\Analytics\TokenAnalytics;
use App\Queries\Analytics\UsageFilters;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

/*
 * PRD §20: Input 100,000 / Output 20,000 / Cache Creation 30,000 / Cache Read 500,000
 * => Total Token Activity 650,000, Actual Consumed 150,000, cache read 500,000 shown separately.
 * Split over four messages; one of them is also re-delivered in a later batch with a partial (lower) output.
 */
function tvPrdMessages(): array
{
    return [
        ['message' => 'msg_prd_a', 'recorded_at' => '2026-09-23T08:00:00.000Z', 'input_tokens' => 40000, 'output_tokens' => 5000, 'cache_creation_tokens' => 20000, 'cache_read_tokens' => 200000],
        ['message' => 'msg_prd_b', 'recorded_at' => '2026-09-23T08:10:00.000Z', 'input_tokens' => 30000, 'output_tokens' => 7000, 'cache_creation_tokens' => 10000, 'cache_read_tokens' => 150000],
        ['message' => 'msg_prd_c', 'recorded_at' => '2026-09-23T08:20:00.000Z', 'input_tokens' => 20000, 'output_tokens' => 3000, 'cache_creation_tokens' => 0, 'cache_read_tokens' => 100000],
        ['message' => 'msg_prd_d', 'recorded_at' => '2026-09-23T08:30:00.000Z', 'input_tokens' => 10000, 'output_tokens' => 5000, 'cache_creation_tokens' => 0, 'cache_read_tokens' => 50000],
    ];
}

beforeEach(function () {
    $this->withoutVite();
    config(['monitor.timezone' => 'Asia/Dhaka']);
    $this->travelTo(Carbon::parse('2026-09-23T12:00:00Z'));

    $this->device = tvPairedDevice('prd', 'macos');
    $session = syncSession('prd-20-session', [
        'project_key' => projectKey('prd-project'),
        'first_seen_at' => syncIso('2026-09-23T07:59:00Z'),
        'last_seen_at' => syncIso('2026-09-23T08:30:00Z'),
        'model' => 'claude-sonnet-5',
    ]);
    $usage = fn (array $m): array => syncUsage($m['message'], 'prd-20-session', [
        'model' => 'claude-sonnet-5',
        'recorded_at' => $m['recorded_at'],
        ...array_intersect_key($m, array_flip(tvRawColumns())),
    ]);
    $agent = ['device_id' => $this->device->device_uid, 'platform' => 'macos'];

    tvPostAs($this->device, syncBody([
        'projects' => [syncProject('prd-project')],
        'sessions' => [$session],
        'usage' => array_map($usage, tvPrdMessages()),
    ], ['sequence' => 1], $agent));

    // Split-line re-delivery of msg_prd_b with a partial output: must not change anything (per-field max).
    $partial = tvPrdMessages()[1];
    $partial['output_tokens'] = 1200;
    tvPostAs($this->device, syncBody(['sessions' => [$session], 'usage' => [$usage($partial)]], ['sequence' => 2], $agent));

    $this->session = ClaudeSession::where('source_session_id', 'prd-20-session')->sole();
});

test('TokenValidation PRD §20: dataset arithmetic, SQL over session_usage and the claude_sessions row all give 650,000 / 150,000', function () {
    $expected = tvTotal(array_map(fn (array $m): array => $m + ['session' => 'prd-20-session', 'model' => null], tvPrdMessages()));

    // The PRD literals themselves, so the arithmetic above is also checked against the spec.
    expect($expected)->toBe([
        'input_tokens' => 100000, 'output_tokens' => 20000, 'cache_creation_tokens' => 30000, 'cache_read_tokens' => 500000,
        'actual_consumed_tokens' => 150000, 'total_token_activity' => 650000, 'message_count' => 4,
    ]);

    expect(tvSqlTotal())->toBe($expected)
        ->and(tvSql('claude_session_id'))->toBe([(string) $this->session->id => $expected]);

    $row = $this->session->refresh()->only(tvMetricColumns(false));
    expect($row)->toBe(tvOnly($expected, false))
        ->and($this->session->activity_count)->toBe(4);
});

test('TokenValidation PRD §20: H07 totals, breakdown, trend and session lists report 650,000 total and 150,000 actual', function () {
    $expected = tvMetrics(100000, 20000, 30000, 500000, 4);
    $analytics = app(TokenAnalytics::class);
    $today = new UsageFilters(DateRange::preset('today'));

    expect($analytics->totals($today))->toBe($expected)
        ->and($analytics->totals(tvFilters('2026-09-23', '2026-09-23')))->toBe($expected);

    $trend = $analytics->trend($today, Granularity::Day);
    expect($trend)->toHaveCount(1)
        ->and($trend[0]['period'])->toBe('2026-09-23')
        ->and(tvOnly($trend[0]))->toBe($expected);

    foreach (Dimension::cases() as $dimension) {
        $breakdown = $analytics->breakdown($today, $dimension);
        expect($breakdown)->toHaveCount(1)
            ->and(tvOnly($breakdown[0]))->toBe($expected, "breakdown by {$dimension->value}");
    }

    $listed = app(SessionSearch::class)->paginate($today, null)->items();
    $recent = app(ActivityStats::class)->recentSessions($today);

    foreach ([$listed, $recent] as $rows) {
        expect($rows)->toHaveCount(1)
            ->and($rows[0]['actual_consumed_tokens'])->toBe(150000)
            ->and($rows[0]['total_token_activity'])->toBe(650000);
    }
});

test('TokenValidation PRD §20: session page and token analytics page props show 650,000 total, 150,000 actual and 500,000 cache read', function () {
    $expected = tvMetrics(100000, 20000, 30000, 500000, 4);

    $show = tvPage('sessions.show', ['session' => $this->session->id]);
    expect($show['totals'])->toBe($expected)
        ->and(tvSumMetrics($show['timeline'], false))->toBe(tvOnly($expected, false));
    tvAssertIdentity($show['timeline'], 'session timeline');

    $index = tvPage('sessions.index', ['range' => 'today']);
    expect($index['sessions']['data'])->toHaveCount(1)
        ->and($index['sessions']['data'][0]['actual_consumed_tokens'])->toBe(150000)
        ->and($index['sessions']['data'][0]['total_token_activity'])->toBe(650000);

    $tokens = tvPage('analytics.tokens', ['range' => 'today', 'group' => 'project']);
    expect($tokens['totals'])->toBe($expected)
        ->and($tokens['totals']['cache_read_tokens'])->toBe(500000)
        ->and(tvOnly($tokens['breakdown'][0]))->toBe($expected)
        ->and($tokens['breakdown'][0]['label'])->toBe('prd-project')
        ->and(tvSumMetrics($tokens['trend']))->toBe($expected);
});
