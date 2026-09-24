<?php

use App\Http\Controllers\Dashboard\PlaceholderController;
use Illuminate\Support\Facades\Route;

Route::middleware('can:viewMonitoring')->group(function (): void {
    Route::get('developers', PlaceholderController::class)->defaults('title', 'Developers')->name('developers.index');
    Route::get('developers/{developer}', PlaceholderController::class)->defaults('title', 'Developer')->name('developers.show');
});
