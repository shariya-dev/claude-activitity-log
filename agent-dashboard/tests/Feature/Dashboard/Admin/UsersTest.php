<?php

use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->withoutVite();
    $this->admin = User::factory()->admin()->create(['name' => 'Ada Admin']);
});

test('admins see the user list without secrets', function () {
    $viewer = User::factory()->viewer()->create();

    $this->actingAs($this->admin)
        ->get(route('users.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Admin/Users')
            ->has('users', 2)
            ->where('users.0.id', $this->admin->id)
            ->where('users.0.is_self', true)
            ->where('users.1.id', $viewer->id)
            ->where('users.1.is_self', false)
            ->missing('users.0.password')
            ->missing('users.0.two_factor_secret')
            ->has('roles', 2));
});

test('an admin creates a user with a temporary password', function () {
    $this->actingAs($this->admin)
        ->post(route('users.store'), [
            'name' => 'Val Viewer',
            'email' => 'val@example.test',
            'role' => 'viewer',
            'can_view_prompts' => true,
            'password' => 'Temporary-Pass-123',
            'password_confirmation' => 'Temporary-Pass-123',
        ])
        ->assertRedirect(route('users.index'))
        ->assertSessionHasNoErrors();

    $user = User::query()->where('email', 'val@example.test')->sole();
    expect($user->role)->toBe(UserRole::Viewer)
        ->and($user->can_view_prompts)->toBeTrue()
        ->and($user->is_active)->toBeTrue()
        ->and($user->email_verified_at)->not->toBeNull()
        ->and(Hash::check('Temporary-Pass-123', $user->password))->toBeTrue();

    $audit = AuditLog::query()->where('action', 'user.created')->sole();
    expect($audit->user_id)->toBe($this->admin->id)
        ->and($audit->subject_id)->toBe($user->id)
        ->and($audit->metadata)->toEqual(['role' => 'viewer', 'can_view_prompts' => true])
        ->and(json_encode($audit->metadata))->not->toContain('Temporary');
});

test('store validates input', function (array $overrides, string $field) {
    User::factory()->create(['email' => 'taken@example.test']);

    $this->actingAs($this->admin)
        ->post(route('users.store'), array_merge([
            'name' => 'New User',
            'email' => 'new@example.test',
            'role' => 'viewer',
            'can_view_prompts' => false,
            'password' => 'Temporary-Pass-123',
            'password_confirmation' => 'Temporary-Pass-123',
        ], $overrides))
        ->assertSessionHasErrors($field);
})->with([
    'duplicate email' => [['email' => 'taken@example.test'], 'email'],
    'bad role' => [['role' => 'owner'], 'role'],
    'unconfirmed password' => [['password_confirmation' => 'other'], 'password'],
    'missing name' => [['name' => ''], 'name'],
]);

test('role changes are audited', function () {
    $viewer = User::factory()->viewer()->create();

    $this->actingAs($this->admin)
        ->patch(route('users.update', $viewer), ['role' => 'admin'])
        ->assertRedirect(route('users.index'))
        ->assertSessionHasNoErrors();

    expect($viewer->fresh()->role)->toBe(UserRole::Admin);
    expect(AuditLog::query()->where('action', 'user.role_changed')->sole()->metadata)
        ->toEqual(['from' => 'viewer', 'to' => 'admin']);
});

test('prompt permission changes are audited', function () {
    $viewer = User::factory()->viewer()->create();

    $this->actingAs($this->admin)
        ->patch(route('users.update', $viewer), ['can_view_prompts' => true])
        ->assertSessionHasNoErrors();

    expect($viewer->fresh()->can_view_prompts)->toBeTrue();
    expect(AuditLog::query()->where('action', 'user.prompt_permission_changed')->sole()->metadata)
        ->toEqual(['from' => false, 'to' => true]);
});

test('deactivation is audited and keeps the user row', function () {
    $viewer = User::factory()->viewer()->create();

    $this->actingAs($this->admin)
        ->patch(route('users.update', $viewer), ['is_active' => false])
        ->assertSessionHasNoErrors();

    expect($viewer->fresh()->is_active)->toBeFalse()
        ->and(AuditLog::query()->where('action', 'user.deactivated')->sole()->subject_id)->toBe($viewer->id);

    $this->actingAs($this->admin)
        ->patch(route('users.update', $viewer), ['is_active' => true])
        ->assertSessionHasNoErrors();

    expect($viewer->fresh()->is_active)->toBeTrue()
        ->and(AuditLog::query()->where('action', 'user.reactivated')->count())->toBe(1);
});

test('an unchanged value writes no audit', function () {
    $viewer = User::factory()->viewer()->create();

    $this->actingAs($this->admin)
        ->patch(route('users.update', $viewer), ['role' => 'viewer'])
        ->assertSessionHasNoErrors();

    expect(AuditLog::query()->count())->toBe(0);
});

test('admins cannot demote or deactivate themselves', function (array $payload, string $field) {
    User::factory()->admin()->create();

    $this->actingAs($this->admin)
        ->patch(route('users.update', $this->admin), $payload)
        ->assertSessionHasErrors($field);

    expect($this->admin->fresh()->role)->toBe(UserRole::Admin)
        ->and($this->admin->fresh()->is_active)->toBeTrue()
        ->and(AuditLog::query()->count())->toBe(0);
})->with([
    'demote' => [['role' => 'viewer'], 'role'],
    'deactivate' => [['is_active' => false], 'is_active'],
]);

test('the last active admin cannot be demoted or deactivated by anyone', function (array $payload, string $field) {
    $lastAdmin = User::factory()->admin()->create();
    User::factory()->admin()->create(['is_active' => false]);

    // The acting admin was demoted in the database after authenticating (a concurrent change),
    // so $lastAdmin is the only active admin left.
    User::query()->whereKey($this->admin->id)->update(['role' => 'viewer']);

    $this->actingAs($this->admin)
        ->patch(route('users.update', $lastAdmin), $payload)
        ->assertSessionHasErrors($field);

    expect($lastAdmin->fresh()->role)->toBe(UserRole::Admin)
        ->and($lastAdmin->fresh()->is_active)->toBeTrue()
        ->and(AuditLog::query()->count())->toBe(0);
})->with([
    'demote' => [['role' => 'viewer'], 'role'],
    'deactivate' => [['is_active' => false], 'is_active'],
]);

test('another admin can be demoted while one active admin remains', function () {
    $other = User::factory()->admin()->create();

    $this->actingAs($this->admin)
        ->patch(route('users.update', $other), ['role' => 'viewer'])
        ->assertSessionHasNoErrors();

    expect($other->fresh()->role)->toBe(UserRole::Viewer);
});

test('an inactive admin does not count towards the last-admin check', function () {
    $inactive = User::factory()->admin()->create(['is_active' => false]);

    $this->actingAs($this->admin)
        ->patch(route('users.update', $this->admin), ['role' => 'viewer'])
        ->assertSessionHasErrors('role');

    expect($inactive->fresh()->is_active)->toBeFalse();
});

test('update rejects unknown roles and empty payloads', function () {
    $viewer = User::factory()->viewer()->create();

    $this->actingAs($this->admin)
        ->patch(route('users.update', $viewer), ['role' => 'root'])
        ->assertSessionHasErrors('role');

    $this->actingAs($this->admin)
        ->patch(route('users.update', $viewer), [])
        ->assertSessionHasErrors();
});
