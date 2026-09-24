<?php

use App\Models\User;
use App\Queries\Analytics\ActivityStats;
use App\Queries\Analytics\AgentHealth;
use App\Queries\Analytics\DateRange;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\Granularity;
use App\Queries\Analytics\TokenAnalytics;
use App\Queries\Analytics\UsageFilters;
use Database\Seeders\MonitorDemoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

const OVERVIEW_PROPS = [
    'range', 'kpis', 'tokens', 'trend', 'topDevelopers', 'topProjects', 'topModels',
    'recentSessions', 'agentHealth', 'problemAgents',
];

/**
 * @return array<string, mixed>
 */
function overviewProps(User $user, array $query = []): array
{
    $page = test()->actingAs($user)->get(route('dashboard', $query))
        ->assertOk()
        ->viewData('page');

    return $page['props'];
}

/**
 * @return list<string>
 */
function overviewKeys(mixed $value): array
{
    if (! is_array($value)) {
        return [];
    }

    $keys = [];

    foreach ($value as $key => $child) {
        if (is_string($key)) {
            $keys[] = $key;
        }

        array_push($keys, ...overviewKeys($child));
    }

    return $keys;
}

test('guests are redirected to the login page', function () {
    $this->get(route('dashboard'))->assertRedirect(route('login'));
});

test('a viewer gets the overview with every prop, defaulting to today', function () {
    $this->actingAs(User::factory()->viewer()->create())
        ->get(route('dashboard'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Dashboard')
            ->hasAll(OVERVIEW_PROPS)
            ->where('range.preset', 'today')
            ->hasAll(['kpis.totalDevelopers', 'kpis.activeDevices', 'kpis.sessionsInRange', 'kpis.activeProjects'])
            ->has('trend', 14)
        );
});

test('an admin can view the overview', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->get(route('dashboard'))
        ->assertOk();
});

test('every preset is accepted', function (string $preset) {
    $props = overviewProps(User::factory()->viewer()->create(), ['range' => $preset]);

    expect($props['range'])->toBe(DateRange::preset($preset)->toArray());
})->with(['today', 'yesterday', 'week', 'month', 'year']);

test('a valid custom range is accepted', function () {
    $props = overviewProps(User::factory()->viewer()->create(), [
        'range' => 'custom', 'from' => '2026-08-01', 'to' => '2026-08-31',
    ]);

    expect($props['range'])->toBe(['preset' => 'custom', 'from' => '2026-08-01', 'to' => '2026-08-31'])
        ->and($props['trend'])->toHaveCount(31);
});

test('an invalid custom range redirects back with validation errors', function (array $query, string $field) {
    $this->actingAs(User::factory()->viewer()->create())
        ->from(route('dashboard'))
        ->get(route('dashboard', ['range' => 'custom', ...$query]))
        ->assertRedirect(route('dashboard'))
        ->assertSessionHasErrors($field);
})->with([
    'end before start' => [['from' => '2026-09-10', 'to' => '2026-09-01'], 'to'],
    'missing from' => [['to' => '2026-09-01'], 'from'],
    'malformed date' => [['from' => '09/01/2026', 'to' => '2026-09-10'], 'from'],
    'longer than three years' => [['from' => '2020-01-01', 'to' => '2026-01-01'], 'to'],
]);

test('an unknown preset falls back to today', function () {
    $props = overviewProps(User::factory()->viewer()->create(), ['range' => 'bogus']);

    expect($props['range'])->toBe(DateRange::preset('today')->toArray());
});

test('inactive users cannot view the overview', function () {
    $this->actingAs(User::factory()->viewer()->create(['is_active' => false]))
        ->get(route('dashboard'))
        ->assertRedirect(route('login'));

    $this->assertGuest();
});

test('today and yesterday show the 14 days ending on the selected day', function (string $preset) {
    $range = DateRange::preset($preset);
    $props = overviewProps(User::factory()->viewer()->create(), ['range' => $preset]);

    expect($props['trend'])->toHaveCount(14)
        ->and($props['trend'][13]['period'])->toBe($range->startDate())
        ->and($props['trend'][0]['period'])->toBe($range->start->subDays(13)->format('Y-m-d'));
})->with(['today', 'yesterday']);

