<?php

namespace App\Console\Commands;

use App\Enums\ConnectionState;
use App\Enums\DeviceStatus;
use App\Enums\SyncHealth;
use App\Models\AgentSyncState;
use App\Models\Device;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Collection;

/**
 * Refreshes agent_sync_states.health for every device (scheduled every five minutes).
 */
#[Signature('monitor:mark-offline')]
#[Description('Refresh agent sync health (healthy, offline, sync_failed, disabled) for every device')]
class MarkOffline extends Command
{
    private const int CHUNK = 500;

    public function handle(): int
    {
        /** @var array<string, int> $counts */
        $counts = array_fill_keys(array_map(fn (SyncHealth $health): string => $health->value, SyncHealth::cases()), 0);
        $now = now();

        Device::query()
            ->select(['id', 'status', 'last_seen_at'])
            ->with('syncState')
            ->chunkById(self::CHUNK, function (Collection $devices) use (&$counts, $now): void {
                /** @var array<string, list<int>> $existingByHealth */
                $existingByHealth = [];
                /** @var list<array{device_id: int, health: string}> $missing */
                $missing = [];

                /** @var Device $device */
                foreach ($devices as $device) {
                    $health = $this->healthFor($device, $device->syncState)->value;
                    $counts[$health]++;

                    if ($device->syncState === null) {
                        $missing[] = ['device_id' => $device->id, 'health' => $health];
                    } elseif ($device->syncState->health->value !== $health) {
                        $existingByHealth[$health][] = $device->id;
                    }
                }

                foreach ($existingByHealth as $health => $deviceIds) {
                    AgentSyncState::query()
                        ->whereIn('device_id', $deviceIds)
                        ->update(['health' => $health, 'updated_at' => $now]);
                }

                if ($missing !== []) {
                    AgentSyncState::query()->upsert($missing, ['device_id'], ['health']);
                }
            });

        $this->info('Sync health refreshed: '.collect($counts)
            ->map(fn (int $count, string $health): string => "{$health} {$count}")
            ->implode(', ').'.');

        return self::SUCCESS;
    }

    private function healthFor(Device $device, ?AgentSyncState $state): SyncHealth
    {
        if (in_array($device->status, [DeviceStatus::Disabled, DeviceStatus::Uninstalled], true)) {
            return SyncHealth::Disabled;
        }

        if ($state !== null
            && $state->last_failure_at !== null
            && ($state->last_success_at === null || $state->last_failure_at->greaterThan($state->last_success_at))
            && $state->consecutive_failures > 0) {
            return SyncHealth::SyncFailed;
        }

        if (ConnectionState::fromLastSeen($device->last_seen_at) === ConnectionState::Offline) {
            return SyncHealth::Offline;
        }

        return SyncHealth::Healthy;
    }
}
