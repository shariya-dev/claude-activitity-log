<?php

namespace App\Models;

use Database\Factories\ClaudeAccountFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A Claude login observed on a developer's devices (from ~/.claude.json oauthAccount).
 *
 * @property int $id
 * @property int $developer_id
 * @property string $account_key
 * @property string|null $account_uuid
 * @property string|null $email
 * @property string|null $display_name
 * @property string|null $organization_uuid
 * @property string|null $organization_name
 * @property string $status
 * @property Carbon|null $first_seen_at
 * @property Carbon|null $last_seen_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'developer_id', 'account_key', 'account_uuid', 'email', 'display_name', 'organization_uuid',
    'organization_name', 'status', 'first_seen_at', 'last_seen_at',
])]
class ClaudeAccount extends Model
{
    /** @use HasFactory<ClaudeAccountFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'first_seen_at' => 'datetime',
            'last_seen_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Developer, $this>
     */
    public function developer(): BelongsTo
    {
        return $this->belongsTo(Developer::class)->withTrashed();
    }

    /**
     * @return BelongsToMany<Device, $this>
     */
    public function devices(): BelongsToMany
    {
        return $this->belongsToMany(Device::class, 'claude_account_device')
            ->withPivot('first_seen_at', 'last_seen_at')
            ->withTimestamps();
    }

    /**
     * @return HasMany<ClaudeSession, $this>
     */
    public function sessions(): HasMany
    {
        return $this->hasMany(ClaudeSession::class);
    }
}
