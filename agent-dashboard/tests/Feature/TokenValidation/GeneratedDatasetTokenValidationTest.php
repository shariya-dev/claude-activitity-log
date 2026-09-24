<?php

use App\Models\ClaudeSession;
use App\Models\Project;
use App\Models\SessionUsage;
use App\Queries\Analytics\ActivityStats;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\Granularity;
use App\Queries\Analytics\SessionSearch;
use App\Queries\Analytics\TokenAnalytics;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;

require_once __DIR__.'/dataset.php';

uses(RefreshDatabase::class);

const TV_ALL_FROM = '2025-01-01';
const TV_ALL_TO = '2026-12-31';

/** Dimension => [key of the expected row, SQL column on session_usage]. */
const TV_DIMENSIONS = [
    'developer' => ['developer', 'developer_id'],
    'device' => ['device', 'device_id'],
    'account' => ['account', 'claude_account_id'],
    'project' => ['project', 'project_id'],
    'model' => ['model', 'claude_model_id'],
];

beforeEach(function () {
    $this->withoutVite();
    config(['monitor.timezone' => 'Asia/Dhaka']);
    $this->travelTo(Carbon::parse(tvDatasetNow()));

    $this->dataset = tvDataset();
    $this->ingested = tvIngestDataset($this->dataset);
    $this->ids = tvIds();

    // Expected rows with DB ids resolved by name (null dimension => null id => '' group key).
    $this->rows = array_map(fn (array $r): array => $r + [
        'developer_id' => $this->ids['developer'][$r['developer']],
        'device_id' => $this->ids['device'][$r['device']],
        'project_id' => $r['project'] === null ? null : $this->ids['project'][$r['project']],
        'account_id' => $r['account'] === null ? null : $this->ids['account'][$r['account']],
        'model_id' => $this->ids['model'][$r['model']],
        'session_id' => $this->ids['session'][$r['session']],
    ], tvExpectedRows($this->dataset));

    $this->analytics = app(TokenAnalytics::class);
});

test('TokenValidation dataset: each session total agrees across arithmetic, SQL, claude_sessions, SessionSearch, recentSessions and the session pages', function () {
    $expected = tvGroup($this->rows, fn (array $r): int => $r['session_id']);
    expect($expected)->toHaveCount(8);

    expect(tvSql('claude_session_id'))->toBe($expected);

    $stored = ClaudeSession::query()->get()->mapWithKeys(fn (ClaudeSession $s): array => [
        (string) $s->id => [...$s->only(tvMetricColumns(false)), 'message_count' => $s->activity_count],
    ])->sortKeys(SORT_STRING)->all();
    expect($stored)->toBe($expected);
    tvAssertIdentity($stored, 'claude_sessions');

    $all = tvFilters(TV_ALL_FROM, TV_ALL_TO);
    $actualTotal = fn (array $m): array => ['actual_consumed_tokens' => $m['actual_consumed_tokens'], 'total_token_activity' => $m['total_token_activity']];
    $expectedList = array_map($actualTotal, $expected);
    $listed = fn (iterable $rows): array => collect($rows)->mapWithKeys(fn (array $r): array => [
        (string) $r['id'] => $actualTotal($r),
    ])->sortKeys(SORT_STRING)->all();

    expect($listed(app(SessionSearch::class)->paginate($all, null, 100)->items()))->toBe($expectedList)
        ->and($listed(app(ActivityStats::class)->recentSessions($all, 100)))->toBe($expectedList);

    $index = tvPage('sessions.index', ['range' => 'custom', 'from' => TV_ALL_FROM, 'to' => TV_ALL_TO]);
    expect($index['sessions']['total'])->toBe(8)
        ->and($listed($index['sessions']['data']))->toBe($expectedList);

    foreach ($expected as $sessionId => $metrics) {
        $show = tvPage('sessions.show', ['session' => $sessionId]);
        expect($show['totals'])->toBe($metrics, "session page {$sessionId}")
            ->and(tvSumMetrics($show['timeline'], false))->toBe(tvOnly($metrics, false), "session timeline {$sessionId}");
        tvAssertIdentity($show['timeline'], "timeline of session {$sessionId}");
    }
});

