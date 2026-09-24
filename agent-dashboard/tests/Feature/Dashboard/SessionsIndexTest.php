<?php

use App\Enums\SessionStatus;
use App\Models\ClaudeAccount;
use App\Models\ClaudeModel;
use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\Project;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

/**
 * @param  array<string, mixed>  $attributes
 */
function sessionsIndexSession(Device $device, string $startedAtUtc, int $durationSeconds, array $attributes = []): ClaudeSession
{
    $startedAt = CarbonImmutable::parse($startedAtUtc, 'UTC');

    return ClaudeSession::factory()->for($device)->create([
        'developer_id' => $device->developer_id,
        'started_at' => $startedAt,
        'last_activity_at' => $startedAt->addSeconds($durationSeconds),
        'duration_seconds' => $durationSeconds,
        ...$attributes,
    ]);
}

/**
 * @return list<int>
 */
function sessionsIndexIds(Assert $page): array
{
    return array_map(fn (array $row): int => $row['id'], $page->toArray()['props']['sessions']['data']);
}

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-22 10:00:00', 'Asia/Dhaka'));

    $this->viewer = User::factory()->viewer()->create();

    $this->alice = Developer::factory()->create(['name' => 'Alice Rahman', 'email' => 'alice@6am.test']);
    $this->bob = Developer::factory()->create(['name' => 'Bob Karim', 'email' => 'bob@6am.test']);
    $this->aliceMac = Device::factory()->for($this->alice)->create(['hostname' => 'alice-mbp']);
    $this->bobWin = Device::factory()->for($this->bob)->create(['hostname' => 'bob-win']);
    $this->api = Project::factory()->create(['name' => 'Billing-Api']);
    $this->cms = Project::factory()->create(['name' => 'Content-CMS']);
    $this->opus = ClaudeModel::factory()->create(['name' => 'claude-opus-4-1']);
    $this->sonnet = ClaudeModel::factory()->create(['name' => 'claude-sonnet-4-5']);
    $this->work = ClaudeAccount::factory()->for($this->alice)->create();

    // All three started this week (org tz); s4 started last week.
    $this->s1 = sessionsIndexSession($this->aliceMac, '2026-09-21 18:00:00', 5400, [
        'source_session_id' => 'aaaa1111-0000-4000-8000-000000000001', 'project_id' => $this->api->id,
        'claude_model_id' => $this->opus->id, 'claude_account_id' => $this->work->id,
        'actual_consumed_tokens' => 300, 'total_token_activity' => 9000, 'status' => SessionStatus::Active,
    ]);
    $this->s2 = sessionsIndexSession($this->aliceMac, '2026-09-22 02:00:00', 600, [
        'source_session_id' => 'bbbb2222-0000-4000-8000-000000000002', 'project_id' => $this->cms->id,
        'claude_model_id' => $this->sonnet->id,
        'actual_consumed_tokens' => 100, 'total_token_activity' => 20000, 'status' => SessionStatus::Idle,
    ]);
    $this->s3 = sessionsIndexSession($this->bobWin, '2026-09-21 01:00:00', 60, [
        'source_session_id' => 'cccc3333-0000-4000-8000-000000000003', 'project_id' => $this->api->id,
        'actual_consumed_tokens' => 50, 'total_token_activity' => 500, 'status' => SessionStatus::Ended,
    ]);
    $this->s4 = sessionsIndexSession($this->bobWin, '2026-09-10 05:00:00', 3600, [
        'source_session_id' => 'dddd4444-0000-4000-8000-000000000004',
    ]);
});

afterEach(function () {
    Carbon::setTestNow();
});

test('guests are redirected to login', function () {
    $this->get(route('sessions.index'))->assertRedirect(route('login'));
});

test('lists sessions started in the default range with the PRD §47 columns and status', function () {
    $this->actingAs($this->viewer)
        ->get(route('sessions.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Sessions/Index')
            ->where('sort', 'started_at')
            ->where('direction', 'desc')
            ->where('range.preset', 'week')
            ->where('sessions.total', 3)
            ->where('sessions.data.0', [
                'id' => $this->s2->id,
                'source_session_id' => 'bbbb2222-0000-4000-8000-000000000002',
                'developer' => 'Alice Rahman',
                'project' => 'Content-CMS',
                'model' => 'claude-sonnet-4-5',
                'device' => 'alice-mbp',
                'started_at' => '2026-09-22T02:00:00Z',
                'last_activity_at' => '2026-09-22T02:10:00Z',
                'duration_seconds' => 600,
                'actual_consumed_tokens' => 100,
                'total_token_activity' => 20000,
                'status' => 'idle',
            ])
            ->where('sessions.data.1.status', 'active')
            ->where('sessions.data.2.status', 'ended')
            ->has('options.developer', 2)
            ->has('options.device', 2)
            ->has('options.account', 1)
            ->has('options.project', 2)
            ->has('options.model', 2)
            ->where('filters', [
                'developer' => null, 'device' => null, 'account' => null, 'project' => null, 'model' => null, 'search' => '',
            ]));
});

