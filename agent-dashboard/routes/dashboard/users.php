<?php

use App\Http\Controllers\Dashboard\UserController;
use Illuminate\Support\Facades\Route;

Route::middleware('can:manageUsers')->group(function (): void {
    Route::get('admin/users', [UserController::class, 'index'])->name('users.index');
    Route::post('admin/users', [UserController::class, 'store'])->name('users.store');
    Route::patch('admin/users/{user}', [UserController::class, 'update'])->name('users.update');
});
