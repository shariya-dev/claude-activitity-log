<?php

use App\Http\Controllers\Dashboard\PlaceholderController;
use Illuminate\Support\Facades\Route;

Route::get('analytics/tokens', PlaceholderController::class)
    ->middleware('can:viewMonitoring')
    ->defaults('title', 'Token Analytics')
    ->name('analytics.tokens');
