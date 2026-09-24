<?php

namespace App\Models;

use App\Enums\SyncBatchStatus;
use Database\Factories\SyncBatchFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Audit trail of one sync attempt; `response` is kept for idempotent replay.
 *
 * @property int $id
 * @property int $device_id
 * @property string $batch_uuid
 * @property SyncBatchStatus $status
 * @property bool $is_initial
 * @property int $accepted
 * @property int $created
 * @property int $updated
 * @property int $rejected
 * @property array<int, array<string, mixed>>|null $rejections
 * @property string|null $error_code
 * @property int $payload_bytes
 * @property int $duration_ms
 * @property array<string, mixed>|null $response
 * @property Carbon $received_at
 * @property Carbon|null $completed_at
 */
#[Fillable([
    'device_id', 'batch_uuid', 'status', 'is_initial', 'accepted', 'created', 'updated', 'rejected',
    'rejections', 'error_code', 'payload_bytes', 'duration_ms', 'response', 'received_at', 'completed_at',
])]
class SyncBatch extends Model
{
    /** @use HasFactory<SyncBatchFactory> */
    use HasFactory;

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => SyncBatchStatus::class,
            'is_initial' => 'boolean',
            'accepted' => 'integer',
            'created' => 'integer',
            'updated' => 'integer',
            'rejected' => 'integer',
            'rejections' => 'array',
            'payload_bytes' => 'integer',
            'duration_ms' => 'integer',
            'response' => 'array',
            'received_at' => 'datetime',
            'completed_at' => 'datetime',
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
