<?php

use App\Http\Controllers\Dashboard\TokenAnalyticsController;
use Illuminate\Support\Facades\Route;

Route::get('analytics/tokens', TokenAnalyticsController::class)
    ->middleware('can:viewMonitoring')
    ->name('analytics.tokens');
