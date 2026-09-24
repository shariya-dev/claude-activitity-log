<?php

use App\Http\Controllers\Dashboard\SyncMonitorController;
use Illuminate\Support\Facades\Route;

Route::get('sync', SyncMonitorController::class)
    ->middleware('can:viewMonitoring')
    ->name('sync.index');
