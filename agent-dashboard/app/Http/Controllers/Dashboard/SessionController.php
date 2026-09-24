<?php

namespace App\Http\Controllers\Dashboard;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\ClaudeSession;
use App\Models\SessionMessage;
use App\Models\SessionUsage;
use App\Models\TrackingSetting;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\FilterOptions;
use App\Queries\Analytics\SessionSearch;
use App\Queries\Analytics\UsageFilters;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Session list and session detail (PRD §47–48). Prompt text is never part of the
 * initial page: it loads only through the optional `messages` prop on an explicit
 * partial reload, which authorizes `viewPrompts` and writes a `prompt.viewed` audit row.
 */
class SessionController extends Controller
{
    /** Sort keys the list accepts (PRD §47); anything else falls back to SessionSearch::DEFAULT_SORT. */
    public const SORTS = ['started_at', 'last_activity_at', 'duration_seconds', 'total_token_activity', 'actual_consumed_tokens'];

    public const PER_PAGE = 25;

    public const SEARCH_MAX_LENGTH = 100;

    /** Maximum usage rows returned for the per-message timeline. */
    public const TIMELINE_LIMIT = 1000;

    public function index(Request $request, SessionSearch $search, FilterOptions $options): Response
    {
        $filters = UsageFilters::fromRequest($request);

        $sort = $request->query('sort');
        $sort = is_string($sort) && in_array($sort, self::SORTS, true) ? $sort : SessionSearch::DEFAULT_SORT;
        $direction = $request->query('dir') === 'asc' ? 'asc' : 'desc';

        $term = $request->query('search');
        $term = is_string($term) ? mb_substr(trim($term), 0, self::SEARCH_MAX_LENGTH) : '';

        $page = $search->paginate($filters, $term, self::PER_PAGE, $sort, $direction);

        $statuses = ClaudeSession::query()
            ->whereIn('id', array_column($page->items(), 'id'))
            ->pluck('status', 'id');

        $sessions = new LengthAwarePaginator(
            array_map(fn (array $row): array => [...$row, 'status' => $statuses[$row['id']]?->value], $page->items()),
            $page->total(),
            $page->perPage(),
            $page->currentPage(),
            ['path' => $request->url(), 'query' => $request->query()],
        );

        return Inertia::render('Sessions/Index', [
            'sessions' => $sessions,
            'range' => $filters->range->toArray(),
            'options' => $options->for(Dimension::cases()),
            'filters' => [
                'developer' => $filters->developerId,
                'device' => $filters->deviceId,
                'account' => $filters->accountId,
                'project' => $filters->projectId,
                'model' => $filters->modelId,
                'search' => $term,
            ],
            'sort' => $sort,
            'direction' => $direction,
        ]);
    }

    public function show(Request $request, ClaudeSession $session): Response
    {
        $session->load(['developer', 'device', 'claudeAccount', 'project', 'claudeModel']);

        $timeline = $session->usage()
            ->with('claudeModel:id,name')
            ->orderBy('recorded_at')
            ->orderBy('id')
            ->limit(self::TIMELINE_LIMIT)
            ->get()
            ->map(fn (SessionUsage $usage): array => [
                'id' => $usage->id,
                'recorded_at' => self::iso($usage->recorded_at),
                'model' => $usage->claudeModel?->name,
                'is_sidechain' => $usage->is_sidechain,
                'input_tokens' => $usage->input_tokens,
                'output_tokens' => $usage->output_tokens,
                'cache_creation_tokens' => $usage->cache_creation_tokens,
                'cache_read_tokens' => $usage->cache_read_tokens,
                'actual_consumed_tokens' => $usage->actual_consumed_tokens,
                'total_token_activity' => $usage->total_token_activity,
            ])
            ->all();

        $canViewPrompts = $request->user()?->can('viewPrompts') ?? false;
        $messageCount = $canViewPrompts ? $session->messages()->count() : 0;

        return Inertia::render('Sessions/Show', [
            'session' => [
                'id' => $session->id,
                'source_session_id' => $session->source_session_id,
                'status' => $session->status->value,
                'claude_code_version' => $session->claude_code_version,
                'entrypoint' => $session->entrypoint,
                'git_branch' => $session->git_branch,
                'started_at' => self::iso($session->started_at),
                'last_activity_at' => self::iso($session->last_activity_at),
                'ended_at' => $session->ended_at === null ? null : self::iso($session->ended_at),
                'duration_seconds' => $session->duration_seconds,
                'activity_count' => $session->activity_count,
                'developer' => ['id' => $session->developer->id, 'name' => $session->developer->name],
                'device' => [
                    'id' => $session->device->id,
                    'device_uid' => $session->device->device_uid,
                    'label' => $session->device->hostname ?? $session->device->device_uid,
                ],
                'account' => $session->claudeAccount === null ? null : [
                    'id' => $session->claudeAccount->id,
                    'label' => $session->claudeAccount->email
                        ?? $session->claudeAccount->display_name
                        ?? 'Account #'.$session->claudeAccount->id,
                ],
                'project' => $session->project === null ? null : ['id' => $session->project->id, 'name' => $session->project->name],
                'model' => $session->claudeModel === null ? null : ['id' => $session->claudeModel->id, 'name' => $session->claudeModel->name],
            ],
            'totals' => [
                'input_tokens' => $session->input_tokens,
                'output_tokens' => $session->output_tokens,
                'cache_creation_tokens' => $session->cache_creation_tokens,
                'cache_read_tokens' => $session->cache_read_tokens,
                'actual_consumed_tokens' => $session->actual_consumed_tokens,
                'total_token_activity' => $session->total_token_activity,
                'message_count' => $session->usage()->count(),
            ],
            'timeline' => $timeline,
            'timeline_limit' => self::TIMELINE_LIMIT,
            'prompts' => [
                'available' => $messageCount > 0,
                'message_count' => $messageCount,
                'tracking_enabled' => $canViewPrompts && TrackingSetting::current()->prompt,
            ],
            'messages' => Inertia::optional(fn (): array => $this->messages($session)),
        ]);
    }

    /**
     * Prompt text for the session. Authorized and audited on every load; the audit row
     * carries only the message count, never content.
     *
     * @return list<array{id: int, role: string, recorded_at: string, content: string}>
     */
    private function messages(ClaudeSession $session): array
    {
        Gate::authorize('viewPrompts');

        $messages = $session->messages()
            ->orderBy('recorded_at')
            ->orderBy('id')
            ->get(['id', 'role', 'content', 'recorded_at']);

        AuditLog::record('prompt.viewed', $session, ['count' => $messages->count()]);

        return $messages->map(fn (SessionMessage $message): array => [
            'id' => $message->id,
            'role' => $message->role,
            'recorded_at' => self::iso($message->recorded_at),
            'content' => $message->content,
        ])->values()->all();
    }

    private static function iso(CarbonInterface $timestamp): string
    {
        return $timestamp->copy()->utc()->format('Y-m-d\TH:i:s\Z');
    }
}
