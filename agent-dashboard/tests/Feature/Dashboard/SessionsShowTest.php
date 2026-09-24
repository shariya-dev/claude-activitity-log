<?php

use App\Enums\SessionStatus;
use App\Models\AuditLog;
use App\Models\ClaudeAccount;
use App\Models\ClaudeModel;
use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\Project;
use App\Models\SessionMessage;
use App\Models\SessionUsage;
use App\Models\TrackingSetting;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Testing\TestResponse;
use Inertia\Support\Header;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

const SESSIONS_SHOW_PROMPT = 'SANITIZED-PROMPT-MARKER fix the failing fixture';

/**
 * Perform an Inertia partial reload of the session page asking only for `messages`,
 * the same request the "Show prompts" button makes.
 */
function sessionsShowPromptReload(ClaudeSession $session): TestResponse
{
    $version = '';

    test()->get(route('sessions.show', $session))
        ->assertOk()
        ->assertInertia(function (Assert $page) use (&$version) {
            $version = (string) $page->toArray()['version'];
        });

    return test()->withHeaders([
        Header::INERTIA => 'true',
        Header::VERSION => $version,
        Header::PARTIAL_COMPONENT => 'Sessions/Show',
        Header::PARTIAL_ONLY => 'messages',
    ])->get(route('sessions.show', $session));
}

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);

    $this->developer = Developer::factory()->create(['name' => 'Alice Rahman', 'email' => 'alice@6am.test']);
    $this->device = Device::factory()->for($this->developer)->create(['hostname' => 'alice-mbp', 'device_uid' => 'dev-uid-alice']);
    $this->project = Project::factory()->create(['name' => 'Billing-Api']);
    $this->model = ClaudeModel::factory()->create(['name' => 'claude-opus-4-1']);
    $this->account = ClaudeAccount::factory()->for($this->developer)->create(['email' => 'work@6am.test']);

    $startedAt = CarbonImmutable::parse('2026-09-21 18:00:00', 'UTC');

    $this->session = ClaudeSession::factory()->for($this->device)->create([
        'developer_id' => $this->developer->id,
        'project_id' => $this->project->id,
        'claude_model_id' => $this->model->id,
        'claude_account_id' => $this->account->id,
        'source_session_id' => 'aaaa1111-0000-4000-8000-000000000001',
        'started_at' => $startedAt,
        'last_activity_at' => $startedAt->addSeconds(5400),
        'ended_at' => null,
        'duration_seconds' => 5400,
        'activity_count' => 12,
        'input_tokens' => 110,
        'output_tokens' => 220,
        'cache_creation_tokens' => 330,
        'cache_read_tokens' => 4400,
        'actual_consumed_tokens' => 660,
        'total_token_activity' => 5060,
        'status' => SessionStatus::Idle,
        'claude_code_version' => '2.1.274',
        'entrypoint' => 'cli',
        'git_branch' => 'feature/sessions',
    ]);

    $this->usageLate = SessionUsage::factory()->for($this->session, 'session')->create([
        'source_message_id' => 'msg_late', 'is_sidechain' => true, 'claude_model_id' => $this->model->id,
        'input_tokens' => 10, 'output_tokens' => 20, 'cache_creation_tokens' => 30, 'cache_read_tokens' => 400,
        'actual_consumed_tokens' => 60, 'total_token_activity' => 460,
        'recorded_at' => $startedAt->addMinutes(30),
    ]);
    $this->usageEarly = SessionUsage::factory()->for($this->session, 'session')->create([
        'source_message_id' => 'msg_early', 'is_sidechain' => false, 'claude_model_id' => null,
        'input_tokens' => 100, 'output_tokens' => 200, 'cache_creation_tokens' => 300, 'cache_read_tokens' => 4000,
        'actual_consumed_tokens' => 600, 'total_token_activity' => 4600,
        'recorded_at' => $startedAt->addMinutes(1),
    ]);

    $this->message = SessionMessage::factory()->for($this->session, 'session')->create([
        'source_message_id' => 'prompt-1', 'role' => 'user',
        'content' => SESSIONS_SHOW_PROMPT, 'recorded_at' => $startedAt->addMinutes(1),
    ]);
    SessionMessage::factory()->for($this->session, 'session')->create([
        'source_message_id' => 'prompt-0', 'role' => 'user',
        'content' => 'SANITIZED-EARLIER-PROMPT', 'recorded_at' => $startedAt,
    ]);

    $this->promptViewer = User::factory()->viewer()->create(['can_view_prompts' => true]);
    $this->plainViewer = User::factory()->viewer()->create(['can_view_prompts' => false]);
});

