<?php

use App\Queries\Analytics\TokenAnalytics;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/dataset.php';

uses(RefreshDatabase::class);

/**
 * Every derived token number: per-row calc columns, session totals, project totals and daily rollups.
 *
 * @return array<string, mixed>
 */
function tvDerivedSnapshot(): array
{
    $tokens = implode(', ', tvMetricColumns(false));

    return [
        'usage' => array_map(fn (object $r): array => (array) $r, DB::select("SELECT claude_session_id, source_message_id, recorded_on, {$tokens} FROM session_usage ORDER BY claude_session_id, source_message_id")),
        'sessions' => array_map(fn (object $r): array => (array) $r, DB::select("SELECT source_session_id, activity_count, {$tokens} FROM claude_sessions ORDER BY source_session_id")),
        'projects' => array_map(fn (object $r): array => (array) $r, DB::select("SELECT name, session_count, {$tokens} FROM projects ORDER BY name")),
        'rollups' => rollupSnapshot(),
    ];
}

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    $this->travelTo(Carbon::parse(tvDatasetNow()));

    $this->dataset = tvDataset();
    tvIngestDataset($this->dataset);
});

test('TokenValidation recalculate: monitor:recalculate-tokens reproduces identical session, project and rollup totals', function () {
    $before = tvDerivedSnapshot();

    $this->artisan('monitor:recalculate-tokens')->assertSuccessful();

    expect(tvDerivedSnapshot())->toBe($before)
        ->and(app(TokenAnalytics::class)->totals(tvFilters('2025-01-01', '2026-12-31')))->toBe(tvTotal(tvExpectedRows($this->dataset)));
});

test('TokenValidation recalculate: tampered calc columns and rollups are rebuilt to the ingested values and the formulas', function () {
    $before = tvDerivedSnapshot();

    // Corrupt derived numbers only (raw token columns stay as ingested).
    DB::table('session_usage')->update(['actual_consumed_tokens' => 1, 'total_token_activity' => 2]);
    DB::table('usage_daily_rollups')->where('date', '2026-08-31')->delete();
    DB::table('usage_daily_rollups')->where('date', '2026-09-02')->update(['total_token_activity' => 3]);
    DB::table('claude_sessions')->update(['actual_consumed_tokens' => 0, 'total_token_activity' => 0]);
    expect(tvDerivedSnapshot())->not->toBe($before);

    $this->artisan('monitor:recalculate-tokens')->assertSuccessful();

    expect(tvDerivedSnapshot())->toBe($before)
        ->and(tvSqlTotal())->toBe(tvTotal(tvExpectedRows($this->dataset)))
        ->and(app(TokenAnalytics::class)->totals(tvFilters('2025-01-01', '2026-12-31')))->toBe(tvTotal(tvExpectedRows($this->dataset)));
});
