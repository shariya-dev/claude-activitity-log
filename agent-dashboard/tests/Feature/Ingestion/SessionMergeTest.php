<?php

use App\Enums\SessionStatus;
use App\Models\ClaudeSession;
use App\Models\Project;
use App\Models\SessionUsage;
use App\Models\UsageDailyRollup;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-09-23T14:00:00Z'));
});

test('session times merge with LEAST/GREATEST and duration follows', function () {
    ingestionDevice();

    $send = fn (string $first, string $last) => postSync(syncBody([
        'sessions' => [syncSession('merge-me', ['first_seen_at' => syncIso($first), 'last_seen_at' => syncIso($last)])],
    ]))->assertOk()->assertJsonPath('sync.rejected', 0);

    $send('2026-09-23T10:00:00Z', '2026-09-23T11:00:00Z');
    $session = ClaudeSession::sole();
    expect($session->started_at->toIso8601ZuluString())->toBe('2026-09-23T10:00:00Z')
        ->and($session->last_activity_at->toIso8601ZuluString())->toBe('2026-09-23T11:00:00Z')
        ->and($session->duration_seconds)->toBe(3600);

    // Earlier start and later end widen the session.
    $send('2026-09-23T09:00:00Z', '2026-09-23T12:00:00Z');
    $session->refresh();
    expect($session->started_at->toIso8601ZuluString())->toBe('2026-09-23T09:00:00Z')
        ->and($session->last_activity_at->toIso8601ZuluString())->toBe('2026-09-23T12:00:00Z')
        ->and($session->duration_seconds)->toBe(10800);

    // A narrower chunk changes nothing.
    $send('2026-09-23T10:30:00Z', '2026-09-23T10:45:00Z');
    $session->refresh();
    expect($session->started_at->toIso8601ZuluString())->toBe('2026-09-23T09:00:00Z')
        ->and($session->last_activity_at->toIso8601ZuluString())->toBe('2026-09-23T12:00:00Z')
        ->and($session->duration_seconds)->toBe(10800)
        ->and(ClaudeSession::count())->toBe(1);
});

test('nullable session fields take the latest non-null value', function () {
    ingestionDevice();

    postSync(syncBody(['sessions' => [syncSession('fields', ['entrypoint' => 'cli', 'claude_code_version' => '2.1.260'])]]))->assertOk();
    postSync(syncBody(['sessions' => [syncSession('fields', ['entrypoint' => null, 'claude_code_version' => '2.1.274'])]]))->assertOk();

    $session = ClaudeSession::sole();
    expect($session->entrypoint)->toBe('cli')
        ->and($session->claude_code_version)->toBe('2.1.274');
});

test('session status is ended, active or idle', function () {
    ingestionDevice();

    postSync(syncBody([
        'sessions' => [
            syncSession('ended', ['first_seen_at' => syncIso('2026-09-23T13:00:00Z'), 'last_seen_at' => syncIso('2026-09-23T13:50:00Z'), 'ended_at' => syncIso('2026-09-23T13:50:00Z')]),
            syncSession('active', ['first_seen_at' => syncIso('2026-09-23T13:00:00Z'), 'last_seen_at' => syncIso('2026-09-23T13:50:00Z')]),
            syncSession('idle', ['first_seen_at' => syncIso('2026-09-23T10:00:00Z'), 'last_seen_at' => syncIso('2026-09-23T11:00:00Z')]),
        ],
    ]))->assertOk();

    expect(ClaudeSession::where('source_session_id', 'ended')->sole()->status)->toBe(SessionStatus::Ended)
        ->and(ClaudeSession::where('source_session_id', 'active')->sole()->status)->toBe(SessionStatus::Active)
        ->and(ClaudeSession::where('source_session_id', 'idle')->sole()->status)->toBe(SessionStatus::Idle);
});

test('moving a session to another project moves its usage dims, rollups and project totals', function () {
    $device = ingestionDevice();

    postSync(syncBody([
        'projects' => [syncProject('project-a')],
        'sessions' => [syncSession('movable', ['project_key' => projectKey('project-a')])],
        'usage' => [
            syncUsage('msg_m1', 'movable', ['input_tokens' => 100, 'output_tokens' => 200, 'cache_creation_tokens' => 300, 'cache_read_tokens' => 400]),
            syncUsage('msg_m2', 'movable', ['input_tokens' => 1, 'output_tokens' => 2, 'cache_creation_tokens' => 3, 'cache_read_tokens' => 4]),
        ],
    ]))->assertOk()->assertJsonPath('sync.rejected', 0);

    $projectA = Project::where('project_key', projectKey('project-a'))->sole();
    expect($projectA->session_count)->toBe(1)
        ->and($projectA->actual_consumed_tokens)->toBe(606)
        ->and($projectA->total_token_activity)->toBe(1010)
        ->and(UsageDailyRollup::where('project_id', $projectA->id)->sum('total_token_activity'))->toEqual(1010);

    // Later batch: same session, now under project B, no usage records.
    postSync(syncBody([
        'projects' => [syncProject('project-b')],
        'sessions' => [syncSession('movable', ['project_key' => projectKey('project-b')])],
    ]))->assertOk()->assertJsonPath('sync.rejected', 0);

    $projectA->refresh();
    $projectB = Project::where('project_key', projectKey('project-b'))->sole();
    $session = ClaudeSession::sole();

    expect($session->project_id)->toBe($projectB->id)
        ->and(SessionUsage::pluck('project_id')->unique()->values()->all())->toBe([$projectB->id]);

    expect(UsageDailyRollup::where('device_id', $device->id)->where('project_id', $projectA->id)->count())->toBe(0)
        ->and(UsageDailyRollup::where('device_id', $device->id)->where('project_id', $projectB->id)->sum('total_token_activity'))->toEqual(1010)
        ->and(UsageDailyRollup::where('device_id', $device->id)->where('project_id', $projectB->id)->sum('message_count'))->toEqual(2);

    expect($projectA->session_count)->toBe(0)
        ->and($projectA->actual_consumed_tokens)->toBe(0)
        ->and($projectA->total_token_activity)->toBe(0)
        ->and($projectB->session_count)->toBe(1)
        ->and($projectB->actual_consumed_tokens)->toBe(606)
        ->and($projectB->total_token_activity)->toBe(1010)
        ->and($projectB->cache_read_tokens)->toBe(404);
});

test('projects record a location per device and path', function () {
    $device = ingestionDevice();

    postSync(syncBody(['projects' => [syncProject('acme')]]))->assertOk();
    postSync(syncBody(['projects' => [syncProject('acme')]]))->assertOk()->assertJsonPath('sync.updated', 1);

    $project = Project::sole();
    expect($project->locations()->count())->toBe(1)
        ->and($project->locations()->first()->device_id)->toBe($device->id)
        ->and($project->locations()->first()->path)->toBe('/home/dev/work/acme');
});
