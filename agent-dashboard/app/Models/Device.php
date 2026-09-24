<?php

namespace App\Models;

use App\Enums\ConnectionState;
use App\Enums\DeviceStatus;
use Database\Factories\DeviceFactory;
use Illuminate\Auth\Authenticatable;
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\HasApiTokens;

/**
 * A paired agent installation. `status` is stored; online/stale/offline is derived.
 * Authenticatable only so Sanctum can resolve it as the token owner (agents never log in with a password).
 *
 * @property int $id
 * @property string $device_uid
 * @property int $developer_id
 * @property string $machine_fingerprint
 * @property string|null $hostname
 * @property string $platform
 * @property string|null $platform_version
 * @property string|null $architecture
 * @property string|null $agent_version
 * @property string|null $claude_code_version
 * @property DeviceStatus $status
 * @property string|null $agent_state
 * @property Carbon|null $first_seen_at
 * @property Carbon|null $last_seen_at
 * @property Carbon|null $last_sync_at
 * @property Carbon|null $last_local_activity_at
 * @property Carbon|null $sync_requested_at
 * @property string|null $last_public_ip
 * @property Carbon|null $disabled_at
 * @property Carbon|null $uninstalled_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'device_uid', 'developer_id', 'machine_fingerprint', 'hostname', 'platform', 'platform_version',
    'architecture', 'agent_version', 'claude_code_version', 'status', 'agent_state', 'first_seen_at',
    'last_seen_at', 'last_sync_at', 'last_local_activity_at', 'sync_requested_at', 'last_public_ip',
    'disabled_at', 'uninstalled_at',
])]
class Device extends Model implements AuthenticatableContract
{
    /** @use HasFactory<DeviceFactory> */
    use Authenticatable, HasApiTokens, HasFactory;

    protected static function booted(): void
    {
        static::creating(function (Device $device): void {
            if (empty($device->device_uid)) {
                $device->device_uid = 'dev_'.Str::ulid();
            }
        });
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => DeviceStatus::class,
            'first_seen_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'last_sync_at' => 'datetime',
            'last_local_activity_at' => 'datetime',
            'sync_requested_at' => 'datetime',
            'disabled_at' => 'datetime',
            'uninstalled_at' => 'datetime',
        ];
    }

    public function getRouteKeyName(): string
    {
        return 'device_uid';
    }

    public function connectionState(): ConnectionState
    {
        return ConnectionState::fromLastSeen($this->last_seen_at);
    }

    /**
     * @return BelongsTo<Developer, $this>
     */
    public function developer(): BelongsTo
    {
        return $this->belongsTo(Developer::class)->withTrashed();
    }

    /**
     * @return HasOne<AgentSyncState, $this>
     */
    public function syncState(): HasOne
    {
        return $this->hasOne(AgentSyncState::class);
    }

    /**
     * @return HasMany<SyncBatch, $this>
     */
    public function syncBatches(): HasMany
    {
        return $this->hasMany(SyncBatch::class);
    }

    /**
     * @return HasMany<ClaudeSession, $this>
     */
    public function sessions(): HasMany
    {
        return $this->hasMany(ClaudeSession::class);
    }

    /**
     * @return BelongsToMany<ClaudeAccount, $this>
     */
    public function claudeAccounts(): BelongsToMany
    {
        return $this->belongsToMany(ClaudeAccount::class, 'claude_account_device')
            ->withPivot('first_seen_at', 'last_seen_at')
            ->withTimestamps();
    }

    /**
     * @return HasMany<ProjectLocation, $this>
     */
    public function projectLocations(): HasMany
    {
        return $this->hasMany(ProjectLocation::class);
    }
}
