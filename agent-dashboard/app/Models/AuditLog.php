<?php

namespace App\Models;

use App\Models\Builders\AuditLogBuilder;
use Database\Factories\AuditLogFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\UseEloquentBuilder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use LogicException;

/**
 * Append-only audit trail. Never put prompt content, tokens or credentials in metadata.
 * Model events block update/delete on instances; AuditLogBuilder blocks mass update/delete queries.
 *
 * @property int $id
 * @property int|null $user_id
 * @property string $action
 * @property string|null $subject_type
 * @property int|null $subject_id
 * @property array<string, mixed>|null $metadata
 * @property string|null $ip_address
 * @property string|null $user_agent
 * @property Carbon|null $created_at
 */
#[UseEloquentBuilder(AuditLogBuilder::class)]
#[Fillable(['user_id', 'action', 'subject_type', 'subject_id', 'metadata', 'ip_address', 'user_agent'])]
class AuditLog extends Model
{
    /** @use HasFactory<AuditLogFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    protected static function booted(): void
    {
        $appendOnly = function (): never {
            throw new LogicException('Audit logs are append-only.');
        };

        static::updating($appendOnly);
        static::deleting($appendOnly);
    }

    /**
     * Record an audit entry. The actor defaults to the authenticated dashboard user (null = system/agent);
     * IP address and user agent are taken from the current request when there is one.
     *
     * @param  array<string, mixed>  $metadata
     */
    public static function record(string $action, ?Model $subject = null, array $metadata = [], ?User $actor = null): self
    {
        if ($actor === null) {
            $authenticated = Auth::user();
            $actor = $authenticated instanceof User ? $authenticated : null;
        }

        $request = app()->bound('request') ? app('request') : null;
        $request = $request instanceof Request ? $request : null;
        $userAgent = $request?->userAgent();

        $log = new self;
        $log->user_id = $actor?->id;
        $log->action = $action;
        $log->metadata = $metadata;
        $log->ip_address = $request?->ip();
        $log->user_agent = $userAgent === null ? null : mb_substr($userAgent, 0, 255);

        if ($subject !== null) {
            $log->subject()->associate($subject);
        }

        $log->save();

        return $log;
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'created_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return MorphTo<Model, $this>
     */
    public function subject(): MorphTo
    {
        return $this->morphTo();
    }
}
