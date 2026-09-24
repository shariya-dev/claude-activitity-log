<?php

use App\Http\Controllers\Dashboard\SessionController;
use Illuminate\Support\Facades\Route;

Route::middleware('can:viewMonitoring')->group(function (): void {
    Route::get('sessions', [SessionController::class, 'index'])->name('sessions.index');
    Route::get('sessions/{session}', [SessionController::class, 'show'])->whereNumber('session')->name('sessions.show');
});
