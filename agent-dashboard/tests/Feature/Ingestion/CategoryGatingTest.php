<?php

use App\Models\ClaudeSession;
use App\Models\Project;
use App\Models\SessionUsage;
use App\Models\SyncBatch;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-09-23T10:42:00Z'));
});

test('prompt OFF (default) rejects every message with category_disabled and stores none (AC29)', function () {
    ingestionDevice();
    $body = ingestionExample('sync.request.full.json');

    $response = postSync($body)
        ->assertOk()
        ->assertJsonPath('sync.accepted', 8)
        ->assertJsonPath('sync.rejected', 2);

    expect(DB::table('session_messages')->count())->toBe(0);

    $rejected = collect($response->json('rejected_records'));
    expect($rejected)->toHaveCount(2)
        ->and($rejected->pluck('type')->unique()->all())->toBe(['message'])
        ->and($rejected->pluck('reason')->unique()->all())->toBe(['category_disabled'])
        ->and($rejected->pluck('source_id')->sort()->values()->all())
        ->toBe(collect($body['messages'])->pluck('source_message_id')->sort()->values()->all());

    expect(SyncBatch::sole()->rejected)->toBe(2);
});

test('prompt OFF never persists message content anywhere', function () {
    ingestionDevice();
    $body = ingestionExample('sync.request.full.json');

    postSync($body)->assertOk();

    $batch = SyncBatch::sole();
    $stored = json_encode([$batch->rejections, $batch->response]);

    foreach ($body['messages'] as $message) {
        expect($stored)->not->toContain($message['content']);
    }
});

test('git OFF (default) nulls git_branch and git_remote without rejecting', function () {
    ingestionDevice();
    $body = ingestionExample('sync.request.full.json');
    $body['messages'] = [];

    postSync($body)
        ->assertOk()
        ->assertJsonPath('sync.rejected', 0)
        ->assertJsonPath('sync.accepted', 8);

    expect(ClaudeSession::whereNotNull('git_branch')->count())->toBe(0)
        ->and(Project::whereNotNull('git_remote')->count())->toBe(0)
        ->and(ClaudeSession::count())->toBe(2)
        ->and(Project::count())->toBe(2);
});

test('git ON keeps git_branch and git_remote', function () {
    setTrackingCategories(['git' => true]);
    ingestionDevice();
    $body = ingestionExample('sync.request.full.json');
    $body['messages'] = [];

    postSync($body)->assertOk()->assertJsonPath('sync.rejected', 0);

    expect(ClaudeSession::where('source_session_id', '3cd42766-9f0b-4b8e-a1c2-5d6e7f809a1b')->value('git_branch'))
        ->toBe('feature/login-throttle')
        ->and(Project::where('project_key', $body['projects'][0]['project_key'])->value('git_remote'))
        ->toBe('github.com/example-org/acme-api');
});

test('model OFF nulls model ids on sessions and usage without rejecting', function () {
    setTrackingCategories(['model' => false]);
    ingestionDevice();

    postSync(syncBody([
        'sessions' => [syncSession('model-off', ['model' => 'claude-sonnet-5'])],
        'usage' => [syncUsage('msg_model_off', 'model-off', ['model' => 'claude-sonnet-5'])],
    ]))
        ->assertOk()
        ->assertJsonPath('sync.accepted', 2)
        ->assertJsonPath('sync.rejected', 0);

    expect(ClaudeSession::sole()->claude_model_id)->toBeNull()
        ->and(SessionUsage::sole()->claude_model_id)->toBeNull();
});

test('session OFF rejects every session, usage and message record with category_disabled', function () {
    setTrackingCategories(['session' => false, 'prompt' => true]);
    ingestionDevice();
    $body = ingestionExample('sync.request.full.json');

    $response = postSync($body)
        ->assertOk()
        ->assertJsonPath('sync.accepted', 3)
        ->assertJsonPath('sync.rejected', 7);

    $rejected = collect($response->json('rejected_records'));
    expect($rejected)->toHaveCount(7)
        ->and($rejected->pluck('reason')->unique()->all())->toBe(['category_disabled'])
        ->and($rejected->countBy('type')->sortKeys()->all())->toBe(['message' => 2, 'session' => 2, 'usage' => 3]);

    expect(DB::table('claude_sessions')->count())->toBe(0)
        ->and(DB::table('session_usage')->count())->toBe(0)
        ->and(DB::table('session_messages')->count())->toBe(0)
        ->and(DB::table('usage_daily_rollups')->count())->toBe(0);
});
