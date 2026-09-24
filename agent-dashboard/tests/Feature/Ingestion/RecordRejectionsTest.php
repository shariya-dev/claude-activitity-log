<?php

use App\Models\ClaudeSession;
use App\Models\SessionUsage;
use App\Models\SyncBatch;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;

require_once __DIR__.'/helpers.php';

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-09-23T12:00:00Z'));
    setTrackingCategories(['prompt' => true, 'git' => true]);
    ingestionDevice();
});

test('an invalid example record is rejected inside a 200 and the rest is stored', function (string $file, string $reason) {
    $body = ingestionExample($file);

    $response = postSync($body)
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('sync.rejected', 1)
        ->assertJsonPath('sync.accepted', syncRecordTotal($body) - 1)
        ->assertJsonPath('rejected_records', [[
            'type' => 'usage',
            'source_id' => $body['usage'][0]['source_message_id'],
            'reason' => $reason,
        ]]);

    expect(SessionUsage::count())->toBe(count($body['usage']) - 1)
        ->and(SessionUsage::where('source_message_id', $body['usage'][0]['source_message_id'])->exists())->toBeFalse()
        ->and(ClaudeSession::count())->toBe(count($body['sessions']));

    $batch = SyncBatch::sole();
    expect($batch->rejected)->toBe(1)
        ->and($batch->rejections)->toEqual($response->json('rejected_records'));
})->with([
    'negative token' => ['invalid/negative-token.json', 'negative_token_value'],
    'offset timestamp' => ['invalid/bad-timestamp.json', 'invalid_timestamp'],
]);

test('a record timestamp more than one day in the future is rejected as future_timestamp', function () {
    $body = syncBody([
        'sessions' => [syncSession('future-session')],
        'usage' => [
            syncUsage('msg_too_far', 'future-session', ['recorded_at' => syncIso('2026-09-24T12:00:01Z')]),
            syncUsage('msg_within_a_day', 'future-session', ['recorded_at' => syncIso('2026-09-24T11:59:00Z')]),
        ],
    ]);

    postSync($body)
        ->assertOk()
        ->assertJsonPath('sync.accepted', 2)
        ->assertJsonPath('sync.rejected', 1)
        ->assertJsonPath('rejected_records', [
            ['type' => 'usage', 'source_id' => 'msg_too_far', 'reason' => 'future_timestamp'],
        ]);

    expect(SessionUsage::pluck('source_message_id')->all())->toBe(['msg_within_a_day']);
});

test('unresolvable references are rejected and dependants cascade to unknown_session', function () {
    $body = syncBody([
        'sessions' => [
            syncSession('good-session'),
            syncSession('orphan-session', ['project_key' => projectKey('nowhere')]),
        ],
        'usage' => [
            syncUsage('msg_good', 'good-session'),
            syncUsage('msg_ghost', 'ghost-session'),
            syncUsage('msg_orphan', 'orphan-session'),
        ],
    ]);

    $response = postSync($body)
        ->assertOk()
        ->assertJsonPath('sync.accepted', 2)
        ->assertJsonPath('sync.rejected', 3);

    expect($response->json('sync.accepted') + $response->json('sync.rejected'))->toBe(syncRecordTotal($body));

    $rejected = collect($response->json('rejected_records'))->keyBy('source_id');
    expect($rejected->all())->toEqual([
        'orphan-session' => ['type' => 'session', 'source_id' => 'orphan-session', 'reason' => 'unknown_project'],
        'msg_ghost' => ['type' => 'usage', 'source_id' => 'msg_ghost', 'reason' => 'unknown_session'],
        'msg_orphan' => ['type' => 'usage', 'source_id' => 'msg_orphan', 'reason' => 'unknown_session'],
    ]);

    expect(ClaudeSession::pluck('source_session_id')->all())->toBe(['good-session'])
        ->and(SessionUsage::pluck('source_message_id')->all())->toBe(['msg_good']);

    expect(collect(SyncBatch::sole()->rejections)->pluck('reason')->sort()->values()->all())
        ->toBe(['unknown_project', 'unknown_session', 'unknown_session']);
});

test('an unknown account reference is rejected as unknown_account', function () {
    postSync(syncBody([
        'sessions' => [syncSession('acct-session', ['account_key' => accountKey('nobody')])],
    ]))
        ->assertOk()
        ->assertJsonPath('sync.rejected', 1)
        ->assertJsonPath('rejected_records', [
            ['type' => 'session', 'source_id' => 'acct-session', 'reason' => 'unknown_account'],
        ]);
});

test('references missing from the batch are resolved from the database', function () {
    postSync(syncBody([
        'accounts' => [syncAccount('dana')],
        'projects' => [syncProject('acme')],
        'sessions' => [syncSession('stored-session', ['project_key' => projectKey('acme'), 'account_key' => accountKey('dana')])],
    ]))->assertOk()->assertJsonPath('sync.rejected', 0);

    postSync(syncBody([
        'sessions' => [syncSession('second-session', ['project_key' => projectKey('acme'), 'account_key' => accountKey('dana')])],
        'usage' => [syncUsage('msg_on_stored', 'stored-session')],
    ]))
        ->assertOk()
        ->assertJsonPath('sync.accepted', 2)
        ->assertJsonPath('sync.rejected', 0);

    $usage = SessionUsage::sole();
    $session = ClaudeSession::where('source_session_id', 'stored-session')->sole();

    expect($usage->claude_session_id)->toBe($session->id)
        ->and($usage->project_id)->toBe($session->project_id)
        ->and($usage->claude_account_id)->toBe($session->claude_account_id)
        ->and($session->project_id)->not->toBeNull();
});
