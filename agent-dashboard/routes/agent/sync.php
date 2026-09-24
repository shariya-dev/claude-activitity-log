<?php

use App\Http\Controllers\Api\Agent\V1\SyncController;
use Illuminate\Support\Facades\Route;

/*
| Loaded with prefix api/agent/v1 and the `api` middleware group (bootstrap/app.php).
| Check order 401 → 429 → 403 (contract §2), same as routes/agent/device.php: `auth:sanctum` makes the
| device the request user, so the throttle is keyed per device (prefix `agent-device`, shared with the
| other agent endpoints and distinct from user throttles); `device.active` then answers 403.
| settings.version is prioritised right after authentication (bootstrap/app.php), so it wraps the throttle.
*/
Route::post('sync', SyncController::class)
    ->middleware(['auth:sanctum', 'settings.version', 'throttle:60,1,agent-device', 'device.active'])
    ->name('agent.v1.sync');