test('guests are redirected to login', function () {
    $this->get(route('sessions.show', $this->session))->assertRedirect(route('login'));
});

test('unknown sessions return 404', function () {
    $this->actingAs($this->plainViewer)->get('/sessions/999999')->assertNotFound();
});

test('shows all PRD §48 fields, token breakdown and the usage timeline', function () {
    $this->actingAs($this->plainViewer)
        ->get(route('sessions.show', $this->session))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Sessions/Show')
            ->where('session', [
                'id' => $this->session->id,
                'source_session_id' => 'aaaa1111-0000-4000-8000-000000000001',
                'status' => 'idle',
                'claude_code_version' => '2.1.274',
                'entrypoint' => 'cli',
                'git_branch' => 'feature/sessions',
                'started_at' => '2026-09-21T18:00:00Z',
                'last_activity_at' => '2026-09-21T19:30:00Z',
                'ended_at' => null,
                'duration_seconds' => 5400,
                'activity_count' => 12,
                'developer' => ['id' => $this->developer->id, 'name' => 'Alice Rahman'],
                'device' => ['id' => $this->device->id, 'device_uid' => 'dev-uid-alice', 'label' => 'alice-mbp'],
                'account' => ['id' => $this->account->id, 'label' => 'work@6am.test'],
                'project' => ['id' => $this->project->id, 'name' => 'Billing-Api'],
                'model' => ['id' => $this->model->id, 'name' => 'claude-opus-4-1'],
            ])
            ->where('totals', [
                'input_tokens' => 110,
                'output_tokens' => 220,
                'cache_creation_tokens' => 330,
                'cache_read_tokens' => 4400,
                'actual_consumed_tokens' => 660,
                'total_token_activity' => 5060,
                'message_count' => 2,
            ])
            ->has('timeline', 2)
            ->where('timeline.0', [
                'id' => $this->usageEarly->id,
                'recorded_at' => '2026-09-21T18:01:00Z',
                'model' => null,
                'is_sidechain' => false,
                'input_tokens' => 100,
                'output_tokens' => 200,
                'cache_creation_tokens' => 300,
                'cache_read_tokens' => 4000,
                'actual_consumed_tokens' => 600,
                'total_token_activity' => 4600,
            ])
            ->where('timeline.1.id', $this->usageLate->id)
            ->where('timeline.1.model', 'claude-opus-4-1')
            ->where('timeline.1.is_sidechain', true)
            ->where('timeline_limit', 1000)
            ->missing('messages'));
});

test('the end time is null when Claude Code recorded no explicit end, and set when it did', function () {
    $this->actingAs($this->plainViewer)
        ->get(route('sessions.show', $this->session))
        ->assertInertia(fn (Assert $page) => $page->where('session.ended_at', null));

    $this->session->update(['ended_at' => $this->session->last_activity_at, 'status' => SessionStatus::Ended]);

    $this->actingAs($this->plainViewer)
        ->get(route('sessions.show', $this->session))
        ->assertInertia(fn (Assert $page) => $page
            ->where('session.ended_at', '2026-09-21T19:30:00Z')
            ->where('session.status', 'ended'));
});

