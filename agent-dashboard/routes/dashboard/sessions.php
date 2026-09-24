<?php

use App\Http\Controllers\Dashboard\PlaceholderController;
use Illuminate\Support\Facades\Route;

Route::middleware('can:viewMonitoring')->group(function (): void {
    Route::get('sessions', PlaceholderController::class)->defaults('title', 'Sessions')->name('sessions.index');
    Route::get('sessions/{session}', PlaceholderController::class)->defaults('title', 'Session')->name('sessions.show');
});
