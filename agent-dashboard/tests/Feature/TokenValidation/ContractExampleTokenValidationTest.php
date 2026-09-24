<?php

use App\Models\ClaudeSession;
use App\Models\Project;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\Granularity;
use App\Queries\Analytics\TokenAnalytics;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->withoutVite();
    config(['monitor.timezone' => 'Asia/Dhaka']);
    // The example's cursor was acked at 10:40:02Z; its latest record is 10:41:07Z.
    $this->travelTo(Carbon::parse('2026-09-23T10:42:00Z'));

    $this->body = ingestionExample('sync.request.full.json');
    setTrackingCategories(['prompt' => true, 'git' => true]);
    $this->device = ingestionDevice();
    postSync($this->body)->assertOk()->assertJsonPath('success', true)->assertJsonPath('sync.rejected', 0);

    // Expected rows straight from the JSON usage array (per-field max if a message id repeats in a session).
    $projectOf = collect($this->body['sessions'])->pluck('project_key', 'source_session_id');
    $projectName = collect($this->body['projects'])->pluck('name', 'project_key');

    $this->rows = array_map(fn (array $u): array => [
        ...$u,
        'project' => $projectName[$projectOf[$u['source_session_id']]],
        'day' => tvOrgDay($u['recorded_at']),
    ], tvDedupe(array_map(fn (array $u): array => $u + [
        'session' => $u['source_session_id'],
        'message' => $u['source_message_id'],
    ], $this->body['usage'])));
});

test('TokenValidation H03 full example: session totals equal SQL sums over session_usage and the JSON usage arithmetic', function () {
    $expected = tvGroup($this->rows, fn (array $r): string => $r['session']);

    // Hand check of the example's numbers (docs/contracts/examples/sync.request.full.json).
    expect($expected)->toBe([
        '3cd42766-9f0b-4b8e-a1c2-5d6e7f809a1b' => tvMetrics(2 + 1204, 866 + 312, 48433 + 0, 19929 + 8850, 2),
        '7a1e5c3d-2f4b-4c6d-8e9f-0a1b2c3d4e5f' => tvMetrics(6, 1450, 2210, 60312, 1),
    ])->and($expected['3cd42766-9f0b-4b8e-a1c2-5d6e7f809a1b']['total_token_activity'])->toBe(79596)
        ->and($expected['7a1e5c3d-2f4b-4c6d-8e9f-0a1b2c3d4e5f']['total_token_activity'])->toBe(63978);

    $sql = tvSql('(SELECT s.source_session_id FROM claude_sessions s WHERE s.id = session_usage.claude_session_id)');
    expect($sql)->toBe($expected);

    $sessions = ClaudeSession::query()->get()->mapWithKeys(fn (ClaudeSession $s): array => [
        $s->source_session_id => [...$s->only(tvMetricColumns(false)), 'message_count' => $s->activity_count],
    ])->sortKeys(SORT_STRING)->all();
    expect($sessions)->toBe($expected);

    foreach (ClaudeSession::all() as $session) {
        $props = tvPage('sessions.show', ['session' => $session->id]);
        expect($props['totals'])->toBe($expected[$session->source_session_id]);
    }
});

test('TokenValidation H03 full example: model, project and day totals via H07 equal SQL and the JSON arithmetic', function () {
    $analytics = app(TokenAnalytics::class);
    $filters = tvFilters('2026-09-23', '2026-09-23');
    $ids = tvIds();

    $expectedModel = tvGroup($this->rows, fn (array $r): int => $ids['model'][$r['model']]);
    expect(array_keys(tvGroup($this->rows, fn (array $r): string => $r['model'])))->toBe(['claude-haiku-5', 'claude-opus-5', 'claude-sonnet-5'])
        ->and(tvSql('claude_model_id'))->toBe($expectedModel)
        ->and(tvKeyed($analytics->breakdown($filters, Dimension::Model), 'id'))->toBe($expectedModel);

    $expectedProject = tvGroup($this->rows, fn (array $r): int => $ids['project'][$r['project']]);
    expect(tvSql('project_id'))->toBe($expectedProject)
        ->and(tvKeyed($analytics->breakdown($filters, Dimension::Project), 'id'))->toBe($expectedProject);

    $projects = Project::query()->get()->mapWithKeys(fn (Project $p): array => [(string) $p->id => $p->only(tvMetricColumns(false))])->sortKeys(SORT_STRING)->all();
    expect($projects)->toBe(array_map(fn (array $m): array => tvOnly($m, false), $expectedProject));

    $expectedDay = tvGroup($this->rows, fn (array $r): string => $r['day']);
    expect(array_keys($expectedDay))->toBe(['2026-09-23'])
        ->and(tvSql("DATE_FORMAT(recorded_on, '%Y-%m-%d')"))->toBe($expectedDay)
        ->and(tvKeyed($analytics->trend($filters, Granularity::Day), 'period'))->toBe($expectedDay)
        ->and($analytics->totals($filters))->toBe($expectedDay['2026-09-23'])
        ->and(tvSqlTotal())->toBe($expectedDay['2026-09-23']);

    $page = tvPage('analytics.tokens', ['range' => 'today', 'group' => 'model']);
    expect($page['totals'])->toBe($expectedDay['2026-09-23'])
        ->and(tvKeyed($page['breakdown'], 'id'))->toBe($expectedModel);
    tvAssertIdentity($page['breakdown'], 'H03 model breakdown');
});
