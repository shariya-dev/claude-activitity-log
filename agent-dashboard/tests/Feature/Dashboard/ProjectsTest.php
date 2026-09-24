<?php

use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\Project;
use App\Models\ProjectLocation;
use App\Models\UsageDailyRollup;
use App\Models\User;
use App\Queries\Analytics\ActivityStats;
use App\Queries\Analytics\DateRange;
use App\Queries\Analytics\TokenAnalytics;
use App\Queries\Analytics\UsageFilters;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

function projectsRollup(string $date, Device $device, Project $project, int $scale): UsageDailyRollup
{
    return UsageDailyRollup::factory()->create([
        'date' => $date,
        'device_id' => $device->id,
        'developer_id' => $device->developer_id,
        'project_id' => $project->id,
        'input_tokens' => 10 * $scale,
        'output_tokens' => 20 * $scale,
        'cache_creation_tokens' => 30 * $scale,
        'cache_read_tokens' => 400 * $scale,
        'message_count' => $scale,
    ]);
}

function projectsSession(Device $device, Project $project, string $startedAtUtc): ClaudeSession
{
    $startedAt = CarbonImmutable::parse($startedAtUtc, 'UTC');

    return ClaudeSession::factory()->create([
        'device_id' => $device->id,
        'developer_id' => $device->developer_id,
        'project_id' => $project->id,
        'started_at' => $startedAt,
        'last_activity_at' => $startedAt->addMinutes(30),
        'duration_seconds' => 1800,
    ]);
}

function projectsLocation(Project $project, Device $device, string $path): ProjectLocation
{
    return ProjectLocation::factory()->create([
        'project_id' => $project->id,
        'device_id' => $device->id,
        'path' => $path,
        'path_hash' => hash('sha256', $path),
        'last_seen_at' => CarbonImmutable::parse('2026-09-22 03:00:00', 'UTC'),
    ]);
}

/**
 * @return array<string, int>
 */
function projectsTokenColumns(array $totals): array
{
    return [
        'total_token_activity' => $totals['total_token_activity'],
        'actual_consumed_tokens' => $totals['actual_consumed_tokens'],
        'cache_read_tokens' => $totals['cache_read_tokens'],
    ];
}

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-22 10:00:00', 'Asia/Dhaka'));

    $this->alice = Developer::factory()->create(['name' => 'Alice', 'email' => 'alice@6am.test']);
    $this->bob = Developer::factory()->create(['name' => 'Bob', 'email' => 'bob@6am.test']);
    $this->aliceMac = Device::factory()->create(['developer_id' => $this->alice->id, 'hostname' => 'alice-mbp', 'platform' => 'macos']);
    $this->bobPc = Device::factory()->create(['developer_id' => $this->bob->id, 'hostname' => 'bob-pc', 'platform' => 'windows']);
    $this->bobLaptop = Device::factory()->create(['developer_id' => $this->bob->id, 'hostname' => 'bob-laptop', 'platform' => 'linux']);

    $this->api = Project::factory()->create(['name' => 'Payments-Api', 'git_remote' => 'git@github.com:6am/payments-api.git']);
    $this->scratch = Project::factory()->create(['name' => 'Scratch-Pad', 'git_remote' => null]);
    $this->other = Project::factory()->create(['name' => 'Other-CMS', 'git_remote' => null]);

    projectsLocation($this->api, $this->aliceMac, '/Users/alice/code/payments-api');
    projectsLocation($this->api, $this->bobPc, 'C:\\code\\payments-api');
    projectsLocation($this->scratch, $this->aliceMac, '/Users/alice/tmp/scratch-pad');
    projectsLocation($this->other, $this->bobLaptop, '/home/bob/other-cms');
    projectsLocation($this->api, $this->bobLaptop, '/home/bob/payments-api');

    // This week (2026-09-21 … 2026-09-27, Asia/Dhaka).
    projectsSession($this->aliceMac, $this->api, '2026-09-21 06:00:00');
    projectsSession($this->bobPc, $this->api, '2026-09-22 02:00:00');
    projectsSession($this->bobPc, $this->api, '2026-09-22 03:00:00');
    projectsSession($this->aliceMac, $this->scratch, '2026-09-22 01:00:00');
    projectsSession($this->bobLaptop, $this->other, '2026-09-21 04:00:00');
    // Before this week.
    projectsSession($this->bobLaptop, $this->api, '2026-09-10 04:00:00');

    projectsRollup('2026-09-21', $this->aliceMac, $this->api, 1);
    projectsRollup('2026-09-22', $this->bobPc, $this->api, 2);
    projectsRollup('2026-09-10', $this->bobLaptop, $this->api, 5);
    projectsRollup('2026-09-22', $this->aliceMac, $this->scratch, 4);
    projectsRollup('2026-09-21', $this->bobLaptop, $this->other, 7);

    $this->week = DateRange::preset('week');
});

