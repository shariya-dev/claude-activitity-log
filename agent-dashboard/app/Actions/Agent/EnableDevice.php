<?php

namespace App\Actions\Agent;

use App\Enums\DeviceStatus;
use App\Enums\SyncHealth;
use App\Models\AgentSyncState;
use App\Models\AuditLog;
use App\Models\Device;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Re-activates a disabled device (any other status is left untouched). DisableDevice kept its token,
 * so the agent resumes syncing after its next hourly probe, without a re-pair.
 */
class EnableDevice
{
    public function handle(Device $device, User $by): void
    {
        if ($device->status !== DeviceStatus::Disabled) {
            return;
        }

        DB::transaction(function () use ($device, $by): void {
            $device->fill(['status' => DeviceStatus::Active, 'disabled_at' => null])->save();

            AgentSyncState::query()
                ->where('device_id', $device->id)
                ->where('health', SyncHealth::Disabled)
                ->update(['health' => SyncHealth::Offline]);

            AuditLog::record('device.enabled', $device, [], $by);
        });
    }
}
