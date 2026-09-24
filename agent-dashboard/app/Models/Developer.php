<?php

namespace App\Models;

use App\Enums\DeveloperStatus;
use Database\Factories\DeveloperFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * A human developer — the one central identity devices and Claude accounts roll up to.
 *
 * @property int $id
 * @property string $name
 * @property string $email
 * @property string|null $team
 * @property DeveloperStatus $status
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property Carbon|null $deleted_at
 */
#[Fillable(['name', 'email', 'team', 'status'])]
class Developer extends Model
{
    /** @use HasFactory<DeveloperFactory> */
    use HasFactory, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => DeveloperStatus::class,
        ];
    }

    /**
     * @return HasMany<Device, $this>
     */
    public function devices(): HasMany
    {
        return $this->hasMany(Device::class);
    }

    /**
     * @return HasMany<ClaudeAccount, $this>
     */
    public function claudeAccounts(): HasMany
    {
        return $this->hasMany(ClaudeAccount::class);
    }

    /**
     * @return HasMany<ClaudeSession, $this>
     */
    public function sessions(): HasMany
    {
        return $this->hasMany(ClaudeSession::class);
    }

    /**
     * @return HasMany<PairingCode, $this>
     */
    public function pairingCodes(): HasMany
    {
        return $this->hasMany(PairingCode::class);
    }
}