test('guests are redirected to login', function () {
    $this->get(route('projects.index'))->assertRedirect(route('login'));
    $this->get(route('projects.show', $this->api))->assertRedirect(route('login'));
});

test('users without monitoring access get 403', function () {
    Gate::define('viewMonitoring', fn (): bool => false);
    $user = User::factory()->viewer()->create();

    $this->actingAs($user)->get(route('projects.index'))->assertForbidden();
    $this->actingAs($user)->get(route('projects.show', $this->api))->assertForbidden();
});

test('index lists projects with range totals matching the analytics layer', function () {
    $response = $this->actingAs(User::factory()->viewer()->create())->get(route('projects.index'));

    $expected = fn (Project $project): array => [
        ...projectsTokenColumns(app(TokenAnalytics::class)->totals(new UsageFilters($this->week, projectId: $project->id))),
        'sessions_count' => app(ActivityStats::class)->sessionsCount(new UsageFilters($this->week, projectId: $project->id)),
    ];

    $response->assertOk()->assertInertia(fn (Assert $page) => $page
        ->component('Projects/Index')
        ->where('range.preset', 'week')
        ->where('filters.search', '')
        ->where('filters.developer', null)
        ->has('filterOptions.developer', 2)
        ->where('projects.total', 3)
        ->has('projects.data', 3)
        ->where('projects.data', function ($rows) use ($expected) {
            $byName = collect($rows)->keyBy('name');

            foreach ([$this->api, $this->scratch, $this->other] as $project) {
                $row = $byName->get($project->name);
                $want = $expected($project);

                foreach ($want as $key => $value) {
                    expect($row[$key])->toBe($value, "{$project->name}.{$key}");
                }
            }

            $api = $byName->get('Payments-Api');
            expect($api['id'])->toBe($this->api->id)
                ->and($api['git_remote'])->toBe('git@github.com:6am/payments-api.git')
                ->and($api['developers_count'])->toBe(2)
                ->and($api['devices_count'])->toBe(3)
                ->and($api['sessions_count'])->toBe(3)
                ->and($api['total_token_activity'])->toBe(3 * 460)
                ->and($byName->get('Scratch-Pad')['developers_count'])->toBe(1)
                ->and($byName->get('Scratch-Pad')['git_remote'])->toBeNull();

            return true;
        }));
});

test('index sorts by a whitelisted column and falls back on invalid input', function () {
    $user = User::factory()->viewer()->create();

    $this->actingAs($user)->get(route('projects.index', ['sort' => 'total_token_activity', 'dir' => 'desc']))
        ->assertInertia(fn (Assert $page) => $page
            ->where('sort', 'total_token_activity')
            ->where('direction', 'desc')
            ->where('projects.data.0.name', 'Other-CMS')
            ->where('projects.data.1.name', 'Scratch-Pad')
            ->where('projects.data.2.name', 'Payments-Api'));

    $this->actingAs($user)->get(route('projects.index', ['sort' => 'name', 'dir' => 'asc']))
        ->assertInertia(fn (Assert $page) => $page->where('projects.data.0.name', 'Other-CMS')->where('projects.data.2.name', 'Scratch-Pad'));

    $this->actingAs($user)->get(route('projects.index', ['sort' => 'p.name; drop table projects', 'dir' => 'sideways']))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('sort', 'last_activity_at')->where('direction', 'desc'));
});