test('overview figures equal the analytics query results for the seeded data', function (string $preset) {
    $this->seed(MonitorDemoSeeder::class);

    $range = DateRange::preset($preset);
    $filters = new UsageFilters($range);
    $tokens = app(TokenAnalytics::class);
    $activity = app(ActivityStats::class);
    $health = app(AgentHealth::class);

    $props = overviewProps(User::factory()->viewer()->create(), ['range' => $preset]);

    expect($props['tokens'])->toBe($tokens->totals($filters))
        ->and($props['tokens']['total_token_activity'])->toBeGreaterThan(0)
        ->and($props['kpis'])->toBe([
            'totalDevelopers' => $activity->totalDevelopers(),
            'activeDevices' => $activity->activeDevices($range),
            'sessionsInRange' => $activity->sessionsCount($filters),
            'activeProjects' => $activity->activeProjects($range),
        ])
        ->and($props['trend'])->toBe($tokens->trend($filters, Granularity::auto($range)))
        ->and($props['topDevelopers'])->toBe($tokens->breakdown($filters, Dimension::Developer, 5))
        ->and($props['topProjects'])->toBe($tokens->breakdown($filters, Dimension::Project, 5))
        ->and($props['topModels'])->toBe($tokens->breakdown($filters, Dimension::Model, 5))
        ->and($props['topDevelopers'])->not->toBeEmpty()
        ->and($props['recentSessions'])->toBe($activity->recentSessions($filters, 10))
        ->and($props['recentSessions'])->not->toBeEmpty()
        ->and($props['agentHealth'])->toBe($health->summary())
        ->and($props['problemAgents'])->toBe($health->problemAgents(10))
        ->and($props['problemAgents'])->not->toBeEmpty();
})->with(['week', 'month']);

test('single-day figures equal the analytics query results, with the trend over the last 14 days', function (string $preset) {
    $this->seed(MonitorDemoSeeder::class);

    $day = DateRange::preset($preset);
    $filters = new UsageFilters($day);
    $window = new DateRange($day->start->subDays(13), $day->end, $preset);
    $tokens = app(TokenAnalytics::class);
    $activity = app(ActivityStats::class);

    $props = overviewProps(User::factory()->viewer()->create(), ['range' => $preset]);

    expect($props['trend'])->toBe($tokens->trend(new UsageFilters($window), Granularity::Day))
        ->and($props['tokens'])->toBe($tokens->totals($filters))
        ->and($props['kpis']['sessionsInRange'])->toBe($activity->sessionsCount($filters))
        ->and($props['kpis']['activeDevices'])->toBe($activity->activeDevices($day))
        ->and($props['topDevelopers'])->toBe($tokens->breakdown($filters, Dimension::Developer, 5))
        ->and($props['recentSessions'])->toBe($activity->recentSessions($filters, 10));
})->with(['today', 'yesterday']);

test('breakdowns are limited to five rows and recent sessions to ten', function () {
    $this->seed(MonitorDemoSeeder::class);

    $filters = new UsageFilters(DateRange::preset('year'));
    $tokens = app(TokenAnalytics::class);
    $props = overviewProps(User::factory()->viewer()->create(), ['range' => 'year']);

    expect($tokens->breakdown($filters, Dimension::Developer, 10))->toHaveCount(6)
        ->and($props['topDevelopers'])->toHaveCount(5)
        ->and($tokens->breakdown($filters, Dimension::Project, 10))->not->toHaveCount(5)
        ->and($props['topProjects'])->toHaveCount(5)
        ->and($props['recentSessions'])->toHaveCount(10)
        ->and($props['problemAgents'])->toBe(app(AgentHealth::class)->problemAgents(10));
});

test('the overview runs a bounded number of queries', function () {
    $this->seed(MonitorDemoSeeder::class);
    $user = User::factory()->viewer()->create();

    DB::enableQueryLog();
    $this->actingAs($user)->get(route('dashboard', ['range' => 'year']))->assertOk();
    $queries = count(DB::getQueryLog());
    DB::disableQueryLog();

    expect($queries)->toBeLessThanOrEqual(25);
});

test('the prop payload carries no token, secret or password keys', function () {
    $this->seed(MonitorDemoSeeder::class);

    $keys = overviewKeys(overviewProps(User::factory()->viewer()->create(), ['range' => 'year']));
    $leaks = array_values(array_filter(
        array_unique($keys),
        fn (string $key): bool => ! in_array($key, TokenAnalytics::METRICS, true)
            && preg_match('/token$|secret|password/i', $key) === 1,
    ));

    expect($keys)->not->toBeEmpty()
        ->and($leaks)->toBe([]);
});
