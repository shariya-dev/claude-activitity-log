<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

test('inactive users are logged out of dashboard routes', function () {
    $user = User::factory()->admin()->create(['is_active' => false]);

    $this->actingAs($user)
        ->get(route('developers.index'))
        ->assertRedirect(route('login'))
        ->assertSessionHas('status', 'Your account has been deactivated.');

    $this->assertGuest();
});

test('inactive users are logged out of the overview', function () {
    $this->actingAs(User::factory()->create(['is_active' => false]))
        ->get(route('dashboard'))
        ->assertRedirect(route('login'));

    $this->assertGuest();
});

test('active users pass through', function () {
    $this->actingAs(User::factory()->create())
        ->get(route('dashboard'))
        ->assertOk();

    $this->assertAuthenticated();
});

test('the active middleware is part of the dashboard route group', function () {
    $route = app('router')->getRoutes()->getByName('developers.index');

    expect($route->gatherMiddleware())->toContain('active');
});
