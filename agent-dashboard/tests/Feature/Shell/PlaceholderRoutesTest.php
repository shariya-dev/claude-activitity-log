<?php

use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\Project;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

$monitoringRoutes = [
    'developers.index' => ['developers.index', [], '/developers'],
    'developers.show' => ['developers.show', ['developer' => 1], '/developers/1'],
    'devices.index' => ['devices.index', [], '/devices'],
    'devices.show' => ['devices.show', ['device' => 'dev-uid-1'], '/devices/dev-uid-1'],
    'projects.index' => ['projects.index', [], '/projects'],
    'projects.show' => ['projects.show', ['project' => 1], '/projects/1'],
    'sessions.index' => ['sessions.index', [], '/sessions'],
    'sessions.show' => ['sessions.show', ['session' => 1], '/sessions/1'],
    'analytics.tokens' => ['analytics.tokens', [], '/analytics/tokens'],
    'sync.index' => ['sync.index', [], '/sync'],
];

$adminRoutes = [
    'tracking-settings.edit' => ['tracking-settings.edit', [], '/admin/tracking'],
    'audit-logs.index' => ['audit-logs.index', [], '/admin/audit-logs'],
    'users.index' => ['users.index', [], '/admin/users'],
];

/*
 * Pages opened by a signed-in user. Show routes get a real record from a
 * factory; the closure runs inside the test, once the database is fresh.
 */
$monitoringPages = [
    'developers.index' => ['developers.index', fn () => [], 'Developers/Index'],
    'developers.show' => ['developers.show', fn () => ['developer' => Developer::factory()->create()], 'Developers/Show'],
    'devices.index' => ['devices.index', fn () => [], 'Devices/Index'],
    'devices.show' => ['devices.show', fn () => ['device' => Device::factory()->create()], 'Devices/Show'],
    'projects.index' => ['projects.index', fn () => [], 'Projects/Index'],
    'projects.show' => ['projects.show', fn () => ['project' => Project::factory()->create()], 'Projects/Show'],
    'sessions.index' => ['sessions.index', fn () => [], 'Sessions/Index'],
    'sessions.show' => ['sessions.show', fn () => ['session' => ClaudeSession::factory()->create()], 'Sessions/Show'],
    'analytics.tokens' => ['analytics.tokens', fn () => [], 'Analytics/Tokens'],
    'sync.index' => ['sync.index', fn () => [], 'Sync/Index'],
];

$adminPages = [
    'tracking-settings.edit' => ['tracking-settings.edit', fn () => [], 'Admin/TrackingSettings'],
    'audit-logs.index' => ['audit-logs.index', fn () => [], 'Admin/AuditLogs'],
    'users.index' => ['users.index', fn () => [], 'Admin/Users'],
];

dataset('all routes', [...$monitoringRoutes, ...$adminRoutes]);
dataset('monitoring pages', $monitoringPages);
dataset('admin pages', $adminPages);
dataset('all pages', [...$monitoringPages, ...$adminPages]);

test('route names resolve to the agreed paths', function (string $name, array $params, string $path) {
    expect(route($name, $params, false))->toBe($path);
})->with('all routes');

test('guests are redirected to login', function (string $name, array $params) {
    $this->get(route($name, $params))->assertRedirect(route('login'));
})->with('all routes');

test('viewers can open monitoring pages', function (string $name, Closure $params, string $component) {
    $this->actingAs(User::factory()->viewer()->create())
        ->get(route($name, $params()))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component($component));
})->with('monitoring pages');

test('viewers are forbidden from admin pages', function (string $name, Closure $params) {
    $this->actingAs(User::factory()->viewer()->create())
        ->get(route($name, $params()))
        ->assertForbidden();
})->with('admin pages');

test('admins can open every page', function (string $name, Closure $params, string $component) {
    $this->actingAs(User::factory()->admin()->create())
        ->get(route($name, $params()))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component($component));
})->with('all pages');
