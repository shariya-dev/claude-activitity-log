<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;

uses(RefreshDatabase::class);

dataset('gate matrix', [
    // [role, is_active, can_view_prompts, gate, expected]
    'admin viewMonitoring' => ['admin', true, false, 'viewMonitoring', true],
    'admin manageAgents' => ['admin', true, false, 'manageAgents', true],
    'admin configureTracking' => ['admin', true, false, 'configureTracking', true],
    'admin viewAuditLogs' => ['admin', true, false, 'viewAuditLogs', true],
    'admin manageUsers' => ['admin', true, false, 'manageUsers', true],
    'admin viewPrompts without permission' => ['admin', true, false, 'viewPrompts', false],
    'admin viewPrompts with permission' => ['admin', true, true, 'viewPrompts', true],

    'viewer viewMonitoring' => ['viewer', true, false, 'viewMonitoring', true],
    'viewer manageAgents' => ['viewer', true, false, 'manageAgents', false],
    'viewer configureTracking' => ['viewer', true, false, 'configureTracking', false],
    'viewer viewAuditLogs' => ['viewer', true, false, 'viewAuditLogs', false],
    'viewer manageUsers' => ['viewer', true, false, 'manageUsers', false],
    'viewer viewPrompts without permission' => ['viewer', true, false, 'viewPrompts', false],
    'viewer viewPrompts with permission' => ['viewer', true, true, 'viewPrompts', true],

    'inactive admin viewMonitoring' => ['admin', false, true, 'viewMonitoring', false],
    'inactive admin manageAgents' => ['admin', false, true, 'manageAgents', false],
    'inactive admin configureTracking' => ['admin', false, true, 'configureTracking', false],
    'inactive admin viewAuditLogs' => ['admin', false, true, 'viewAuditLogs', false],
    'inactive admin manageUsers' => ['admin', false, true, 'manageUsers', false],
    'inactive admin viewPrompts' => ['admin', false, true, 'viewPrompts', false],
    'inactive viewer viewMonitoring' => ['viewer', false, true, 'viewMonitoring', false],
    'inactive viewer manageAgents' => ['viewer', false, true, 'manageAgents', false],
    'inactive viewer configureTracking' => ['viewer', false, true, 'configureTracking', false],
    'inactive viewer viewAuditLogs' => ['viewer', false, true, 'viewAuditLogs', false],
    'inactive viewer manageUsers' => ['viewer', false, true, 'manageUsers', false],
    'inactive viewer viewPrompts' => ['viewer', false, true, 'viewPrompts', false],
]);

test('gates follow the role matrix', function (string $role, bool $active, bool $canViewPrompts, string $gate, bool $expected) {
    $user = User::factory()->create([
        'role' => $role,
        'is_active' => $active,
        'can_view_prompts' => $canViewPrompts,
    ]);

    expect(Gate::forUser($user)->allows($gate))->toBe($expected);
})->with('gate matrix');

test('guests are denied every monitor gate', function (string $gate) {
    expect(Gate::allows($gate))->toBeFalse();
})->with(['viewMonitoring', 'manageAgents', 'configureTracking', 'viewAuditLogs', 'manageUsers', 'viewPrompts']);
