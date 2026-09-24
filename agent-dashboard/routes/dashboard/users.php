<?php

use App\Http\Controllers\Dashboard\PlaceholderController;
use Illuminate\Support\Facades\Route;

Route::get('admin/users', PlaceholderController::class)
    ->middleware('can:manageUsers')
    ->defaults('title', 'Users')
    ->name('users.index');
