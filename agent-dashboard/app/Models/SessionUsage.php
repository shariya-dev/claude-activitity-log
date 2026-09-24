<?php

namespace App\Models;

use Database\Factories\SessionUsageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One row per Claude API message. Raw token columns are preserved as received;
 * actual_consumed_tokens / total_token_activity are computed only by App\Support\TokenMath.
 *
 * @property int $id
 * @property int $claude_session_id
 * @property string $source_message_id
 * @property string|null $request_id
 * @property bool $is_sidechain
 * @property int|null $claude_model_id
 * @property int $device_id
 * @property int $developer_id
 * @property int|null $project_id
 * @property int|null $claude_account_id
 * @property int $input_tokens
 * @property int $output_tokens
 * @property int $cache_creation_tokens
 * @property int $cache_read_tokens
 * @property int $actual_consumed_tokens
 * @property int $total_token_activity
 * @property Carbon $recorded_at
 * @property Carbon $recorded_on
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'claude_session_id', 'source_message_id', 'request_id', 'is_sidechain', 'claude_model_id', 'device_id',
    'developer_id', 'project_id', 'claude_account_id', 'input_tokens', 'output_tokens',
    'cache_creation_tokens', 'cache_read_tokens', 'actual_consumed_tokens', 'total_token_activity',
    'recorded_at', 'recorded_on',
])]
class SessionUsage extends Model
{
    /** @use HasFactory<SessionUsageFactory> */
    use HasFactory;

    protected $table = 'session_usage';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_sidechain' => 'boolean',
            'input_tokens' => 'integer',
            'output_tokens' => 'integer',
            'cache_creation_tokens' => 'integer',
            'cache_read_tokens' => 'integer',
            'actual_consumed_tokens' => 'integer',
            'total_token_activity' => 'integer',
            'recorded_at' => 'datetime',
            'recorded_on' => 'date',
        ];
    }

    /**
     * @return BelongsTo<ClaudeSession, $this>
     */
    public function session(): BelongsTo
    {
        return $this->belongsTo(ClaudeSession::class, 'claude_session_id');
    }

    /**
     * @return BelongsTo<ClaudeModel, $this>
     */
    public function claudeModel(): BelongsTo
    {
        return $this->belongsTo(ClaudeModel::class);
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
}