test('TokenValidation dataset: developer, device, account, project and model totals agree across arithmetic, SQL, H07 and the token analytics page', function () {
    $all = tvFilters(TV_ALL_FROM, TV_ALL_TO);
    $totals = tvTotal($this->rows);

    expect(tvSqlTotal())->toBe($totals)
        ->and($this->analytics->totals($all))->toBe($totals);

    foreach (TV_DIMENSIONS as $dimension => [$rowKey, $column]) {
        $expected = tvGroup($this->rows, fn (array $r): ?int => $r[$rowKey.'_id']);
        $h07 = $this->analytics->breakdown($all, Dimension::from($dimension), 100);
        $page = tvPage('analytics.tokens', ['range' => 'custom', 'from' => TV_ALL_FROM, 'to' => TV_ALL_TO, 'group' => $dimension]);

        expect(tvSql($column))->toBe($expected, "SQL by {$dimension}")
            ->and(tvKeyed($h07, 'id'))->toBe($expected, "H07 breakdown by {$dimension}")
            ->and($page['breakdownTruncated'])->toBeFalse()
            ->and(tvKeyed($page['breakdown'], 'id'))->toBe($expected, "page breakdown by {$dimension}")
            ->and($page['totals'])->toBe($totals, "page totals ({$dimension})")
            // Grand identity: the breakdown over any dimension sums to the totals.
            ->and(tvSumMetrics($h07))->toBe($totals, "sum of H07 breakdown by {$dimension}")
            ->and(tvSumMetrics($page['breakdown']))->toBe($totals, "sum of page breakdown by {$dimension}");
        tvAssertIdentity($h07, "H07 breakdown by {$dimension}");
    }

    // The unassigned session has no project/account: it is its own "Unknown" bucket, not dropped.
    $byProject = collect($this->analytics->breakdown($all, Dimension::Project))->keyBy(fn (array $r): string => $r['label']);
    expect($byProject->keys()->sort()->values()->all())->toBe(['Unknown', 'atlas', 'borealis'])
        ->and(tvOnly($byProject['Unknown']))->toBe(tvGroup($this->rows, fn (array $r): ?string => $r['project'])['']);

    // Denormalized project totals (projects table) match too.
    $projects = Project::query()->get()->mapWithKeys(fn (Project $p): array => [(string) $p->id => $p->only(tvMetricColumns(false))])->sortKeys(SORT_STRING)->all();
    $expectedProjects = array_map(fn (array $m): array => tvOnly($m, false), array_diff_key(tvGroup($this->rows, fn (array $r): ?int => $r['project_id']), ['' => true]));
    expect($projects)->toBe($expectedProjects);

    // Dimension filters: every developer's filtered totals, and one two-dimension combination.
    foreach ($this->ids['developer'] as $email => $developerId) {
        $expected = tvTotal(array_values(array_filter($this->rows, fn (array $r): bool => $r['developer'] === $email)));
        expect($this->analytics->totals(tvFilters(TV_ALL_FROM, TV_ALL_TO, ['developer' => $developerId])))->toBe($expected)
            ->and(tvSqlTotal('developer_id = ?', [$developerId]))->toBe($expected);
    }

    $combo = ['developer' => $this->ids['developer']['alice@6am.test'], 'project' => $this->ids['project']['atlas']];
    $expected = tvTotal(array_values(array_filter($this->rows, fn (array $r): bool => $r['developer'] === 'alice@6am.test' && $r['project'] === 'atlas')));
    expect($this->analytics->totals(tvFilters(TV_ALL_FROM, TV_ALL_TO, $combo)))->toBe($expected)
        ->and(tvSqlTotal('developer_id = ? AND project_id = ?', array_values($combo)))->toBe($expected)
        ->and(tvPage('analytics.tokens', ['range' => 'custom', 'from' => TV_ALL_FROM, 'to' => TV_ALL_TO, ...$combo])['totals'])->toBe($expected);
});

