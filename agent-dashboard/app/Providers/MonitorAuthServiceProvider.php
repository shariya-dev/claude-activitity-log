<?php

namespace App\Providers;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

/**
 * Dashboard authorization (PRD §53). Every gate denies inactive users;
 * admin-only gates are checked here, never in the UI alone.
 */
class MonitorAuthServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Gate::define('viewMonitoring', fn (User $user): bool => $user->is_active
            && in_array($user->role, [UserRole::Admin, UserRole::Viewer], true));

        foreach (['manageAgents', 'configureTracking', 'viewAuditLogs', 'manageUsers'] as $ability) {
            Gate::define($ability, fn (User $user): bool => $user->is_active && $user->isAdmin());
        }

        Gate::define('viewPrompts', fn (User $user): bool => $user->is_active
            && $user->can_view_prompts
            && in_array($user->role, [UserRole::Admin, UserRole::Viewer], true));
    }
}
