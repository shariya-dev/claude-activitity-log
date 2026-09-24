<?php

namespace App\Queries\Analytics;

use App\Enums\ConnectionState;
use App\Enums\DeviceStatus;
use App\Enums\SyncHealth;
use App\Models\TrackingSetting;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Agent connection/sync health (PRD §49–50). Connection state is derived from last_seen_at
 * (ConnectionState thresholds); "outdated" compares agent_version to the tracking min_agent_version.
 * Disabled and uninstalled devices are counted separately and never reported as problems.
 */
final class AgentHealth
{
    /**
     * @return array{online: int, stale: int, offline: int, disabled: int, uninstalled: int, outdated: int, sync_failed: int}
     */
    public function summary(): array
    {
        $summary = ['online' => 0, 'stale' => 0, 'offline' => 0, 'disabled' => 0, 'uninstalled' => 0, 'outdated' => 0, 'sync_failed' => 0];

        foreach ($this->classifiedDevices() as $device) {
            if ($device['status'] !== DeviceStatus::Active->value) {
                $summary[$device['status'] === DeviceStatus::Disabled->value ? 'disabled' : 'uninstalled']++;

                continue;
            }

            $summary[$device['row']['connection']]++;
            $summary['outdated'] += $device['row']['outdated'] ? 1 : 0;
            $summary['sync_failed'] += $device['row']['health'] === SyncHealth::SyncFailed->value ? 1 : 0;
        }

        return $summary;
    }

    /**
     * Active agents that are stale, offline, failing to sync or outdated — oldest last_seen_at first (never seen first).
     *
     * @return list<array{device_id: int, device_uid: string, hostname: string|null, developer: string, platform: string, agent_version: string|null, last_seen_at: string|null, last_sync_at: string|null, connection: string, health: string, outdated: bool}>
     */
    public function problemAgents(int $limit = 20): array
    {
        return $this->classifiedDevices(activeOnly: true)
            ->map(fn (array $device): array => $device['row'])
            ->filter(fn (array $row): bool => $row['connection'] !== ConnectionState::Online->value
                || $row['health'] !== SyncHealth::Healthy->value
                || $row['outdated'])
            ->take(max(1, $limit))
            ->values()
            ->all();
    }

    /**
     * One settings query + one devices query; rows ordered by last_seen_at ascending, nulls first.
     *
     * @return Collection<int, array{status: string, row: array{device_id: int, device_uid: string, hostname: string|null, developer: string, platform: string, agent_version: string|null, last_seen_at: string|null, last_sync_at: string|null, connection: string, health: string, outdated: bool}}>
     */
    private function classifiedDevices(bool $activeOnly = false): Collection
    {
        $minVersion = TrackingSetting::current()->min_agent_version;
        $now = CarbonImmutable::now();

        return DB::table('devices as dv')
            ->join('developers as dev', 'dev.id', '=', 'dv.developer_id')
            ->leftJoin('agent_sync_states as ss', 'ss.device_id', '=', 'dv.id')
            ->when($activeOnly, fn ($query) => $query->where('dv.status', DeviceStatus::Active->value))
            ->select([
                'dv.id', 'dv.device_uid', 'dv.hostname', 'dev.name as developer', 'dv.platform', 'dv.agent_version',
                'dv.last_seen_at', 'dv.last_sync_at', 'dv.status', 'ss.health',
            ])
            ->orderByRaw('dv.last_seen_at IS NOT NULL')
            ->orderBy('dv.last_seen_at')
            ->orderBy('dv.id')
            ->get()
            ->map(function (object $device) use ($minVersion, $now): array {
                $lastSeenAt = $device->last_seen_at === null ? null : CarbonImmutable::parse((string) $device->last_seen_at, 'UTC');
                $connection = ConnectionState::fromLastSeen($lastSeenAt, $now);
                $agentVersion = $device->agent_version === null ? null : (string) $device->agent_version;

                return [
                    'status' => (string) $device->status,
                    'row' => [
                        'device_id' => (int) $device->id,
                        'device_uid' => (string) $device->device_uid,
                        'hostname' => $device->hostname === null ? null : (string) $device->hostname,
                        'developer' => (string) $device->developer,
                        'platform' => (string) $device->platform,
                        'agent_version' => $agentVersion,
                        'last_seen_at' => $lastSeenAt === null ? null : SessionRows::iso((string) $device->last_seen_at),
                        'last_sync_at' => $device->last_sync_at === null ? null : SessionRows::iso((string) $device->last_sync_at),
                        'connection' => $connection->value,
                        'health' => $this->health($device->health === null ? null : (string) $device->health, $connection),
                        'outdated' => $agentVersion !== null && $this->isOutdated($agentVersion, $minVersion),
                    ],
                ];
            });
    }

    /**
     * Sync health as shown on the monitoring pages: a recorded sync failure wins, then a derived
     * offline connection (the stored value may lag until monitor:mark-offline runs), else healthy.
     */
    private function health(?string $stored, ConnectionState $connection): string
    {
        if ($stored === SyncHealth::SyncFailed->value) {
            return SyncHealth::SyncFailed->value;
        }

        return $connection === ConnectionState::Offline ? SyncHealth::Offline->value : SyncHealth::Healthy->value;
    }

    private function isOutdated(string $agentVersion, string $minVersion): bool
    {
        return version_compare(ltrim($agentVersion, 'vV'), ltrim($minVersion, 'vV'), '<');
    }
}
