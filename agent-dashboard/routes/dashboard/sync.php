<?php

use App\Http\Controllers\Dashboard\PlaceholderController;
use Illuminate\Support\Facades\Route;

Route::get('sync', PlaceholderController::class)
    ->middleware('can:viewMonitoring')
    ->defaults('title', 'Sync Monitor')
    ->name('sync.index');
