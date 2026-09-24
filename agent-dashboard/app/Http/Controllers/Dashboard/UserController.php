<?php

namespace App\Http\Controllers\Dashboard;

use App\Enums\UserRole;
use App\Http\Controllers\Controller;
use App\Http\Requests\Dashboard\StoreUserRequest;
use App\Http\Requests\Dashboard\UpdateUserRequest;
use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Dashboard user management (admin / viewer roles, prompt permission, deactivation). Users are never deleted.
 */
class UserController extends Controller
{
    public function index(Request $request): Response
    {
        $currentId = $request->user()?->id;

        return Inertia::render('Admin/Users', [
            'users' => User::query()
                ->orderBy('name')
                ->orderBy('id')
                ->get(['id', 'name', 'email', 'role', 'can_view_prompts', 'is_active', 'created_at'])
                ->sortBy(fn (User $user): int => $user->id === $currentId ? 0 : 1)
                ->values()
                ->map(fn (User $user): array => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role->value,
                    'can_view_prompts' => $user->can_view_prompts,
                    'is_active' => $user->is_active,
                    'created_at' => $user->created_at?->toIso8601String(),
                    'is_self' => $user->id === $currentId,
                ])
                ->all(),
            'roles' => [
                ['value' => UserRole::Admin->value, 'label' => 'Admin'],
                ['value' => UserRole::Viewer->value, 'label' => 'Monitoring viewer'],
            ],
        ]);
    }

    public function store(StoreUserRequest $request): RedirectResponse
    {
        /** @var User $by */
        $by = $request->user();

        DB::transaction(function () use ($request, $by): void {
            $user = new User([
                'name' => $request->string('name')->value(),
                'email' => $request->string('email')->value(),
                'password' => $request->string('password')->value(),
                'role' => $request->enum('role', UserRole::class),
                'can_view_prompts' => $request->boolean('can_view_prompts'),
                'is_active' => true,
            ]);
            // Admin-created accounts are vouched for; the temporary password is shared out of band.
            $user->forceFill(['email_verified_at' => now()])->save();

            AuditLog::record('user.created', $user, [
                'role' => $user->role->value,
                'can_view_prompts' => $user->can_view_prompts,
            ], $by);
        });

        Inertia::flash('toast', ['type' => 'success', 'message' => __('User created.')]);

        return to_route('users.index');
    }

    public function update(UpdateUserRequest $request, User $user): RedirectResponse
    {
        /** @var User $by */
        $by = $request->user();
        $changes = $request->changes();

        DB::transaction(function () use ($user, $by, $changes): void {
            $user = User::query()->lockForUpdate()->findOrFail($user->id);
            $removesAdmin = $user->isAdmin() && $user->is_active && (
                (isset($changes['role']) && $changes['role'] !== UserRole::Admin)
                || (isset($changes['is_active']) && ! $changes['is_active'])
            );

            if ($removesAdmin && $this->otherActiveAdmins($user) === 0) {
                throw ValidationException::withMessages([
                    isset($changes['role']) ? 'role' : 'is_active' => 'At least one active admin must remain.',
                ]);
            }

            $before = [
                'role' => $user->role->value,
                'can_view_prompts' => $user->can_view_prompts,
                'is_active' => $user->is_active,
            ];

            $user->fill($changes)->save();

            if ($before['role'] !== $user->role->value) {
                AuditLog::record('user.role_changed', $user, ['from' => $before['role'], 'to' => $user->role->value], $by);
            }

            if ($before['can_view_prompts'] !== $user->can_view_prompts) {
                AuditLog::record('user.prompt_permission_changed', $user, [
                    'from' => $before['can_view_prompts'],
                    'to' => $user->can_view_prompts,
                ], $by);
            }

            if ($before['is_active'] !== $user->is_active) {
                AuditLog::record($user->is_active ? 'user.reactivated' : 'user.deactivated', $user, [], $by);
            }
        });

        Inertia::flash('toast', ['type' => 'success', 'message' => __('User updated.')]);

        return to_route('users.index');
    }

    /**
     * Active admins other than $user, locked so two concurrent demotions can't both pass the check.
     */
    private function otherActiveAdmins(User $user): int
    {
        return User::query()
            ->where('role', UserRole::Admin)
            ->where('is_active', true)
            ->whereKeyNot($user->id)
            ->lockForUpdate()
            ->count();
    }
}
