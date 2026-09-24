<?php

use App\Http\Controllers\Api\Agent\V1\DeregisterController;
use App\Http\Controllers\Api\Agent\V1\HeartbeatController;
use App\Http\Controllers\Api\Agent\V1\RegisterController;
use App\Http\Controllers\Api\Agent\V1\SettingsController;
use App\Http\Controllers\Api\Agent\V1\SyncStatusController;
use Illuminate\Support\Facades\Route;

/*
| Agent device endpoints (docs/contracts/sync-api-v1.md §3). Loaded under /api/agent/v1.
| Check order on authenticated routes: 401 → 429 → 403. settings.version wraps throttle and
| device.active so every post-authentication response, errors included, carries the headers.
*/

Route::post('register', RegisterController::class)
    ->middleware('throttle:10,1,agent-register')
    ->name('agent.v1.register');

Route::middleware(['auth:sanctum', 'settings.version', 'throttle:60,1,agent-device'])->group(function (): void {
    // Uninstallers must be able to deregister a disabled device, so no device.active here.
    Route::post('deregister', DeregisterController::class)->name('agent.v1.deregister');

    Route::middleware('device.active')->group(function (): void {
        Route::post('heartbeat', HeartbeatController::class)->name('agent.v1.heartbeat');
        Route::get('settings', SettingsController::class)->name('agent.v1.settings');
        Route::get('sync/status', SyncStatusController::class)->name('agent.v1.sync.status');
    });
});
