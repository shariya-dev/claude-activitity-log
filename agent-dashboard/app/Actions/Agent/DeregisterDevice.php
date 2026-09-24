<?php

namespace App\Actions\Agent;

use App\Enums\DeviceStatus;
use App\Models\AuditLog;
use App\Models\Device;
use App\Support\OrgClock;
use Illuminate\Support\Facades\DB;

/**
 * Uninstall reported by the agent: tokens revoked, all history kept (PRD §11, sync-api-v1 §3.6).
 */
class DeregisterDevice
{
    public function handle(Device $device): void
    {
        DB::transaction(function () use ($device): void {
            $device->fill(['status' => DeviceStatus::Uninstalled, 'uninstalled_at' => OrgClock::now()])->save();
            $device->tokens()->delete();

            AuditLog::record('device.uninstalled', $device);
        });
    }
}
