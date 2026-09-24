<?php

namespace App\Models;

use App\Enums\SyncHealth;
use Database\Factories\AgentSyncStateFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Per-device (1:1) sync bookkeeping: server cursor, failure counters and health.
 *
 * @property int $id
 * @property int $device_id
 * @property string|null $cursor
 * @property int $sequence
 * @property string|null $last_batch_uuid
 * @property Carbon|null $last_success_at
 * @property Carbon|null $last_failure_at
 * @property string|null $last_error_code
 * @property string|null $last_error_message
 * @property int $consecutive_failures
 * @property int $records_created_total
 * @property int $records_updated_total
 * @property int $records_rejected_total
 * @property SyncHealth $health
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'device_id', 'cursor', 'sequence', 'last_batch_uuid', 'last_success_at', 'last_failure_at',
    'last_error_code', 'last_error_message', 'consecutive_failures', 'records_created_total',
    'records_updated_total', 'records_rejected_total', 'health',
])]
class AgentSyncState extends Model
{
    /** @use HasFactory<AgentSyncStateFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'health' => SyncHealth::class,
            'sequence' => 'integer',
            'last_success_at' => 'datetime',
            'last_failure_at' => 'datetime',
            'consecutive_failures' => 'integer',
            'records_created_total' => 'integer',
            'records_updated_total' => 'integer',
            'records_rejected_total' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Device, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}
