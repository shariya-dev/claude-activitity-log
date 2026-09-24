<?php

namespace App\Actions\Agent;

use App\Actions\Agent\Support\AgentTimestamp;
use App\Actions\Agent\Support\AgentVersion;
use App\Models\Device;
use App\Models\TrackingSetting;
use App\Support\OrgClock;

/**
 * Persists an agent heartbeat (sync-api-v1 §3.3). The caller decides on 426; this action still
 * records status for outdated agents but leaves a pending manual-sync request for a later heartbeat.
 */
class RecordHeartbeat
{
    /**
     * @param  array{agent_version: string, claude_code_version: ?string, platform_version: ?string, hostname: ?string, agent_state: string, last_local_activity_at: ?string, last_successful_sync_at: ?string, last_error: ?string}  $data
     * @return array{server_time: string, settings_version: int, sync_requested: bool}
     */
    public function handle(Device $device, array $data, ?string $ip): array
    {
        $settings = TrackingSetting::current();
        $now = OrgClock::now();

        $device->forceFill([
            'last_seen_at' => $now,
            'agent_version' => $data['agent_version'],
            'claude_code_version' => $data['claude_code_version'],
            'platform_version' => $data['platform_version'],
            'agent_state' => $data['agent_state'],
            'last_local_activity_at' => AgentTimestamp::parse($data['last_local_activity_at']),
            'last_public_ip' => $settings->network ? $ip : null,
        ]);

        if ($settings->device && $data['hostname'] !== null) {
            $device->hostname = $data['hostname'];
        }

        $device->save();

        $syncRequested = false;

        if (! AgentVersion::isOutdated($data['agent_version'], $settings->min_agent_version)) {
            // Conditional update so a request is handed out exactly once, even with concurrent heartbeats.
            $syncRequested = Device::query()
                ->whereKey($device->id)
                ->whereNotNull('sync_requested_at')
                ->update(['sync_requested_at' => null]) > 0;

            if ($syncRequested) {
                $device->sync_requested_at = null;
                $device->syncOriginalAttribute('sync_requested_at');
            }
        }

        return [
            'server_time' => (string) AgentTimestamp::format($now),
            'settings_version' => (int) $settings->version,
            'sync_requested' => $syncRequested,
        ];
    }
}
