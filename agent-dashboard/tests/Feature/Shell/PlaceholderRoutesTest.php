<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

$monitoringPages = [
    'developers.index' => ['developers.index', [], '/developers', 'Developers'],
    'developers.show' => ['developers.show', ['developer' => 1], '/developers/1', 'Developer'],
    'devices.index' => ['devices.index', [], '/devices', 'Devices'],
    'devices.show' => ['devices.show', ['device' => 'dev-uid-1'], '/devices/dev-uid-1', 'Device'],
    'projects.index' => ['projects.index', [], '/projects', 'Projects'],
    'projects.show' => ['projects.show', ['project' => 1], '/projects/1', 'Project'],
    'sessions.index' => ['sessions.index', [], '/sessions', 'Sessions'],
    'sessions.show' => ['sessions.show', ['session' => 1], '/sessions/1', 'Session'],
    'analytics.tokens' => ['analytics.tokens', [], '/analytics/tokens', 'Token Analytics'],
    'sync.index' => ['sync.index', [], '/sync', 'Sync Monitor'],
];

$adminPages = [
    'tracking-settings.edit' => ['tracking-settings.edit', [], '/admin/tracking', 'Tracking Settings'],
    'audit-logs.index' => ['audit-logs.index', [], '/admin/audit-logs', 'Audit Log'],
    'users.index' => ['users.index', [], '/admin/users', 'Users'],
];

dataset('monitoring pages', $monitoringPages);
dataset('admin pages', $adminPages);
dataset('all pages', [...$monitoringPages, ...$adminPages]);

test('route names resolve to the agreed paths', function (string $name, array $params, string $path) {
    expect(route($name, $params, false))->toBe($path);
})->with('all pages');

test('guests are redirected to login', function (string $name, array $params) {
    $this->get(route($name, $params))->assertRedirect(route('login'));
})->with('all pages');

test('viewers can open monitoring placeholders', function (string $name, array $params, string $path, string $title) {
    $this->actingAs(User::factory()->viewer()->create())
        ->get(route($name, $params))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Placeholder')->where('title', $title));
})->with('monitoring pages');

test('viewers are forbidden from admin placeholders', function (string $name, array $params) {
    $this->actingAs(User::factory()->viewer()->create())
        ->get(route($name, $params))
        ->assertForbidden();
})->with('admin pages');

test('admins can open every placeholder', function (string $name, array $params, string $path, string $title) {
    $this->actingAs(User::factory()->admin()->create())
        ->get(route($name, $params))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Placeholder')->where('title', $title));
})->with('all pages');
