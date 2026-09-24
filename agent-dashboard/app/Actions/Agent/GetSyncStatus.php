<?php

namespace App\Actions\Agent;

use App\Actions\Agent\Support\AgentTimestamp;
use App\Models\Device;

/**
 * Server-side sync state for an agent that lost its local state (sync-api-v1 §3.5).
 */
class GetSyncStatus
{
    /**
     * @return array{last_batch_id: ?string, cursor: ?string, sequence: int, last_success_at: ?string, sessions_known: int}
     */
    public function handle(Device $device): array
    {
        $state = $device->syncState()->first();

        return [
            'last_batch_id' => $state?->last_batch_uuid,
            'cursor' => $state?->cursor,
            'sequence' => (int) ($state->sequence ?? 0),
            'last_success_at' => AgentTimestamp::format($state?->last_success_at),
            'sessions_known' => $device->sessions()->count(),
        ];
    }
}
