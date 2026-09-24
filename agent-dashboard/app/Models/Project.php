<?php

namespace App\Models;

use Database\Factories\ProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A project identified across devices by project_key. Token totals are denormalized by ingestion.
 *
 * @property int $id
 * @property string $project_key
 * @property string $name
 * @property string|null $git_remote
 * @property Carbon|null $first_activity_at
 * @property Carbon|null $last_activity_at
 * @property int $session_count
 * @property int $input_tokens
 * @property int $output_tokens
 * @property int $cache_creation_tokens
 * @property int $cache_read_tokens
 * @property int $actual_consumed_tokens
 * @property int $total_token_activity
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'project_key', 'name', 'git_remote', 'first_activity_at', 'last_activity_at', 'session_count',
    'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens',
    'actual_consumed_tokens', 'total_token_activity',
])]
class Project extends Model
{
    /** @use HasFactory<ProjectFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'first_activity_at' => 'datetime',
            'last_activity_at' => 'datetime',
            'session_count' => 'integer',
            'input_tokens' => 'integer',
            'output_tokens' => 'integer',
            'cache_creation_tokens' => 'integer',
            'cache_read_tokens' => 'integer',
            'actual_consumed_tokens' => 'integer',
            'total_token_activity' => 'integer',
        ];
    }

    /**
     * @return HasMany<ProjectLocation, $this>
     */
    public function locations(): HasMany
    {
        return $this->hasMany(ProjectLocation::class);
    }

    /**
     * @return HasMany<ClaudeSession, $this>
     */
    public function sessions(): HasMany
    {
        return $this->hasMany(ClaudeSession::class);
    }
}
