<?php

namespace App\Models;

use Database\Factories\SessionMessageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Prompt/message text — only stored while Prompt tracking is ON. Encrypted at rest,
 * hidden from serialization by default (reveal explicitly behind the viewPrompts gate).
 *
 * @property int $id
 * @property int $claude_session_id
 * @property string $source_message_id
 * @property string $role
 * @property string $content
 * @property Carbon $recorded_at
 */
#[Fillable(['claude_session_id', 'source_message_id', 'role', 'content', 'recorded_at'])]
#[Hidden(['content'])]
class SessionMessage extends Model
{
    /** @use HasFactory<SessionMessageFactory> */
    use HasFactory;

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'content' => 'encrypted',
            'recorded_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<ClaudeSession, $this>
     */
    public function session(): BelongsTo
    {
        return $this->belongsTo(ClaudeSession::class, 'claude_session_id');
    }
}
