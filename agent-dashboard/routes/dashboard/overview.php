<?php

use App\Http\Controllers\Dashboard\OverviewController;
use Illuminate\Support\Facades\Route;

Route::get('dashboard', OverviewController::class)
    ->middleware('can:viewMonitoring')
    ->name('dashboard');
