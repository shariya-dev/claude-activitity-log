<?php

use App\Http\Controllers\Dashboard\PlaceholderController;
use Illuminate\Support\Facades\Route;

Route::get('admin/audit-logs', PlaceholderController::class)
    ->middleware('can:viewAuditLogs')
    ->defaults('title', 'Audit Log')
    ->name('audit-logs.index');
