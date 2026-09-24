<?php

use App\Http\Controllers\Dashboard\DeviceActionController;
use App\Http\Controllers\Dashboard\DeviceController;
use Illuminate\Support\Facades\Route;

Route::middleware('can:viewMonitoring')->group(function (): void {
    Route::get('devices', [DeviceController::class, 'index'])->name('devices.index');
    Route::get('devices/{device:device_uid}', [DeviceController::class, 'show'])->name('devices.show');
});

Route::middleware('can:manageAgents')
    ->prefix('devices/{device:device_uid}')
    ->name('devices.')
    ->group(function (): void {
        Route::post('disable', [DeviceActionController::class, 'disable'])->name('disable');
        Route::post('enable', [DeviceActionController::class, 'enable'])->name('enable');
        Route::post('request-sync', [DeviceActionController::class, 'requestSync'])->name('request-sync');
        Route::post('repair-code', [DeviceActionController::class, 'repairCode'])->name('repair-code');
    });
