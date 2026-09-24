<?php

use App\Http\Controllers\Dashboard\ProjectController;
use Illuminate\Support\Facades\Route;

Route::middleware('can:viewMonitoring')->group(function (): void {
    Route::get('projects', [ProjectController::class, 'index'])->name('projects.index');
    Route::get('projects/{project}', [ProjectController::class, 'show'])->name('projects.show');
});