test('filters by developer, device, account, project and model', function (string $param, string $modelProp, array $expected) {
    $ids = [];
    $value = $this->{$modelProp}->id;

    $this->actingAs($this->viewer)
        ->get(route('sessions.index', [$param => $value]))
        ->assertOk()
        ->assertInertia(function (Assert $page) use (&$ids, $param, $value) {
            $page->where("filters.{$param}", $value);
            $ids = sessionsIndexIds($page);
        });

    expect($ids)->toEqualCanonicalizing(array_map(fn (string $s): int => $this->{$s}->id, $expected));
})->with([
    'developer' => ['developer', 'bob', ['s3']],
    'device' => ['device', 'aliceMac', ['s1', 's2']],
    'account' => ['account', 'work', ['s1']],
    'project' => ['project', 'api', ['s1', 's3']],
    'model' => ['model', 'opus', ['s1']],
]);

test('filters by date range', function () {
    $ids = [];

    $this->actingAs($this->viewer)
        ->get(route('sessions.index', ['range' => 'custom', 'from' => '2026-09-10', 'to' => '2026-09-10']))
        ->assertOk()
        ->assertInertia(function (Assert $page) use (&$ids) {
            $page->where('range', ['preset' => 'custom', 'from' => '2026-09-10', 'to' => '2026-09-10']);
            $ids = sessionsIndexIds($page);
        });

    expect($ids)->toBe([$this->s4->id]);
});

test('searches by session id prefix, project and developer', function (string $search, array $expected) {
    $ids = [];

    $this->actingAs($this->viewer)
        ->get(route('sessions.index', ['search' => $search]))
        ->assertOk()
        ->assertInertia(function (Assert $page) use (&$ids, $search) {
            $page->where('filters.search', trim($search));
            $ids = sessionsIndexIds($page);
        });

    expect($ids)->toEqualCanonicalizing(array_map(fn (string $s): int => $this->{$s}->id, $expected));
})->with([
    'session id prefix' => ['bbbb2222', ['s2']],
    'project' => ['billing', ['s1', 's3']],
    'developer name' => ['  Bob ', ['s3']],
    'no match' => ['zzz-nothing', []],
]);

test('sorts by each whitelisted column in both directions', function (string $sort, array $desc) {
    $expected = array_map(fn (string $s): int => $this->{$s}->id, $desc);

    foreach (['desc' => $expected, 'asc' => array_reverse($expected)] as $dir => $order) {
        $ids = [];

        $this->actingAs($this->viewer)
            ->get(route('sessions.index', ['sort' => $sort, 'dir' => $dir]))
            ->assertOk()
            ->assertInertia(function (Assert $page) use (&$ids, $sort, $dir) {
                $page->where('sort', $sort)->where('direction', $dir);
                $ids = sessionsIndexIds($page);
            });

        expect($ids)->toBe($order);
    }
})->with([
    'start' => ['started_at', ['s2', 's1', 's3']],
    'last activity' => ['last_activity_at', ['s2', 's1', 's3']],
    'duration' => ['duration_seconds', ['s1', 's2', 's3']],
    'token activity' => ['total_token_activity', ['s2', 's1', 's3']],
    'actual consumed' => ['actual_consumed_tokens', ['s1', 's2', 's3']],
]);

test('non-whitelisted sort keys and directions fall back to the defaults', function (string $sort, string $dir) {
    $ids = [];

    $this->actingAs($this->viewer)
        ->get(route('sessions.index', ['sort' => $sort, 'dir' => $dir]))
        ->assertOk()
        ->assertInertia(function (Assert $page) use (&$ids) {
            $page->where('sort', 'started_at')->where('direction', 'desc');
            $ids = sessionsIndexIds($page);
        });

    expect($ids)->toBe([$this->s2->id, $this->s1->id, $this->s3->id]);
})->with([
    'sql injection' => ['started_at; drop table users', 'desc'],
    'SessionSearch-only key' => ['developer', 'desc'],
    'raw column' => ['s.id', 'desc'],
    'bad direction' => ['started_at', 'sideways'],
]);

test('filters and sort survive pagination links', function () {
    ClaudeSession::factory()->count(30)->for($this->aliceMac)->create([
        'developer_id' => $this->alice->id,
        'project_id' => $this->api->id,
        'started_at' => CarbonImmutable::parse('2026-09-22 01:00:00', 'UTC'),
        'last_activity_at' => CarbonImmutable::parse('2026-09-22 01:05:00', 'UTC'),
    ]);

    $this->actingAs($this->viewer)
        ->get(route('sessions.index', ['project' => $this->api->id, 'sort' => 'duration_seconds', 'dir' => 'asc', 'search' => 'Billing']))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('sessions.total', 32)
            ->where('sessions.last_page', 2)
            ->where('sessions.next_page_url', fn (string $url) => str_contains($url, 'project='.$this->api->id)
                && str_contains($url, 'sort=duration_seconds')
                && str_contains($url, 'dir=asc')
                && str_contains($url, 'search=Billing')
                && str_contains($url, 'page=2')));
});

test('the list never exposes message content', function () {
    $this->s1->messages()->create([
        'source_message_id' => 'msg-list-1', 'role' => 'user',
        'content' => 'SANITIZED-LIST-PROMPT-MARKER', 'recorded_at' => $this->s1->started_at,
    ]);

    $this->actingAs(User::factory()->admin()->create(['can_view_prompts' => true]))
        ->get(route('sessions.index'))
        ->assertOk()
        ->assertDontSee('SANITIZED-LIST-PROMPT-MARKER');
});