test('TokenValidation dataset: day, week (Monday start), month and year trend buckets agree across arithmetic, SQL, H07 and the page', function (string $granularity, string $from, string $to, string $sqlKey) {
    $inRange = array_values(array_filter($this->rows, fn (array $r): bool => $r['day'] >= $from && $r['day'] <= $to));
    $expected = tvGroup($inRange, fn (array $r): string => tvPeriod($r['day'], $granularity));
    $filters = tvFilters($from, $to);

    $h07 = tvKeyed($this->analytics->trend($filters, Granularity::from($granularity)), 'period');
    $page = tvPage('analytics.tokens', ['range' => 'custom', 'from' => $from, 'to' => $to, 'granularity' => $granularity]);
    $zero = tvMetrics(0, 0, 0, 0, 0);

    expect(tvSql($sqlKey, 'recorded_on BETWEEN ? AND ?', [$from, $to]))->toBe($expected)
        ->and(array_diff(array_keys($expected), array_keys($h07)))->toBe([], 'every non-empty bucket is present in the trend')
        ->and(tvKeyed($page['trend'], 'period'))->toBe($h07);

    foreach ($h07 as $period => $metrics) {
        expect($metrics)->toBe($expected[$period] ?? $zero, "{$granularity} bucket {$period}");
    }

    tvAssertIdentity($h07, "{$granularity} trend");
    expect(tvSumMetrics($h07))->toBe(tvTotal($inRange))
        ->and($this->analytics->totals($filters))->toBe(tvTotal($inRange))
        ->and($page['totals'])->toBe(tvTotal($inRange));
})->with([
    'day' => ['day', '2026-08-24', '2026-09-06', "DATE_FORMAT(recorded_on, '%Y-%m-%d')"],
    'week' => ['week', '2026-08-01', '2026-09-30', "DATE_FORMAT(DATE_SUB(recorded_on, INTERVAL WEEKDAY(recorded_on) DAY), '%Y-%m-%d')"],
    'month' => ['month', '2025-12-01', '2026-09-30', "DATE_FORMAT(recorded_on, '%Y-%m')"],
    'year' => ['year', TV_ALL_FROM, TV_ALL_TO, "DATE_FORMAT(recorded_on, '%Y')"],
]);