test('index search matches project name and path', function () {
    $user = User::factory()->viewer()->create();

    $this->actingAs($user)->get(route('projects.index', ['search' => 'payments']))
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.search', 'payments')
            ->has('projects.data', 1)
            ->where('projects.data.0.name', 'Payments-Api'));

    $this->actingAs($user)->get(route('projects.index', ['search' => 'tmp/scratch']))
        ->assertInertia(fn (Assert $page) => $page->has('projects.data', 1)->where('projects.data.0.name', 'Scratch-Pad'));

    $this->actingAs($user)->get(route('projects.index', ['search' => '100%_']))
        ->assertInertia(fn (Assert $page) => $page->has('projects.data', 0));
});

test('index developer filter keeps that developer projects and scopes range metrics to them', function () {
    $response = $this->actingAs(User::factory()->viewer()->create())
        ->get(route('projects.index', ['developer' => $this->alice->id]));

    $response->assertInertia(fn (Assert $page) => $page
        ->where('filters.developer', $this->alice->id)
        ->has('projects.data', 2)
        ->where('projects.data', function ($rows) {
            $api = collect($rows)->firstWhere('name', 'Payments-Api');
            $filters = new UsageFilters($this->week, developerId: $this->alice->id, projectId: $this->api->id);

            expect(collect($rows)->pluck('name')->sort()->values()->all())->toBe(['Payments-Api', 'Scratch-Pad'])
                ->and($api['sessions_count'])->toBe(1)
                ->and($api['total_token_activity'])->toBe(app(TokenAnalytics::class)->totals($filters)['total_token_activity'])
                ->and($api['developers_count'])->toBe(2);

            return true;
        }));
});

test('index paginates and runs a constant number of queries', function () {
    $user = User::factory()->viewer()->create();
    $this->actingAs($user)->get(route('projects.index'))->assertOk();

    $countQueries = function () use ($user): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->actingAs($user)->get(route('projects.index'))->assertOk();
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $count;
    };

    $baseline = $countQueries();

    foreach (range(1, 30) as $i) {
        $project = Project::factory()->create();
        projectsSession($this->aliceMac, $project, '2026-09-22 01:00:00');
        projectsRollup('2026-09-22', $this->aliceMac, $project, 1);
    }

    expect($countQueries())->toBe($baseline);

    $this->actingAs($user)->get(route('projects.index', ['page' => 2]))
        ->assertInertia(fn (Assert $page) => $page
            ->where('projects.total', 33)
            ->where('projects.current_page', 2)
            ->has('projects.data', 8));
});

