<?php

namespace App\Http\Resources\Agent;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The POST /sync success body (docs/contracts/sync-api-v1.md §3.4). Wraps the array produced by IngestSyncBatch,
 * including a replayed one read back from sync_batches.response, and emits it in contract key order.
 *
 * @property-read array<string, mixed> $resource
 */
class SyncResultResource extends JsonResource
{
    /** @var string|null */
    public static $wrap = null;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $body = $this->resource;
        $sync = $body['sync'];

        return [
            'success' => true,
            'batch_id' => $body['batch_id'],
            'sync' => [
                'accepted' => $sync['accepted'],
                'created' => $sync['created'],
                'updated' => $sync['updated'],
                'rejected' => $sync['rejected'],
            ],
            'rejected_records' => array_map(fn (array $rejection): array => [
                'type' => $rejection['type'],
                'source_id' => $rejection['source_id'],
                'reason' => $rejection['reason'],
            ], $body['rejected_records']),
            'cursor' => $body['cursor'],
            'settings_version' => $body['settings_version'],
            'server_time' => $body['server_time'],
        ];
    }
}