test('TokenValidation dataset: cross-midnight sessions split by org day while the session total stays whole', function () {
    $recordedOn = SessionUsage::query()->pluck('recorded_on', 'source_message_id')->map(fn ($d): string => substr((string) $d, 0, 10));

    // Org midnight (18:00:00.000Z in Dhaka) splits; UTC midnight does not.
    expect($recordedOn['msg_s1_2'])->toBe('2026-08-30')
        ->and($recordedOn['msg_s1_3'])->toBe('2026-08-31')
        ->and($recordedOn['msg_s2_1'])->toBe('2026-08-31')
        ->and($recordedOn['msg_s2_2'])->toBe('2026-09-01')
        ->and($recordedOn['msg_s3_1'])->toBe('2026-09-02')
        ->and($recordedOn['msg_s3_2'])->toBe('2026-09-02')
        ->and($recordedOn['msg_s3_3'])->toBe('2026-09-02')
        ->and($recordedOn['msg_s5_1'])->toBe('2025-12-31')
        ->and($recordedOn['msg_s5_2'])->toBe('2026-01-01');

    foreach ($this->rows as $row) {
        expect($recordedOn[$row['message']])->toBe($row['day'], "org day of {$row['message']}");
    }

    foreach (['tv-alice-atlas-midnight' => ['2026-08-30', '2026-08-31'], 'tv-alice-borealis-month' => ['2026-08-31', '2026-09-01'], 'tv-carol-atlas-new-year' => ['2025-12-31', '2026-01-01'], 'tv-bob-atlas-utc-midnight' => ['2026-09-02']] as $source => $days) {
        $mine = array_values(array_filter($this->rows, fn (array $r): bool => $r['session'] === $source));
        $sessionId = $this->ids['session'][$source];
        $perDay = tvGroup($mine, fn (array $r): string => $r['day']);

        expect(array_keys($perDay))->toBe($days)
            ->and(tvSql("DATE_FORMAT(recorded_on, '%Y-%m-%d')", 'claude_session_id = ?', [$sessionId]))->toBe($perDay)
            ->and(tvSumMetrics($perDay))->toBe(tvTotal($mine), 'day parts sum to the whole session')
            ->and(tvPage('sessions.show', ['session' => $sessionId])['totals'])->toBe(tvTotal($mine));
    }

    // One H07 day bucket per side of the org midnight; each contains exactly that day's usage from every session.
    $trend = tvKeyed($this->analytics->trend(tvFilters('2026-08-30', '2026-09-02'), Granularity::Day), 'period');
    $expected = tvGroup(array_values(array_filter($this->rows, fn (array $r): bool => $r['day'] >= '2026-08-30' && $r['day'] <= '2026-09-02')), fn (array $r): string => $r['day']);
    expect($trend)->toBe($expected)
        ->and(array_keys($trend))->toBe(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
});

test('TokenValidation dataset: custom date ranges (incl. one straddling the week and month boundaries) agree across arithmetic, SQL, H07 and the page', function (string $from, string $to) {
    $inRange = array_values(array_filter($this->rows, fn (array $r): bool => $r['day'] >= $from && $r['day'] <= $to));
    $expected = tvTotal($inRange);
    $filters = tvFilters($from, $to);

    expect($inRange)->not->toBeEmpty()
        ->and(tvSqlTotal('recorded_on BETWEEN ? AND ?', [$from, $to]))->toBe($expected)
        ->and($this->analytics->totals($filters))->toBe($expected)
        ->and(tvPage('analytics.tokens', ['range' => 'custom', 'from' => $from, 'to' => $to])['totals'])->toBe($expected);

    foreach (TV_DIMENSIONS as $dimension => [$rowKey, $column]) {
        $breakdown = $this->analytics->breakdown($filters, Dimension::from($dimension), 100);
        expect(tvKeyed($breakdown, 'id'))->toBe(tvGroup($inRange, fn (array $r): ?int => $r[$rowKey.'_id']), "{$from}..{$to} by {$dimension}")
            ->and(tvSumMetrics($breakdown))->toBe($expected);
    }
})->with([
    'week+month boundary' => ['2026-08-30', '2026-09-01'],
    'single cross-midnight day' => ['2026-08-31', '2026-08-31'],
    'new year' => ['2025-12-31', '2026-01-01'],
    'everything' => [TV_ALL_FROM, TV_ALL_TO],
]);

test('TokenValidation dataset: a split message delivered in three batches counts once with the per-field max; replays do not double count', function () {
    $split = SessionUsage::where('source_message_id', 'msg_split')->sole();
    expect($split->only(tvRawColumns()))->toBe(['input_tokens' => 7, 'output_tokens' => 866, 'cache_creation_tokens' => 1200, 'cache_read_tokens' => 5000])
        ->and($split->actual_consumed_tokens)->toBe(7 + 866 + 1200)
        ->and($split->total_token_activity)->toBe(7 + 866 + 1200 + 5000);

    $sessionId = $this->ids['session']['tv-carol-borealis-split'];
    $expected = tvGroup(array_values(array_filter($this->rows, fn (array $r): bool => $r['session'] === 'tv-carol-borealis-split')), fn (): string => 'x')['x'];
    expect($expected['message_count'])->toBe(3)
        ->and(tvSqlTotal('claude_session_id = ?', [$sessionId]))->toBe($expected);

    $snapshot = fn (): array => [
        ingestionTableCounts(),
        rollupSnapshot(),
        ClaudeSession::query()->orderBy('id')->get()->map(fn (ClaudeSession $s): array => $s->only([...tvMetricColumns(false), 'activity_count']))->all(),
        tvSql('claude_session_id'),
    ];
    $before = $snapshot();
    $carol = $this->ingested['devices']['carol'];

    // Replay every carol batch verbatim (same batch_id): cached response, nothing written.
    foreach ($this->ingested['bodies']['carol'] as $body) {
        tvPostAs($carol, $body);
    }
    expect($snapshot())->toBe($before);

    // Re-send the same records under new batch ids (agent retry after a lost ack): upserts, still no double count.
    foreach ($this->ingested['bodies']['carol'] as $body) {
        tvPostAs($carol, withNewBatchId($body));
    }
    expect($snapshot())->toBe($before)
        ->and(tvPage('sessions.show', ['session' => $sessionId])['totals'])->toBe($expected)
        ->and($this->analytics->totals(tvFilters(TV_ALL_FROM, TV_ALL_TO)))->toBe(tvTotal($this->rows));
});

test('TokenValidation dataset: a split line whose later batch carries an earlier timestamp across org midnight moves to the earlier org day, whole', function () {
    $d = '2026-09-01';
    $next = '2026-09-02';
    $carol = $this->ingested['devices']['carol'];
    $sessionId = $this->ids['session']['tv-carol-borealis-split'];
    $sessionRows = array_values(array_filter($this->rows, fn (array $r): bool => $r['session'] === 'tv-carol-borealis-split'));
    $byDay = fn (array $rows): array => tvGroup(array_values(array_filter($rows, fn (array $r): bool => $r['day'] >= $d && $r['day'] <= $next)), fn (array $r): string => $r['day']);

    // 1) The dataset message: delivered first at 18:00:00.010Z (org day D+1), then at 17:59:59.990Z (org day D).
    expect(tvOrgDay('2026-09-01T18:00:00.010Z'))->toBe($next)
        ->and(tvOrgDay('2026-09-01T17:59:59.990Z'))->toBe($d);

    $usage = SessionUsage::where('source_message_id', 'msg_midnight_split')->sole();
    expect($usage->recorded_on->format('Y-m-d'))->toBe($d)
        ->and($usage->recorded_at->utc()->format('Y-m-d\TH:i:s.v\Z'))->toBe('2026-09-01T17:59:59.990Z')
        ->and($usage->only(tvRawColumns()))->toBe(['input_tokens' => 11, 'output_tokens' => 950, 'cache_creation_tokens' => 300, 'cache_read_tokens' => 4000])
        ->and($usage->actual_consumed_tokens)->toBe(11 + 950 + 300)
        ->and($usage->total_token_activity)->toBe(11 + 950 + 300 + 4000);

    $expectedDays = $byDay($this->rows);
    $filters = tvFilters($d, $next);
    expect(tvKeyed($this->analytics->trend($filters, Granularity::Day), 'period'))->toBe($expectedDays)
        ->and(tvKeyed(tvPage('analytics.tokens', ['range' => 'custom', 'from' => $d, 'to' => $next, 'granularity' => 'day'])['trend'], 'period'))->toBe($expectedDays)
        ->and(tvSql("DATE_FORMAT(recorded_on, '%Y-%m-%d')", 'recorded_on BETWEEN ? AND ?', [$d, $next]))->toBe($expectedDays)
        ->and(tvRollups('date BETWEEN ? AND ?', [$d, $next]))->toBe($expectedDays);

    // Carol's D+1 rollup holds only the msg_split + msg_s7_2 lines; D holds the moved message.
    $carolRows = array_values(array_filter($this->rows, fn (array $r): bool => $r['device'] === $carol->device_uid));
    expect(tvRollups('device_id = ? AND date BETWEEN ? AND ?', [$carol->id, $d, $next]))->toBe($byDay($carolRows))
        ->and(tvRollups('device_id = ? AND date = ?', [$carol->id, $next])[$next]['message_count'])->toBe(2)
        ->and(tvRollups('device_id = ? AND date = ?', [$carol->id, $d])[$d])->toBe(tvMetrics(11, 950, 300, 4000, 1));

    $sessionTotal = tvTotal($sessionRows);
    expect(tvSqlTotal('claude_session_id = ?', [$sessionId]))->toBe($sessionTotal)
        ->and(tvPage('sessions.show', ['session' => $sessionId])['totals'])->toBe($sessionTotal)
        ->and(tvSumMetrics($byDay($sessionRows)))->toBe($sessionTotal);

    // 2) Live before/after: a fresh line with identical tokens, sent at D+1 then re-sent at D in a new batch.
    $session = syncSession('tv-carol-borealis-split', [
        'project_key' => projectKey('borealis'),
        'account_key' => accountKey('carol-personal'),
        'first_seen_at' => '2026-09-01T17:59:59.990Z',
        'last_seen_at' => '2026-09-02T08:05:00.000Z',
    ]);
    $line = fn (string $at): array => syncUsage('msg_midnight_live', 'tv-carol-borealis-split', [
        'model' => 'claude-sonnet-5', 'recorded_at' => $at,
        'input_tokens' => 5, 'output_tokens' => 40, 'cache_creation_tokens' => 60, 'cache_read_tokens' => 700,
    ]);
    $agent = ['device_id' => $carol->device_uid, 'platform' => 'linux'];
    $live = tvMetrics(5, 40, 60, 700, 1);
    $carolBefore = tvRollups('device_id = ?', [$carol->id]);
    $plus = fn (array $a, array $b): array => tvSumMetrics([$a, $b]);

    tvPostAs($carol, syncBody(['sessions' => [$session], 'usage' => [$line('2026-09-01T18:00:00.010Z')]], ['sequence' => 10], $agent));
    $afterFirst = tvRollups('device_id = ?', [$carol->id]);
    $sessionAfterFirst = tvSqlTotal('claude_session_id = ?', [$sessionId]);
    expect(SessionUsage::where('source_message_id', 'msg_midnight_live')->sole()->recorded_on->format('Y-m-d'))->toBe($next)
        ->and($afterFirst[$next])->toBe($plus($carolBefore[$next], $live))
        ->and($afterFirst[$d])->toBe($carolBefore[$d])
        ->and($sessionAfterFirst)->toBe($plus($sessionTotal, $live));

    tvPostAs($carol, syncBody(['sessions' => [$session], 'usage' => [$line('2026-09-01T17:59:59.990Z')]], ['sequence' => 11], $agent));
    $afterSecond = tvRollups('device_id = ?', [$carol->id]);
    expect(SessionUsage::where('source_message_id', 'msg_midnight_live')->sole()->recorded_on->format('Y-m-d'))->toBe($d)
        ->and($afterSecond[$next])->toBe($carolBefore[$next], 'D+1 rollup no longer holds the moved line')
        ->and($afterSecond[$d])->toBe($plus($carolBefore[$d], $live))
        ->and(tvSqlTotal('claude_session_id = ?', [$sessionId]))->toBe($sessionAfterFirst, 'session total unchanged by the day move')
        ->and(ClaudeSession::find($sessionId)->only(tvMetricColumns(false)))->toBe(tvOnly($sessionAfterFirst, false))
        ->and(tvKeyed($this->analytics->trend($filters, Granularity::Day), 'period'))->toBe([
            $d => $plus($expectedDays[$d], $live),
            $next => $expectedDays[$next],
        ]);
});
