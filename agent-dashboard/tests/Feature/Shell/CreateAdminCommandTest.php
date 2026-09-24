<?php

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;

uses(RefreshDatabase::class);

test('monitor:create-admin creates an active verified admin', function () {
    $this->artisan('monitor:create-admin', ['email' => 'ops@6am.test', '--name' => 'Ops Admin'])
        ->expectsQuestion('Password', 'correct-horse-battery')
        ->expectsQuestion('Confirm password', 'correct-horse-battery')
        ->assertSuccessful();

    $user = User::where('email', 'ops@6am.test')->sole();

    expect($user->role)->toBe(UserRole::Admin)
        ->and($user->is_active)->toBeTrue()
        ->and($user->name)->toBe('Ops Admin')
        ->and($user->email_verified_at)->not->toBeNull()
        ->and(Hash::check('correct-horse-battery', $user->password))->toBeTrue();
});

test('name defaults to the email local part', function () {
    $this->artisan('monitor:create-admin', ['email' => 'lead@6am.test'])
        ->expectsQuestion('Password', 'correct-horse-battery')
        ->expectsQuestion('Confirm password', 'correct-horse-battery')
        ->assertSuccessful();

    expect(User::where('email', 'lead@6am.test')->value('name'))->toBe('lead');
});

test('mismatched passwords fail without creating a user', function () {
    $this->artisan('monitor:create-admin', ['email' => 'ops@6am.test'])
        ->expectsQuestion('Password', 'correct-horse-battery')
        ->expectsQuestion('Confirm password', 'something-else-entirely')
        ->assertFailed();

    expect(User::where('email', 'ops@6am.test')->exists())->toBeFalse();
});

test('short passwords are rejected', function () {
    $this->artisan('monitor:create-admin', ['email' => 'ops@6am.test'])
        ->expectsQuestion('Password', 'short')
        ->expectsQuestion('Confirm password', 'short')
        ->assertFailed();

    expect(User::count())->toBe(0);
});

test('an existing email is rejected', function () {
    User::factory()->create(['email' => 'ops@6am.test']);

    $this->artisan('monitor:create-admin', ['email' => 'ops@6am.test'])
        ->assertFailed();

    expect(User::count())->toBe(1);
});

test('an invalid email is rejected', function () {
    $this->artisan('monitor:create-admin', ['email' => 'not-an-email'])
        ->assertFailed();

    expect(User::count())->toBe(0);
});
