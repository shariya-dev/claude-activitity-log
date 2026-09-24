<?php

namespace App\Models;

use App\Enums\SessionStatus;
use Database\Factories\ClaudeSessionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A Claude Code session (PRD "session"; table renamed to avoid Laravel's `sessions`).
 *
 * @property int $id
 * @property int $device_id
 * @property int $developer_id
 * @property int|null $claude_account_id
 * @property int|null $project_id
 * @property int|null $claude_model_id
 * @property string $source_session_id
 * @property Carbon $started_at
 * @property Carbon $last_activity_at
 * @property Carbon|null $ended_at
 * @property int $duration_seconds
 * @property int $activity_count
 * @property int $input_tokens
 * @property int $output_tokens
 * @property int $cache_creation_tokens
 * @property int $cache_read_tokens
 * @property int $actual_consumed_tokens
 * @property int $total_token_activity
 * @property SessionStatus $status
 * @property string|null $claude_code_version
 * @property string|null $entrypoint
 * @property string|null $git_branch
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'device_id', 'developer_id', 'claude_account_id', 'project_id', 'claude_model_id', 'source_session_id',
    'started_at', 'last_activity_at', 'ended_at', 'duration_seconds', 'activity_count', 'input_tokens',
    'output_tokens', 'cache_creation_tokens', 'cache_read_tokens', 'actual_consumed_tokens',
    'total_token_activity', 'status', 'claude_code_version', 'entrypoint', 'git_branch',
])]
class ClaudeSession extends Model
{
    /** @use HasFactory<ClaudeSessionFactory> */
    use HasFactory;

    protected $table = 'claude_sessions';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => SessionStatus::class,
            'started_at' => 'datetime',
            'last_activity_at' => 'datetime',
            'ended_at' => 'datetime',
            'duration_seconds' => 'integer',
            'activity_count' => 'integer',
            'input_tokens' => 'integer',
            'output_tokens' => 'integer',
            'cache_creation_tokens' => 'integer',
            'cache_read_tokens' => 'integer',
            'actual_consumed_tokens' => 'integer',
            'total_token_activity' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Device, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    /**
     * @return BelongsTo<Developer, $this>
     */
    public function developer(): BelongsTo
    {
        return $this->belongsTo(Developer::class)->withTrashed();
    }

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * @return BelongsTo<ClaudeAccount, $this>
     */
    public function claudeAccount(): BelongsTo
    {
        return $this->belongsTo(ClaudeAccount::class);
    }

    /**
     * @return BelongsTo<ClaudeModel, $this>
     */
    public function claudeModel(): BelongsTo
    {
        return $this->belongsTo(ClaudeModel::class);
    }

    /**
     * @return HasMany<SessionUsage, $this>
     */
    public function usage(): HasMany
    {
        return $this->hasMany(SessionUsage::class);
    }

    /**
     * @return HasMany<SessionMessage, $this>
     */
    public function messages(): HasMany
    {
        return $this->hasMany(SessionMessage::class);
    }
}
