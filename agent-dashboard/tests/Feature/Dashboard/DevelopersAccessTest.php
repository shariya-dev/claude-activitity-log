<?php

use App\Models\Developer;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

test('guests are redirected to login from every developer route', function () {
    $developer = Developer::factory()->create();

    $this->get(route('developers.index'))->assertRedirect(route('login'));
    $this->get(route('developers.show', $developer))->assertRedirect(route('login'));
    $this->post(route('developers.store'), [])->assertRedirect(route('login'));
    $this->put(route('developers.update', $developer), [])->assertRedirect(route('login'));
    $this->post(route('developers.pairing-codes.store', $developer))->assertRedirect(route('login'));
});

test('viewers can open the developer list and detail pages', function () {
    $developer = Developer::factory()->create();
    $viewer = User::factory()->viewer()->create();

    $this->actingAs($viewer)->get(route('developers.index'))->assertOk();
    $this->actingAs($viewer)->get(route('developers.show', $developer))->assertOk();
});

test('viewers cannot create, update or issue pairing codes', function () {
    $developer = Developer::factory()->create(['name' => 'Original']);
    $viewer = User::factory()->viewer()->create();

    $this->actingAs($viewer)
        ->post(route('developers.store'), ['name' => 'New', 'email' => 'new@example.test'])
        ->assertForbidden();

    $this->actingAs($viewer)
        ->put(route('developers.update', $developer), [
            'name' => 'Changed', 'email' => $developer->email, 'team' => null, 'status' => 'inactive',
        ])
        ->assertForbidden();

    $this->actingAs($viewer)
        ->post(route('developers.pairing-codes.store', $developer))
        ->assertForbidden();

    expect(Developer::query()->count())->toBe(1)
        ->and($developer->fresh()->name)->toBe('Original')
        ->and($developer->pairingCodes()->count())->toBe(0);
});

test('inactive users are logged out instead of reaching developer pages', function () {
    $user = User::factory()->admin()->create(['is_active' => false]);

    $this->actingAs($user)->get(route('developers.index'))->assertRedirect(route('login'));
});

test('there is no delete route for developers', function () {
    $developer = Developer::factory()->create();

    $this->actingAs(User::factory()->admin()->create())
        ->delete('/developers/'.$developer->id)
        ->assertMethodNotAllowed();

    expect($developer->fresh())->not->toBeNull();
});
