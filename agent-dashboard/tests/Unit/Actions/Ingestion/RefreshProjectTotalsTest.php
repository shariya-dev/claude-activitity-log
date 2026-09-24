<?php

use App\Actions\Ingestion\RefreshProjectTotals;
use App\Models\ClaudeSession;
use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

uses(TestCase::class, RefreshDatabase::class);

test('it refreshes session_count, token totals and activity bounds from sessions', function () {
    $project = Project::factory()->create([
        'session_count' => 42,
        'total_token_activity' => 1,
        'first_activity_at' => '2020-01-01T00:00:00Z',
        'last_activity_at' => '2020-01-02T00:00:00Z',
    ]);
    $other = Project::factory()->create();

    ClaudeSession::factory()->create([
        'project_id' => $project->id,
        'started_at' => '2026-09-20T08:00:00Z', 'last_activity_at' => '2026-09-20T09:00:00Z',
        'input_tokens' => 100000, 'output_tokens' => 20000, 'cache_creation_tokens' => 30000, 'cache_read_tokens' => 500000,
        'actual_consumed_tokens' => 150000, 'total_token_activity' => 650000,
    ]);
    ClaudeSession::factory()->create([
        'project_id' => $project->id,
        'started_at' => '2026-09-21T08:00:00Z', 'last_activity_at' => '2026-09-22T10:00:00Z',
        'input_tokens' => 1, 'output_tokens' => 2, 'cache_creation_tokens' => 3, 'cache_read_tokens' => 4,
        'actual_consumed_tokens' => 6, 'total_token_activity' => 10,
    ]);
    ClaudeSession::factory()->create([
        'project_id' => $other->id,
        'input_tokens' => 5, 'actual_consumed_tokens' => 5, 'total_token_activity' => 5,
    ]);

    app(RefreshProjectTotals::class)->handle([$project->id]);

    $project->refresh();
    expect($project->session_count)->toBe(2)
        ->and($project->input_tokens)->toBe(100001)
        ->and($project->output_tokens)->toBe(20002)
        ->and($project->cache_creation_tokens)->toBe(30003)
        ->and($project->cache_read_tokens)->toBe(500004)
        ->and($project->actual_consumed_tokens)->toBe(150006)
        ->and($project->total_token_activity)->toBe(650010)
        ->and($project->first_activity_at->equalTo(Carbon::parse('2026-09-20T08:00:00Z')))->toBeTrue()
        ->and($project->last_activity_at->equalTo(Carbon::parse('2026-09-22T10:00:00Z')))->toBeTrue();

    expect($other->refresh()->session_count)->toBe(0);
});

test('a project without sessions gets zero totals and keeps its activity bounds', function () {
    $project = Project::factory()->create([
        'session_count' => 3,
        'actual_consumed_tokens' => 99,
        'total_token_activity' => 99,
        'first_activity_at' => '2026-09-01T00:00:00Z',
        'last_activity_at' => '2026-09-02T00:00:00Z',
    ]);

    app(RefreshProjectTotals::class)->handle([$project->id]);

    $project->refresh();
    expect($project->session_count)->toBe(0)
        ->and($project->actual_consumed_tokens)->toBe(0)
        ->and($project->total_token_activity)->toBe(0)
        ->and($project->first_activity_at->equalTo(Carbon::parse('2026-09-01T00:00:00Z')))->toBeTrue()
        ->and($project->last_activity_at->equalTo(Carbon::parse('2026-09-02T00:00:00Z')))->toBeTrue();
});
