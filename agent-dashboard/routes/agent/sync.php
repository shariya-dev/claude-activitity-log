<?php

use App\Http\Controllers\Api\Agent\V1\SyncController;
use Illuminate\Support\Facades\Route;

/*
| Loaded with prefix api/agent/v1 and the `api` middleware group (bootstrap/app.php).
| `device.active` resolves the Sanctum device itself and answers 401/403 with the contract error envelope;
| `auth:sanctum` then makes the device the request user, so the throttle is keyed per device
| (prefix `agent-device`, shared with the other agent endpoints and distinct from user throttles).
*/
Route::post('sync', SyncController::class)
    ->middleware(['settings.version', 'device.active', 'auth:sanctum', 'throttle:60,1,agent-device'])
    ->name('agent.v1.sync');