test('nullable relations are null and the device falls back to its uid', function () {
    $this->device->update(['hostname' => null]);
    $bare = ClaudeSession::factory()->for($this->device)->create(['developer_id' => $this->developer->id, 'git_branch' => null]);

    $this->actingAs($this->plainViewer)
        ->get(route('sessions.show', $bare))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('session.account', null)
            ->where('session.project', null)
            ->where('session.model', null)
            ->where('session.git_branch', null)
            ->where('session.device.label', 'dev-uid-alice')
            ->has('timeline', 0)
            ->where('prompts', ['available' => false, 'message_count' => 0, 'tracking_enabled' => false]));
});

test('a viewer without can_view_prompts never receives messages and a forced partial reload is forbidden', function () {
    $this->actingAs($this->plainViewer)
        ->get(route('sessions.show', $this->session))
        ->assertOk()
        ->assertDontSee(SESSIONS_SHOW_PROMPT)
        ->assertInertia(fn (Assert $page) => $page
            ->missing('messages')
            ->where('prompts', ['available' => false, 'message_count' => 0, 'tracking_enabled' => false]));

    sessionsShowPromptReload($this->session)
        ->assertForbidden()
        ->assertDontSee(SESSIONS_SHOW_PROMPT);

    expect(AuditLog::query()->where('action', 'prompt.viewed')->count())->toBe(0);
});

test('a user deactivated mid-session is signed out instead of loading prompts', function () {
    $user = User::factory()->viewer()->create(['can_view_prompts' => true]);

    $this->actingAs($user);
    $version = '';
    $this->get(route('sessions.show', $this->session))
        ->assertInertia(function (Assert $page) use (&$version) {
            $version = (string) $page->toArray()['version'];
        });

    $user->update(['is_active' => false]);

    $response = $this->withHeaders([
        Header::INERTIA => 'true',
        Header::VERSION => $version,
        Header::PARTIAL_COMPONENT => 'Sessions/Show',
        Header::PARTIAL_ONLY => 'messages',
    ])->get(route('sessions.show', $this->session));

    $response->assertRedirect();
    expect($response->getContent())->not->toContain(SESSIONS_SHOW_PROMPT);
    expect(AuditLog::query()->where('action', 'prompt.viewed')->count())->toBe(0);
});

test('the initial page load never contains message content, as HTML or as Inertia JSON', function () {
    $this->actingAs($this->promptViewer);

    $html = $this->get(route('sessions.show', $this->session))->assertOk();
    $html->assertDontSee(SESSIONS_SHOW_PROMPT)->assertDontSee('SANITIZED-EARLIER-PROMPT');

    $version = '';
    $html->assertInertia(function (Assert $page) use (&$version) {
        $version = (string) $page->toArray()['version'];
    });

    $json = $this->withHeaders([Header::INERTIA => 'true', Header::VERSION => $version])
        ->get(route('sessions.show', $this->session))
        ->assertOk()
        ->assertJsonPath('component', 'Sessions/Show')
        ->assertJsonMissingPath('props.messages');

    expect($json->getContent())
        ->not->toContain(SESSIONS_SHOW_PROMPT)
        ->not->toContain('SANITIZED-EARLIER-PROMPT');

    expect(AuditLog::query()->where('action', 'prompt.viewed')->count())->toBe(0);
});

