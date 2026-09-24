<?php

use App\Models\ClaudeSession;
use App\Models\Project;
use App\Models\SessionUsage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-09-23T10:42:00Z'));
    ingestionDevice();
});

test('timestamps on the first day after the epoch are rejected, never reaching a DB error', function () {
    $body = syncBody([
        'sessions' => [
            syncSession('s-ok'),
            syncSession('s-epoch', ['first_seen_at' => '1970-01-01T02:00:00Z']),
        ],
        'usage' => [syncUsage('m-epoch', 's-ok', ['recorded_at' => '1970-01-01T01:00:00Z'])],
    ]);

    $response = postSync($body)->assertOk()->assertJsonPath('sync.accepted', 1)->assertJsonPath('sync.rejected', 2);

    expect(collect($response->json('rejected_records'))->pluck('reason', 'source_id')->all())
        ->toBe(['s-epoch' => 'invalid_timestamp', 'm-epoch' => 'invalid_timestamp']);
});

test('token values above the storable ceiling are rejected as invalid_value', function () {
    $body = syncBody([
        'sessions' => [syncSession('s1')],
        'usage' => [syncUsage('m-huge', 's1', ['output_tokens' => 2 ** 40 + 1])],
    ]);

    postSync($body)->assertOk()
        ->assertJsonPath('rejected_records.0.source_id', 'm-huge')
        ->assertJsonPath('rejected_records.0.reason', 'invalid_value');

    expect(SessionUsage::count())->toBe(0);
});

test('over-long strings and malformed hash keys are rejected as invalid_value', function () {
    $body = syncBody([
        'projects' => [syncProject('p1', ['project_key' => 'NOT-A-HASH'])],
        'sessions' => [syncSession('s-long', ['entrypoint' => str_repeat('x', 65)])],
    ]);

    $response = postSync($body)->assertOk()->assertJsonPath('sync.rejected', 2);

    expect(collect($response->json('rejected_records'))->pluck('reason', 'source_id')->all())
        ->toBe(['NOT-A-HASH' => 'invalid_value', 's-long' => 'invalid_value']);
});

test('account OFF rejects accounts and nulls session account keys', function () {
    setTrackingCategories(['account' => false]);

    $body = syncBody([
        'accounts' => [syncAccount('dana')],
        'sessions' => [syncSession('s1', ['account_key' => accountKey('dana')])],
    ]);

    postSync($body)->assertOk()
        ->assertJsonPath('sync', ['accepted' => 1, 'created' => 1, 'updated' => 0, 'rejected' => 1])
        ->assertJsonPath('rejected_records.0.reason', 'category_disabled');

    expect(DB::table('claude_accounts')->count())->toBe(0)
        ->and(ClaudeSession::sole()->claude_account_id)->toBeNull();
});

test('project OFF rejects projects and nulls session project keys', function () {
    setTrackingCategories(['project' => false]);

    $body = syncBody([
        'projects' => [syncProject('acme')],
        'sessions' => [syncSession('s1', ['project_key' => projectKey('acme')])],
    ]);

    postSync($body)->assertOk()
        ->assertJsonPath('sync', ['accepted' => 1, 'created' => 1, 'updated' => 0, 'rejected' => 1])
        ->assertJsonPath('rejected_records.0.type', 'project');

    expect(Project::count())->toBe(0)
        ->and(ClaudeSession::sole()->project_id)->toBeNull();
});

test('usage OFF rejects usage records but keeps sessions', function () {
    setTrackingCategories(['usage' => false]);

    postSync(syncBody([
        'sessions' => [syncSession('s1')],
        'usage' => [syncUsage('m1', 's1')],
    ]))->assertOk()
        ->assertJsonPath('sync', ['accepted' => 1, 'created' => 1, 'updated' => 0, 'rejected' => 1])
        ->assertJsonPath('rejected_records.0.reason', 'category_disabled');

    expect(SessionUsage::count())->toBe(0)->and(ClaudeSession::count())->toBe(1);
});

test('a message repeated inside one batch is stored once with per-field max and counted as one update', function () {
    $body = syncBody([
        'sessions' => [syncSession('s1')],
        'usage' => [
            syncUsage('m1', 's1', ['output_tokens' => 100]),
            syncUsage('m1', 's1', ['output_tokens' => 866]),
        ],
    ]);

    postSync($body)->assertOk()
        ->assertJsonPath('sync', ['accepted' => 3, 'created' => 2, 'updated' => 1, 'rejected' => 0]);

    expect(SessionUsage::sole()->output_tokens)->toBe(866)
        ->and(ClaudeSession::sole()->output_tokens)->toBe(866);
});

test('a record element that is not an object makes the envelope invalid', function () {
    $body = syncBody();
    $body['usage'] = [[1, 2, 3]];

    postSync($body)->assertStatus(422)->assertJsonPath('error.code', 'invalid_payload');
});

test('usage for a session resolved from the database refreshes its project totals', function () {
    postSync(syncBody([
        'projects' => [syncProject('acme')],
        'sessions' => [syncSession('s1', ['project_key' => projectKey('acme')])],
        'usage' => [syncUsage('m1', 's1')],
    ]))->assertOk();

    postSync(syncBody(['usage' => [syncUsage('m2', 's1', ['output_tokens' => 1000])]]))
        ->assertOk()
        ->assertJsonPath('sync.created', 1);

    $project = Project::sole();
    expect($project->output_tokens)->toBe(1020)
        ->and($project->total_token_activity)->toBe((int) SessionUsage::sum('total_token_activity'));
});

test('the sync endpoint is rate limited per device', function () {
    $body = syncBody();

    for ($i = 0; $i < 60; $i++) {
        postSync(withNewBatchId($body))->assertOk();
    }

    postSync(withNewBatchId($body))->assertStatus(429);
});
