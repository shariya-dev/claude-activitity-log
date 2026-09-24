<?php

use App\Http\Controllers\Dashboard\TrackingSettingsController;
use Illuminate\Support\Facades\Route;

Route::middleware('can:configureTracking')->group(function (): void {
    Route::get('admin/tracking', [TrackingSettingsController::class, 'edit'])->name('tracking-settings.edit');
    Route::put('admin/tracking', [TrackingSettingsController::class, 'update'])->name('tracking-settings.update');
});
