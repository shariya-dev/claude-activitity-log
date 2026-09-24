<?php

namespace App\Actions\Agent;

use App\Enums\DeviceStatus;
use App\Enums\SyncHealth;
use App\Models\AgentSyncState;
use App\Models\AuditLog;
use App\Models\Device;
use App\Models\User;
use App\Support\OrgClock;
use Illuminate\Support\Facades\DB;

/**
 * Stops a device from syncing, keeping its history (PRD §11). Its token is kept so the agent is told
 * `403 device_disabled` and probes hourly (sync-api-v1 §9.2); EnableDevice resumes on the same token.
 * An uninstalled device is left untouched.
 */
class DisableDevice
{
    public function handle(Device $device, User $by): void
    {
        if ($device->status === DeviceStatus::Uninstalled) {
            return;
        }

        DB::transaction(function () use ($device, $by): void {
            $device->fill(['status' => DeviceStatus::Disabled, 'disabled_at' => OrgClock::now()])->save();

            AgentSyncState::updateOrCreate(['device_id' => $device->id], ['health' => SyncHealth::Disabled]);

            AuditLog::record('device.disabled', $device, [], $by);
        });
    }
}