test('show renders project detail with paths, developers, devices and H07 totals', function () {
    $filters = new UsageFilters($this->week, projectId: $this->api->id);
    $analytics = app(TokenAnalytics::class);

    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('projects.show', $this->api))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Projects/Show')
            ->where('project.id', $this->api->id)
            ->where('project.name', 'Payments-Api')
            ->where('project.git_remote', 'git@github.com:6am/payments-api.git')
            ->where('range.preset', 'week')
            ->where('totals', $analytics->totals($filters))
            ->where('trend', $analytics->trend($filters))
            ->where('sessionsCount', 3)
            ->has('paths', 3)
            ->where('paths', function ($paths) {
                $byPath = collect($paths)->keyBy('path');
                $mac = $byPath->get('/Users/alice/code/payments-api');

                expect($byPath->keys()->sort()->values()->all())->toBe(['/Users/alice/code/payments-api', '/home/bob/payments-api', 'C:\\code\\payments-api'])
                    ->and($mac['device'])->toBe('alice-mbp')
                    ->and($mac['device_uid'])->toBe($this->aliceMac->device_uid)
                    ->and($mac['developer'])->toBe('Alice')
                    ->and($mac['last_seen_at'])->toBe('2026-09-22T03:00:00Z');

                return true;
            })
            ->has('recentSessions', 3)
            ->has('devices', 3)
            ->where('devices', function ($devices) {
                $byUid = collect($devices)->keyBy('device_uid');

                expect($byUid->get($this->bobPc->device_uid)['sessions_count'])->toBe(2)
                    ->and($byUid->get($this->bobPc->device_uid)['total_token_activity'])->toBe(2 * 460)
                    ->and($byUid->get($this->bobPc->device_uid)['developer'])->toBe('Bob')
                    ->and($byUid->get($this->bobLaptop->device_uid)['sessions_count'])->toBe(0)
                    ->and($byUid->get($this->bobLaptop->device_uid)['total_token_activity'])->toBe(0);

                return true;
            }));
});

test('show lists multiple developers on one project separately', function () {
    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('projects.show', $this->api))
        ->assertInertia(fn (Assert $page) => $page
            ->has('developers', 2)
            ->where('developers.0.id', $this->bob->id)
            ->where('developers.0.name', 'Bob')
            ->where('developers.0.email', 'bob@6am.test')
            ->where('developers.0.sessions_count', 2)
            ->where('developers.0.total_token_activity', 2 * 460)
            ->where('developers.0.actual_consumed_tokens', 2 * 60)
            ->where('developers.0.cache_read_tokens', 2 * 400)
            ->where('developers.1.id', $this->alice->id)
            ->where('developers.1.sessions_count', 1)
            ->where('developers.1.total_token_activity', 460));
});

test('a path-only project without a git remote renders', function () {
    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('projects.show', $this->scratch))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Projects/Show')
            ->where('project.git_remote', null)
            ->has('paths', 1)
            ->where('paths.0.path', '/Users/alice/tmp/scratch-pad')
            ->has('developers', 1)
            ->where('totals.total_token_activity', 4 * 460));
});

test('show respects the date range', function () {
    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('projects.show', ['project' => $this->api, 'range' => 'custom', 'from' => '2026-09-01', 'to' => '2026-09-15']))
        ->assertInertia(fn (Assert $page) => $page
            ->where('range.preset', 'custom')
            ->where('sessionsCount', 1)
            ->where('totals.total_token_activity', 5 * 460)
            ->where('developers.0.id', $this->bob->id)
            ->where('developers.0.total_token_activity', 5 * 460)
            ->where('developers.1.total_token_activity', 0));
});

test('range session counts use org-timezone day boundaries', function () {
    // 2026-09-21 00:30 in Asia/Dhaka: inside this week.
    projectsSession($this->aliceMac, $this->scratch, '2026-09-20 18:30:00');
    // 2026-09-20 23:59 in Asia/Dhaka: the Sunday before this week.
    projectsSession($this->aliceMac, $this->scratch, '2026-09-20 17:59:00');
    $user = User::factory()->viewer()->create();

    $this->actingAs($user)->get(route('projects.show', $this->scratch))
        ->assertInertia(fn (Assert $page) => $page
            ->where('sessionsCount', 2)
            ->where('developers.0.sessions_count', 2)
            ->where('devices.0.sessions_count', 2));

    $this->actingAs($user)->get(route('projects.index', ['search' => 'Scratch']))
        ->assertInertia(fn (Assert $page) => $page->where('projects.data.0.sessions_count', 2));
});

test('show returns 404 for an unknown project', function () {
    $this->actingAs(User::factory()->viewer()->create())
        ->get('/projects/999999')
        ->assertNotFound();
});
