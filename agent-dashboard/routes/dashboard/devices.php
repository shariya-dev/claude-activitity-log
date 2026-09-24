<?php

use App\Http\Controllers\Dashboard\PlaceholderController;
use Illuminate\Support\Facades\Route;

Route::middleware('can:viewMonitoring')->group(function (): void {
    Route::get('devices', PlaceholderController::class)->defaults('title', 'Devices')->name('devices.index');
    Route::get('devices/{device:device_uid}', PlaceholderController::class)->defaults('title', 'Device')->name('devices.show');
});
