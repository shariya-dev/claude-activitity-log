<?php

namespace App\Models;

use Database\Factories\ClaudeModelFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * A Claude model name as observed in usage data (dynamic — no fixed list).
 *
 * @property int $id
 * @property string $name
 * @property Carbon|null $first_seen_at
 * @property Carbon|null $last_seen_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'first_seen_at', 'last_seen_at'])]
class ClaudeModel extends Model
{
    /** @use HasFactory<ClaudeModelFactory> */
    use HasFactory;

    /**
     * Resolve (creating if needed) the id for a model name.
     *
     * Upserts on the unique `name` (bumping last_seen_at on conflict). Ids are memoized in the
     * in-memory array cache only once the row is known to be committed: inside a transaction the
     * id is kept in a pending memo that is promoted after commit and discarded on rollback, so a
     * rolled-back sync batch can never leave a cached id pointing at a row that no longer exists.
     */
    public static function idFor(string $name): int
    {
        $cache = Cache::store('array');
        $committedKey = 'claude_model_id:'.$name;
        $pendingKey = 'claude_model_id:pending:'.$name;

        $cached = $cache->get($committedKey) ?? $cache->get($pendingKey);

        if ($cached !== null) {
            return (int) $cached;
        }

        $id = self::upsertAndFetchId($name);

        if (DB::transactionLevel() === 0) {
            $cache->forever($committedKey, $id);

            return $id;
        }

        $cache->forever($pendingKey, $id);

        DB::afterCommit(function () use ($cache, $committedKey, $pendingKey, $id): void {
            $cache->forget($pendingKey);
            $cache->forever($committedKey, $id);
        });

        DB::afterRollBack(fn () => $cache->forget($pendingKey));

        return $id;
    }

    private static function upsertAndFetchId(string $name): int
    {
        $now = now();

        static::query()->upsert(
            [['name' => $name, 'first_seen_at' => $now, 'last_seen_at' => $now, 'created_at' => $now, 'updated_at' => $now]],
            ['name'],
            ['last_seen_at', 'updated_at'],
        );

        return (int) static::query()->where('name', $name)->value('id');
    }

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
     * @return HasMany<ClaudeSession, $this>
     */
    public function sessions(): HasMany
    {
        return $this->hasMany(ClaudeSession::class);
    }

    /**
     * @return HasMany<SessionUsage, $this>
     */
    public function usage(): HasMany
    {
        return $this->hasMany(SessionUsage::class);
    }
}
