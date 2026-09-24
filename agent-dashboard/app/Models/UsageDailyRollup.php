<?php

namespace App\Models;

use Database\Factories\UsageDailyRollupFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Derived daily aggregate of session_usage (date × developer × device × project × account × model).
 *
 * @property int $id
 * @property Carbon $date
 * @property int $developer_id
 * @property int $device_id
 * @property int|null $project_id
 * @property int|null $claude_account_id
 * @property int|null $claude_model_id
 * @property string $dims_hash
 * @property int $input_tokens
 * @property int $output_tokens
 * @property int $cache_creation_tokens
 * @property int $cache_read_tokens
 * @property int $actual_consumed_tokens
 * @property int $total_token_activity
 * @property int $message_count
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'date', 'developer_id', 'device_id', 'project_id', 'claude_account_id', 'claude_model_id', 'dims_hash',
    'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens',
    'actual_consumed_tokens', 'total_token_activity', 'message_count',
])]
class UsageDailyRollup extends Model
{
    /** @use HasFactory<UsageDailyRollupFactory> */
    use HasFactory;

    public const CREATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'date' => 'date',
            'input_tokens' => 'integer',
            'output_tokens' => 'integer',
            'cache_creation_tokens' => 'integer',
            'cache_read_tokens' => 'integer',
            'actual_consumed_tokens' => 'integer',
            'total_token_activity' => 'integer',
            'message_count' => 'integer',
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
     * @return BelongsTo<Device, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
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
}
