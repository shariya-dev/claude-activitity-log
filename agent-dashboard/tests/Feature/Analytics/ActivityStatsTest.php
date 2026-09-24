<?php

use App\Models\ClaudeAccount;
use App\Models\ClaudeModel;
use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\Project;
use App\Queries\Analytics\ActivityStats;
use App\Queries\Analytics\DateRange;
use App\Queries\Analytics\SessionSearch;
use App\Queries\Analytics\UsageFilters;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;

uses(RefreshDatabase::class);

/**
 * Timestamps are given in UTC. "Today" in Asia/Dhaka is 2026-09-21 18:00 … 2026-09-22 17:59:59 UTC.
 *
 * @param  array<string, mixed>  $attributes
 */
function seedSession(Device $device, string $startedAtUtc, string $lastActivityAtUtc, array $attributes = []): ClaudeSession
{
    $startedAt = CarbonImmutable::parse($startedAtUtc, 'UTC');
    $lastActivityAt = CarbonImmutable::parse($lastActivityAtUtc, 'UTC');

    return ClaudeSession::factory()->for($device)->create([
        'developer_id' => $device->developer_id,
        'started_at' => $startedAt,
        'last_activity_at' => $lastActivityAt,
        'duration_seconds' => (int) $startedAt->diffInSeconds($lastActivityAt),
        ...$attributes,
    ]);
}

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-22 10:00:00', 'Asia/Dhaka'));

    $this->alice = Developer::factory()->create(['name' => 'Alice Rahman', 'email' => 'alice@6am.test']);
    $this->bob = Developer::factory()->create(['name' => 'Bob Karim', 'email' => 'bob@6am.test']);
    $this->aliceMac = Device::factory()->for($this->alice)->create(['hostname' => 'alice-mbp', 'last_seen_at' => '2026-09-22 03:58:00']);
    $this->bobWin = Device::factory()->for($this->bob)->create(['hostname' => null, 'last_seen_at' => '2026-09-21 18:00:00']);
    $this->api = Project::factory()->create(['name' => 'Billing-Api']);
    $this->cms = Project::factory()->create(['name' => 'Content_CMS']);
    $this->idle = Project::factory()->create(['name' => 'Idle-App']);
    $this->opus = ClaudeModel::factory()->create(['name' => 'claude-opus-4-1']);
    $this->work = ClaudeAccount::factory()->for($this->alice)->create();

    // Started today (org tz).
    $this->s1 = seedSession($this->aliceMac, '2026-09-21 18:00:00', '2026-09-21 19:30:00', [
        'source_session_id' => 'aaaa1111-0000-4000-8000-000000000001', 'project_id' => $this->api->id,
        'claude_model_id' => $this->opus->id, 'claude_account_id' => $this->work->id,
        'actual_consumed_tokens' => 300, 'total_token_activity' => 9000,
    ]);
    $this->s2 = seedSession($this->aliceMac, '2026-09-22 02:00:00', '2026-09-22 03:55:00', [
        'source_session_id' => 'bbbb2222-0000-4000-8000-000000000002', 'project_id' => $this->cms->id,
        'actual_consumed_tokens' => 100, 'total_token_activity' => 20000,
    ]);
    $this->s3 = seedSession($this->bobWin, '2026-09-22 01:00:00', '2026-09-22 01:10:00', [
        'source_session_id' => 'cccc3333-0000-4000-8000-000000000003', 'project_id' => $this->api->id,
        'actual_consumed_tokens' => 50, 'total_token_activity' => 500,
    ]);
    // Started yesterday (org tz) — 17:59:59 UTC is 23:59:59 in Dhaka — but still active today.
    $this->s4 = seedSession($this->bobWin, '2026-09-21 17:59:59', '2026-09-21 18:30:00', [
        'source_session_id' => 'dddd4444-0000-4000-8000-000000000004', 'project_id' => $this->idle->id,
        'actual_consumed_tokens' => 10, 'total_token_activity' => 40,
    ]);
    // Last week, no project.
    $this->s5 = seedSession($this->bobWin, '2026-09-15 05:00:00', '2026-09-15 06:00:00', [
        'source_session_id' => 'eeee5555-0000-4000-8000-000000000005',
    ]);
});

afterEach(function () {
    Carbon::setTestNow();
});

test('total developers counts only active, non-deleted developers', function () {
    Developer::factory()->inactive()->create();
    Developer::factory()->create()->delete();

    expect(app(ActivityStats::class)->totalDevelopers())->toBe(2);
});

test('active devices are the ones seen inside the org-tz range', function () {
    Device::factory()->create(['last_seen_at' => '2026-09-21 17:59:59']);
    Device::factory()->create(['last_seen_at' => null]);

    $stats = app(ActivityStats::class);

    expect($stats->activeDevices(DateRange::preset('today')))->toBe(2)
        ->and($stats->activeDevices(DateRange::preset('yesterday')))->toBe(1)
        ->and($stats->activeDevices(DateRange::preset('week')))->toBe(3);
});

test('sessions count uses start time in the org-tz range and respects filters', function () {
    $stats = app(ActivityStats::class);
    $today = DateRange::preset('today');

    expect($stats->sessionsCount(new UsageFilters($today)))->toBe(3)
        ->and($stats->sessionsCount(new UsageFilters(DateRange::preset('yesterday'))))->toBe(1)
        ->and($stats->sessionsCount(new UsageFilters($today, developerId: $this->alice->id)))->toBe(2)
        ->and($stats->sessionsCount(new UsageFilters($today, deviceId: $this->bobWin->id)))->toBe(1)
        ->and($stats->sessionsCount(new UsageFilters($today, projectId: $this->api->id)))->toBe(2)
        ->and($stats->sessionsCount(new UsageFilters($today, accountId: $this->work->id)))->toBe(1)
        ->and($stats->sessionsCount(new UsageFilters($today, modelId: $this->opus->id)))->toBe(1)
        ->and($stats->sessionsCount(new UsageFilters($today, developerId: $this->bob->id, projectId: $this->cms->id)))->toBe(0);
});

