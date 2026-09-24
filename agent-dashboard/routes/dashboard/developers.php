<?php

use App\Http\Controllers\Dashboard\DeveloperController;
use App\Http\Controllers\Dashboard\DeveloperPairingCodeController;
use Illuminate\Support\Facades\Route;

Route::middleware('can:viewMonitoring')->group(function (): void {
    Route::get('developers', [DeveloperController::class, 'index'])->name('developers.index');
    Route::get('developers/{developer}', [DeveloperController::class, 'show'])->name('developers.show');
});

Route::middleware('can:manageAgents')->group(function (): void {
    Route::post('developers', [DeveloperController::class, 'store'])->name('developers.store');
    Route::put('developers/{developer}', [DeveloperController::class, 'update'])->name('developers.update');
    Route::post('developers/{developer}/pairing-codes', [DeveloperPairingCodeController::class, 'store'])
        ->name('developers.pairing-codes.store');
});
