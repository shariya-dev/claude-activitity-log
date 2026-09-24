<?php

use App\Http\Controllers\Dashboard\PlaceholderController;
use Illuminate\Support\Facades\Route;

Route::middleware('can:viewMonitoring')->group(function (): void {
    Route::get('projects', PlaceholderController::class)->defaults('title', 'Projects')->name('projects.index');
    Route::get('projects/{project}', PlaceholderController::class)->defaults('title', 'Project')->name('projects.show');
});
