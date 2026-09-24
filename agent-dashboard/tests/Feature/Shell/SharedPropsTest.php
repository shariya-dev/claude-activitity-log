<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

$sharedProps = function (User $user): array {
    $props = [];

    test()->actingAs($user)
        ->get(route('developers.index'))
        ->assertOk()
        ->assertInertia(function (Assert $page) use (&$props) {
            $props = $page->toArray()['props'];
        });

    return $props;
};

test('auth.user exposes only the whitelisted fields', function () use ($sharedProps) {
    $user = User::factory()->admin()->create();

    $props = $sharedProps($user);

    expect(array_keys($props['auth']['user']))->toEqualCanonicalizing(['id', 'name', 'email', 'role', 'email_verified_at'])
        ->and($props['auth']['user']['id'])->toBe($user->id)
        ->and($props['auth']['user']['role'])->toBe('admin');
});

test('can reflects the admin abilities', function () use ($sharedProps) {
    $props = $sharedProps(User::factory()->admin()->create(['can_view_prompts' => true]));

    expect($props['can'])->toBe([
        'manageAgents' => true,
        'configureTracking' => true,
        'viewAuditLogs' => true,
        'manageUsers' => true,
        'viewPrompts' => true,
    ]);
});

test('can reflects the viewer abilities', function () use ($sharedProps) {
    $props = $sharedProps(User::factory()->viewer()->create());

    expect($props['can'])->toBe([
        'manageAgents' => false,
        'configureTracking' => false,
        'viewAuditLogs' => false,
        'manageUsers' => false,
        'viewPrompts' => false,
    ]);
});

test('monitor timezone and flash keys are shared', function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);

    $this->actingAs(User::factory()->create())
        ->withSession(['success' => 'Saved.', 'pairing_code' => 'ABCD-1234'])
        ->get(route('developers.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('monitor.timezone', 'Asia/Dhaka')
            ->where('flash.success', 'Saved.')
            ->where('flash.error', null)
            ->where('flash.pairing_code', 'ABCD-1234'));
});

test('guests get null can on public pages', function () {
    $this->get(route('home'))
        ->assertInertia(fn (Assert $page) => $page->where('auth.user', null)->where('can', null));
});

test('shared props contain no token or secret fields', function () use ($sharedProps) {
    $user = User::factory()->admin()->withTwoFactor()->create();

    $json = json_encode($sharedProps($user));

    expect($json)->not->toContain('password')
        ->not->toContain('remember_token')
        ->not->toContain('two_factor')
        ->not->toContain('secret')
        ->not->toContain('token_hash')
        ->not->toContain('api_token')
        ->not->toContain('can_view_prompts')
        ->not->toContain('is_active');
});
