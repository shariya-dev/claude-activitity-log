<?php

use App\Http\Controllers\Dashboard\PlaceholderController;
use Illuminate\Support\Facades\Route;

Route::get('admin/tracking', PlaceholderController::class)
    ->middleware('can:configureTracking')
    ->defaults('title', 'Tracking Settings')
    ->name('tracking-settings.edit');
