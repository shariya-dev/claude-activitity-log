<?php

namespace App\Http\Controllers\Dashboard;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\PairingCode;
use App\Models\Project;
use App\Models\SessionMessage;
use App\Models\TrackingSetting;
use App\Models\User;
use App\Support\OrgClock;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Read-only, append-only audit trail viewer. There is deliberately no update/delete action.
 */
class AuditLogController extends Controller
{
    private const int PER_PAGE = 50;

    /**
     * Auditable subject types by short name, with the dashboard route that shows them (null = not routable).
     *
     * @var array<string, array{0: class-string<Model>, 1: string|null}>
     */
    private const array SUBJECTS = [
        'ClaudeSession' => [ClaudeSession::class, 'sessions.show'],
        'Developer' => [Developer::class, 'developers.show'],
        'Device' => [Device::class, 'devices.show'],
        'PairingCode' => [PairingCode::class, null],
        'Project' => [Project::class, 'projects.show'],
        'SessionMessage' => [SessionMessage::class, null],
        'TrackingSetting' => [TrackingSetting::class, 'tracking-settings.edit'],
        'User' => [User::class, 'users.index'],
    ];

    public function index(Request $request): Response
    {
        $filters = $request->validate([
            'action' => ['nullable', 'string', 'max:64'],
            'actor' => ['nullable', 'integer'],
            'subject_type' => ['nullable', Rule::in(array_keys(self::SUBJECTS))],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);

        $filters = [
            'action' => $filters['action'] ?? null,
            'actor' => isset($filters['actor']) ? (int) $filters['actor'] : null,
            'subject_type' => $filters['subject_type'] ?? null,
            'from' => $filters['from'] ?? null,
            'to' => $filters['to'] ?? null,
        ];

        $logs = AuditLog::query()
            ->with(['user:id,name', 'subject'])
            ->when($filters['action'], fn (Builder $query, string $action) => $query->where('action', $action))
            ->when($filters['actor'], fn (Builder $query, int $actor) => $query->where('user_id', $actor))
            ->when($filters['subject_type'], fn (Builder $query, string $type) => $query->where('subject_type', self::SUBJECTS[$type][0]))
            ->when($filters['from'], fn (Builder $query, string $from) => $query->where('created_at', '>=', OrgClock::startOfDayUtc($from)))
            ->when($filters['to'], fn (Builder $query, string $to) => $query->where('created_at', '<', OrgClock::startOfDayUtc($to)->addDay()))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString()
            ->through(fn (AuditLog $log): array => $this->row($log));

        return Inertia::render('Admin/AuditLogs', [
            'logs' => $logs,
            'filters' => $filters,
            'options' => $this->options(),
        ]);
    }

    /**
     * @return array{id: int, created_at: string|null, actor: array{id: int, name: string}|null, action: string, subject: array{type: string, id: int|null, label: string, url: string|null}|null, ip_address: string|null, metadata: array<string, mixed>|null}
     */
    private function row(AuditLog $log): array
    {
        /** @var User|null $actor */
        $actor = $log->user;

        return [
            'id' => $log->id,
            'created_at' => $log->created_at?->toIso8601String(),
            'actor' => $actor === null ? null : ['id' => $actor->id, 'name' => $actor->name],
            'action' => $log->action,
            'subject' => $this->subject($log),
            'ip_address' => $log->ip_address,
            'metadata' => $log->metadata === [] ? null : $log->metadata,
        ];
    }

    /**
     * @return array{type: string, id: int|null, label: string, url: string|null}|null
     */
    private function subject(AuditLog $log): ?array
    {
        if ($log->subject_type === null) {
            return null;
        }

        $type = class_basename($log->subject_type);
        $routeName = self::SUBJECTS[$type][1] ?? null;
        $subject = $log->subject;
        $url = null;

        if ($subject instanceof Model && $routeName !== null && Route::has($routeName)) {
            $url = in_array($routeName, ['tracking-settings.edit', 'users.index'], true)
                ? route($routeName)
                : route($routeName, $subject);
        }

        return [
            'type' => $type,
            'id' => $log->subject_id,
            'label' => $this->label($type, $subject, $log->subject_id),
            'url' => $url,
        ];
    }

    private function label(string $type, ?Model $subject, ?int $id): string
    {
        $name = match (true) {
            $subject instanceof User, $subject instanceof Developer, $subject instanceof Project => $subject->name,
            $subject instanceof Device => $subject->hostname,
            default => null,
        };

        return $name !== null && $name !== '' ? "{$type}: {$name}" : trim("{$type} #{$id}");
    }

    /**
     * @return array{actions: list<string>, actors: list<array{id: int, name: string}>, subjectTypes: list<array{value: string, label: string}>}
     */
    private function options(): array
    {
        /** @var list<string> $actions */
        $actions = AuditLog::query()->distinct()->orderBy('action')->pluck('action')->all();

        $actorIds = AuditLog::query()->whereNotNull('user_id')->distinct()->pluck('user_id');

        /** @var list<array{id: int, name: string}> $actors */
        $actors = User::query()
            ->whereIn('id', $actorIds)
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (User $user): array => ['id' => $user->id, 'name' => $user->name])
            ->all();

        /** @var list<array{value: string, label: string}> $subjectTypes */
        $subjectTypes = AuditLog::query()
            ->whereNotNull('subject_type')
            ->distinct()
            ->pluck('subject_type')
            ->map(fn (string $class): string => class_basename($class))
            ->filter(fn (string $type): bool => isset(self::SUBJECTS[$type]))
            ->sort()
            ->values()
            ->map(fn (string $type): array => ['value' => $type, 'label' => $type])
            ->all();

        return ['actions' => $actions, 'actors' => $actors, 'subjectTypes' => $subjectTypes];
    }
}