test('active projects are projects with session activity overlapping the range', function () {
    $stats = app(ActivityStats::class);

    expect($stats->activeProjects(DateRange::preset('today')))->toBe(3)
        ->and($stats->activeProjects(DateRange::preset('yesterday')))->toBe(1)
        ->and($stats->activeProjects(new DateRange(
            CarbonImmutable::parse('2026-09-10', 'Asia/Dhaka')->startOfDay(),
            CarbonImmutable::parse('2026-09-16', 'Asia/Dhaka')->endOfDay(),
            'custom',
        )))->toBe(0);
});

test('recent sessions list the latest activity first with the documented row shape', function () {
    $rows = app(ActivityStats::class)->recentSessions(new UsageFilters(DateRange::preset('today')));

    expect(array_column($rows, 'id'))->toBe([$this->s2->id, $this->s3->id, $this->s1->id, $this->s4->id])
        ->and($rows[2])->toBe([
            'id' => $this->s1->id,
            'source_session_id' => 'aaaa1111-0000-4000-8000-000000000001',
            'developer' => 'Alice Rahman',
            'project' => 'Billing-Api',
            'model' => 'claude-opus-4-1',
            'device' => 'alice-mbp',
            'started_at' => '2026-09-21T18:00:00Z',
            'last_activity_at' => '2026-09-21T19:30:00Z',
            'duration_seconds' => 5400,
            'actual_consumed_tokens' => 300,
            'total_token_activity' => 9000,
        ])
        ->and($rows[1]['device'])->toBe($this->bobWin->device_uid)
        ->and($rows[1]['model'])->toBeNull();
});

test('recent sessions respect filters and limit', function () {
    $stats = app(ActivityStats::class);

    expect(array_column($stats->recentSessions(new UsageFilters(DateRange::preset('today'), developerId: $this->bob->id)), 'id'))
        ->toBe([$this->s3->id, $this->s4->id])
        ->and($stats->recentSessions(new UsageFilters(DateRange::preset('today')), 1))->toHaveCount(1);
});

test('session search returns paginated rows started in range, newest first by default', function () {
    $page = app(SessionSearch::class)->paginate(new UsageFilters(DateRange::preset('week')), null, 2);

    expect($page->total())->toBe(4)
        ->and($page->perPage())->toBe(2)
        ->and(array_column($page->items(), 'id'))->toBe([$this->s2->id, $this->s3->id])
        ->and(array_keys($page->items()[0]))->toBe([
            'id', 'source_session_id', 'developer', 'project', 'model', 'device', 'started_at',
            'last_activity_at', 'duration_seconds', 'actual_consumed_tokens', 'total_token_activity',
        ]);
});

dataset('searches', [
    'session id prefix' => ['bbbb22', ['s2']],
    'session id is prefix-only' => ['2222', []],
    'project name' => ['billing', ['s3', 's1']],
    'developer name' => ['Karim', ['s3', 's4']],
    'developer email' => ['alice@6am', ['s2', 's1']],
    'LIKE wildcards are literal' => ['%', []],
    'underscore matches itself' => ['t_C', ['s2']],
    'underscore is not a wildcard' => ['g_A', []],
    'blank search is ignored' => ['   ', ['s2', 's3', 's1', 's4']],
]);

test('session search matches session id prefix, project, developer name and email', function (string $search, array $expected) {
    $page = app(SessionSearch::class)->paginate(new UsageFilters(DateRange::preset('week')), $search);

    expect(array_column($page->items(), 'id'))->toBe(array_map(fn (string $key) => $this->{$key}->id, $expected));
})->with('searches');

test('session search combines search with filters', function () {
    $page = app(SessionSearch::class)->paginate(
        new UsageFilters(DateRange::preset('week'), developerId: $this->alice->id),
        'billing',
    );

    expect(array_column($page->items(), 'id'))->toBe([$this->s1->id]);
});

dataset('sorts', [
    'duration asc' => ['duration_seconds', 'asc', ['s3', 's4', 's1', 's2']],
    'total token activity desc' => ['total_token_activity', 'desc', ['s2', 's1', 's3', 's4']],
    'actual consumed asc' => ['actual_consumed_tokens', 'asc', ['s4', 's3', 's2', 's1']],
    'last activity desc' => ['last_activity_at', 'desc', ['s2', 's3', 's1', 's4']],
    'started asc' => ['started_at', 'asc', ['s4', 's1', 's3', 's2']],
    'invalid sort falls back to started_at' => ['source_session_id; drop table devices', 'asc', ['s4', 's1', 's3', 's2']],
    'invalid direction falls back to desc' => ['duration_seconds', 'sideways', ['s2', 's1', 's4', 's3']],
]);

test('session search sorting is whitelisted', function (string $sort, string $dir, array $expected) {
    $page = app(SessionSearch::class)->paginate(new UsageFilters(DateRange::preset('week')), null, 25, $sort, $dir);

    expect(array_column($page->items(), 'id'))->toBe(array_map(fn (string $key) => $this->{$key}->id, $expected));
})->with('sorts');
