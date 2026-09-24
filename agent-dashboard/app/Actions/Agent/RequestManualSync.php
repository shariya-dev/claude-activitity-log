<?php

namespace App\Actions\Agent;

use App\Models\AuditLog;
use App\Models\Device;
use App\Models\User;
use App\Support\OrgClock;
use Illuminate\Support\Facades\DB;

/**
 * "Sync Now": the next heartbeat returns sync_requested=true once.
 */
class RequestManualSync
{
    public function handle(Device $device, User $by): void
    {
        DB::transaction(function () use ($device, $by): void {
            $device->fill(['sync_requested_at' => OrgClock::now()])->save();

            AuditLog::record('sync.requested', $device, [], $by);
        });
    }
}
