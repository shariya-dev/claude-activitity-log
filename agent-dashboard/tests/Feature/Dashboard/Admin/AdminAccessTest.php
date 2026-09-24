<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

dataset('admin routes', [
    'tracking edit' => ['get', fn () => route('tracking-settings.edit')],
    'tracking update' => ['put', fn () => route('tracking-settings.update')],
    'users index' => ['get', fn () => route('users.index')],
    'users store' => ['post', fn () => route('users.store')],
    'users update' => ['patch', fn () => route('users.update', User::factory()->create())],
    'audit logs index' => ['get', fn () => route('audit-logs.index')],
]);

test('viewers are forbidden from every admin route', function (string $method, string $url) {
    $this->actingAs(User::factory()->viewer()->create())
        ->{$method}($url)
        ->assertForbidden();
})->with('admin routes');

test('guests are redirected to login from every admin route', function (string $method, string $url) {
    $this->{$method}($url)->assertRedirect(route('login'));
})->with('admin routes');

test('inactive admins cannot reach admin routes', function (string $method, string $url) {
    $response = $this->actingAs(User::factory()->admin()->create(['is_active' => false]))->{$method}($url);

    expect($response->status())->toBeIn([302, 403]);
})->with('admin routes');
