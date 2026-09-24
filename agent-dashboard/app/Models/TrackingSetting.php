<?php

namespace App\Models;

use App\Enums\InitialSyncRange;
use App\Enums\TrackingCategory;
use App\Support\OrgClock;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Organization-wide tracking configuration (singleton row id=1, seeded by migration).
 *
 * @property int $id
 * @property bool $session
 * @property bool $usage
 * @property bool $project
 * @property bool $model
 * @property bool $device
 * @property bool $account
 * @property bool $prompt
 * @property bool $git
 * @property bool $network
 * @property InitialSyncRange $initial_sync_range
 * @property int $sync_interval_seconds
 * @property int $heartbeat_interval_seconds
 * @property string $min_agent_version
 * @property int|null $retention_days
 * @property int $version
 * @property int|null $updated_by_user_id
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'session', 'usage', 'project', 'model', 'device', 'account', 'prompt', 'git', 'network',
    'initial_sync_range', 'sync_interval_seconds', 'heartbeat_interval_seconds', 'min_agent_version',
    'retention_days', 'updated_by_user_id',
])]
class TrackingSetting extends Model
{
    /**
     * The singleton settings row. Callers that modify settings pass $lockForUpdate = true
     * inside their DB transaction so concurrent updates cannot lose a version bump.
     */
    public static function current(bool $lockForUpdate = false): self
    {
        $query = static::query();

        if ($lockForUpdate) {
            $query->lockForUpdate();
        }

        return $query->findOrFail(1);
    }

    public function enabled(TrackingCategory $category): bool
    {
        return (bool) $this->getAttribute($category->value);
    }

    /**
     * Increment the settings version in memory; the caller saves.
     *
     * The caller must hold the row lock (load via current(lockForUpdate: true) inside a
     * transaction), otherwise two concurrent updates can both write the same version.
     */
    public function bumpVersion(): void
    {
        $this->version = (int) $this->version + 1;
    }

    /**
     * The settings object sent to agents (GET /settings, register response).
     *
     * @return array{version: int, categories: array<string, bool>, initial_sync: array{range: string, since: string|null}, sync_interval_seconds: int, heartbeat_interval_seconds: int, min_agent_version: string}
     */
    public function toAgentPayload(): array
    {
        $categories = [];

        foreach (TrackingCategory::cases() as $category) {
            $categories[$category->value] = $this->enabled($category);
        }

        $since = $this->initial_sync_range->sinceFrom(OrgClock::now());

        return [
            'version' => (int) $this->version,
            'categories' => $categories,
            'initial_sync' => [
                'range' => $this->initial_sync_range->value,
                'since' => $since?->utc()->format('Y-m-d\TH:i:s\Z'),
            ],
            'sync_interval_seconds' => (int) $this->sync_interval_seconds,
            'heartbeat_interval_seconds' => (int) $this->heartbeat_interval_seconds,
            'min_agent_version' => $this->min_agent_version,
        ];
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'session' => 'boolean',
            'usage' => 'boolean',
            'project' => 'boolean',
            'model' => 'boolean',
            'device' => 'boolean',
            'account' => 'boolean',
            'prompt' => 'boolean',
            'git' => 'boolean',
            'network' => 'boolean',
            'initial_sync_range' => InitialSyncRange::class,
            'sync_interval_seconds' => 'integer',
            'heartbeat_interval_seconds' => 'integer',
            'retention_days' => 'integer',
            'version' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by_user_id');
    }
}
