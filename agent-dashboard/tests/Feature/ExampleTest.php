<?php

use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

test('the home page sends guests to the login page', function () {
    $this->get(route('home'))->assertRedirect(route('login'));
});
