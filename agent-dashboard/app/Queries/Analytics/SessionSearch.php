<?php

namespace App\Queries\Analytics;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;

/**
 * Paginated session list (PRD §47): sessions started in range + filters + free-text search.
 *
 * @phpstan-import-type SessionRow from SessionRows
 */
final class SessionSearch
{
    public const DEFAULT_SORT = 'started_at';

    public const MAX_PER_PAGE = 100;

    /** Public sort key => SQL column. Anything else falls back to DEFAULT_SORT. */
    public const SORTS = [
        'started_at' => 's.started_at',
        'last_activity_at' => 's.last_activity_at',
        'duration_seconds' => 's.duration_seconds',
        'actual_consumed_tokens' => 's.actual_consumed_tokens',
        'total_token_activity' => 's.total_token_activity',
        'developer' => 'dev.name',
        'project' => 'p.name',
        'model' => 'm.name',
    ];

    /**
     * Search matches a source_session_id prefix, or a substring of project name, developer name or developer email.
     *
     * @return LengthAwarePaginator<int, SessionRow>
     */
    public function paginate(UsageFilters $f, ?string $search, int $perPage = 25, string $sort = 'started_at', string $dir = 'desc'): LengthAwarePaginator
    {
        $column = self::SORTS[$sort] ?? self::SORTS[self::DEFAULT_SORT];
        $direction = strtolower($dir) === 'asc' ? 'asc' : 'desc';

        $query = SessionRows::startedIn(SessionRows::query($f), $f->range);

        $term = trim((string) $search);

        if ($term !== '') {
            $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term);

            $query->where(function ($where) use ($escaped): void {
                $where->where('s.source_session_id', 'like', $escaped.'%')
                    ->orWhere('p.name', 'like', '%'.$escaped.'%')
                    ->orWhere('dev.name', 'like', '%'.$escaped.'%')
                    ->orWhere('dev.email', 'like', '%'.$escaped.'%');
            });
        }

        /** @var LengthAwarePaginator<int, SessionRow> $page */
        $page = $query
            ->orderBy($column, $direction)
            ->orderBy('s.id', $direction)
            ->paginate(min(max(1, $perPage), self::MAX_PER_PAGE))
            ->through(fn (object $row): array => SessionRows::map($row));

        return $page;
    }
}