test('a permitted user loads messages only on the partial reload, with one audit row per load', function () {
    TrackingSetting::current()->update(['prompt' => true]);

    $this->actingAs($this->promptViewer)
        ->get(route('sessions.show', $this->session))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->missing('messages')
            ->where('prompts', ['available' => true, 'message_count' => 2, 'tracking_enabled' => true])
            ->reloadOnly('messages', fn (Assert $reload) => $reload
                ->has('messages', 2)
                ->where('messages.0.role', 'user')
                ->where('messages.0.content', 'SANITIZED-EARLIER-PROMPT')
                ->where('messages.0.recorded_at', '2026-09-21T18:00:00Z')
                ->where('messages.1', [
                    'id' => $this->message->id,
                    'role' => 'user',
                    'recorded_at' => '2026-09-21T18:01:00Z',
                    'content' => SESSIONS_SHOW_PROMPT,
                ])
                ->missing('session')
                ->missing('timeline')));

    $logs = AuditLog::query()->where('action', 'prompt.viewed')->get();

    expect($logs)->toHaveCount(1)
        ->and($logs[0]->user_id)->toBe($this->promptViewer->id)
        ->and($logs[0]->subject_type)->toBe($this->session->getMorphClass())
        ->and($logs[0]->subject_id)->toBe($this->session->id)
        ->and($logs[0]->metadata)->toBe(['count' => 2]);

    sessionsShowPromptReload($this->session)->assertOk();

    expect(AuditLog::query()->where('action', 'prompt.viewed')->count())->toBe(2);
});

test('prompt content never reaches audit metadata or logs', function () {
    Log::spy();

    $this->actingAs($this->promptViewer);
    sessionsShowPromptReload($this->session)->assertOk()->assertSee(SESSIONS_SHOW_PROMPT);

    $log = AuditLog::query()->where('action', 'prompt.viewed')->sole();

    expect(json_encode($log->getAttributes()))->not->toContain('SANITIZED');

    Log::shouldNotHaveReceived('info');
    Log::shouldNotHaveReceived('debug');
    Log::shouldNotHaveReceived('warning');
    Log::shouldNotHaveReceived('error');
});

test('with prompt tracking off, retained messages stay viewable with permission and the page says tracking is disabled', function () {
    TrackingSetting::current()->update(['prompt' => false]);

    $this->actingAs($this->promptViewer)
        ->get(route('sessions.show', $this->session))
        ->assertInertia(fn (Assert $page) => $page
            ->where('prompts', ['available' => true, 'message_count' => 2, 'tracking_enabled' => false])
            ->reloadOnly('messages', fn (Assert $reload) => $reload->has('messages', 2)));

    expect(AuditLog::query()->where('action', 'prompt.viewed')->count())->toBe(1);
});

test('a permitted user sees no prompts section for a session without messages', function () {
    $bare = ClaudeSession::factory()->for($this->device)->create(['developer_id' => $this->developer->id]);

    $this->actingAs($this->promptViewer)
        ->get(route('sessions.show', $bare))
        ->assertInertia(fn (Assert $page) => $page
            ->where('prompts.available', false)
            ->where('prompts.message_count', 0)
            ->missing('messages'));
});

test('every partial reload shape that resolves messages is authorized and audited', function (array $filterHeaders, bool $permitted, int $status) {
    $this->actingAs($permitted ? $this->promptViewer : $this->plainViewer);

    $version = '';
    $this->get(route('sessions.show', $this->session))
        ->assertInertia(function (Assert $page) use (&$version) {
            $version = (string) $page->toArray()['version'];
        });

    $response = $this->withHeaders([
        Header::INERTIA => 'true',
        Header::VERSION => $version,
        Header::PARTIAL_COMPONENT => 'Sessions/Show',
        ...$filterHeaders,
    ])->get(route('sessions.show', $this->session));

    $response->assertStatus($status);

    if ($permitted) {
        expect($response->getContent())->toContain(SESSIONS_SHOW_PROMPT);
    } else {
        expect($response->getContent())->not->toContain(SESSIONS_SHOW_PROMPT);
    }

    expect(AuditLog::query()->where('action', 'prompt.viewed')->count())->toBe($permitted ? 1 : 0);
})->with([
    'except header, not permitted' => [[Header::PARTIAL_EXCEPT => 'timeline'], false, 403],
    'except header, permitted' => [[Header::PARTIAL_EXCEPT => 'timeline'], true, 200],
    'component only, not permitted' => [[], false, 403],
    'component only, permitted' => [[], true, 200],
]);
