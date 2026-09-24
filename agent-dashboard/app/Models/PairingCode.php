<?php

namespace App\Models;

use App\Enums\PairingPurpose;
use Database\Factories\PairingCodeFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One-time pairing code; only the sha256 of the normalized code is stored.
 *
 * @property int $id
 * @property int $developer_id
 * @property string $code_hash
 * @property Carbon $expires_at
 * @property Carbon|null $used_at
 * @property int|null $used_by_device_id
 * @property int $created_by_user_id
 * @property PairingPurpose $purpose
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'developer_id', 'code_hash', 'expires_at', 'used_at', 'used_by_device_id', 'created_by_user_id', 'purpose',
])]
class PairingCode extends Model
{
    /** @use HasFactory<PairingCodeFactory> */
    use HasFactory;

    /**
     * Hash a user-entered code: whitespace and dashes removed, uppercased, sha256 hex.
     */
    public static function hashCode(string $code): string
    {
        $normalized = strtoupper((string) preg_replace('/[\s-]+/', '', $code));

        return hash('sha256', $normalized);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'purpose' => PairingPurpose::class,
            'expires_at' => 'datetime',
            'used_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Developer, $this>
     */
    public function developer(): BelongsTo
    {
        return $this->belongsTo(Developer::class);
    }

    /**
     * @return BelongsTo<Device, $this>
     */
    public function usedByDevice(): BelongsTo
    {
        return $this->belongsTo(Device::class, 'used_by_device_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
