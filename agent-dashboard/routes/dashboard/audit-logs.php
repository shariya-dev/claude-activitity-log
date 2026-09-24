<?php

use App\Http\Controllers\Dashboard\AuditLogController;
use Illuminate\Support\Facades\Route;

Route::get('admin/audit-logs', [AuditLogController::class, 'index'])
    ->middleware('can:viewAuditLogs')
    ->name('audit-logs.index');
