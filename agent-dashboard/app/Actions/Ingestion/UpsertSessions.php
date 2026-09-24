<?php

namespace App\Actions\Ingestion;

use App\Actions\Ingestion\Support\BatchContext;
use App\Actions\Ingestion\Support\RecordValidator;
use App\Actions\Ingestion\Support\Upsert;
use App\Enums\SessionStatus;
use App\Models\ClaudeModel;
use App\Models\ClaudeSession;
use Illuminate\Support\Facades\DB;

/**
 * Resolves session references, then upserts sessions on (device_id, source_session_id).
 *
 * started_at = LEAST, last_activity_at = GREATEST, other fields take the latest non-null value. When a stored
 * session moves to another project or account, its usage rows follow and the affected days are re-rolled.
 */
class UpsertSessions
{
    /**
     * @param  array<int, array<string, mixed>>  $records  validated SessionRecords
     * @param  array<string, int>  $accountIds  account_key => id, accepted in this batch
     * @param  array<string, int>  $projectIds  project_key => id, accepted in this batch
     * @param  array<string, true>  $rejectedAccountKeys
     * @param  array<string, true>  $rejectedProjectKeys
     * @return array{0: array<string, array{id: int, project_id: int|null, claude_account_id: int|null}>, 1: array<string, true>} stored sessions by source id, and rejected source ids
     */
    public function handle(
        BatchContext $ctx,
        array $records,
        array $accountIds,
        array $projectIds,
        array $rejectedAccountKeys,
        array $rejectedProjectKeys,
    ): array {
        $rejected = [];

        if ($records === []) {
            return [[], $rejected];
        }

        $projectIds += $this->lookup('projects', 'project_key', $this->missing($records, 'project_key', $projectIds, $rejectedProjectKeys));
        $accountIds += $this->lookup('claude_accounts', 'account_key', $this->missing($records, 'account_key', $accountIds, $rejectedAccountKeys), $ctx->device->developer_id);

        $accepted = [];

        foreach ($records as $index => $record) {
            $projectKey = $record['project_key'];
            $accountKey = $record['account_key'];

            $reason = match (true) {
                $projectKey !== null && ! isset($projectIds[$projectKey]) => 'unknown_project',
                $accountKey !== null && ! isset($accountIds[$accountKey]) => 'unknown_account',
                default => null,
            };

            if ($reason !== null) {
                $ctx->rejectRecord('session', $record, $index, $reason);
                $rejected[$record['source_session_id']] = true;

                continue;
            }

            $accepted[] = $record;
        }

        // Dependants only fail on a session id when no copy of it was accepted.
        foreach ($accepted as $record) {
            unset($rejected[$record['source_session_id']]);
        }

        return [$this->store($ctx, $accepted, $accountIds, $projectIds), $rejected];
    }

    /**
     * @param  list<array<string, mixed>>  $records
     * @param  array<string, int>  $accountIds
     * @param  array<string, int>  $projectIds
     * @return array<string, array{id: int, project_id: int|null, claude_account_id: int|null}>
     */
    private function store(BatchContext $ctx, array $records, array $accountIds, array $projectIds): array
    {
        if ($records === []) {
            return [];
        }

        $device = $ctx->device;
        $sourceIds = array_values(array_unique(array_column($records, 'source_session_id')));
        $existing = $this->stored($device->id, $sourceIds);

        $rows = [];
        $final = [];

        foreach ($records as $record) {
            $sourceId = $record['source_session_id'];
            $ctx->accept(isset($existing[$sourceId]) || isset($final[$sourceId]));

            $startedAt = RecordValidator::parseTimestamp($record['first_seen_at']);
            $lastActivityAt = RecordValidator::parseTimestamp($record['last_seen_at']);
            $projectId = $record['project_key'] !== null ? $projectIds[$record['project_key']] : null;
            $accountId = $record['account_key'] !== null ? $accountIds[$record['account_key']] : null;

            $rows[] = [
                'device_id' => $device->id,
                'developer_id' => $device->developer_id,
                'claude_account_id' => $accountId,
                'project_id' => $projectId,
                'claude_model_id' => $record['model'] !== null ? ClaudeModel::idFor($record['model']) : null,
                'source_session_id' => $sourceId,
                'started_at' => $startedAt,
                'last_activity_at' => $lastActivityAt,
                'ended_at' => RecordValidator::parseTimestamp($record['ended_at']),
                'duration_seconds' => 0,
                'status' => SessionStatus::Active->value,
                'claude_code_version' => $record['claude_code_version'],
                'entrypoint' => $record['entrypoint'],
                'git_branch' => $record['git_branch'],
                'created_at' => $ctx->now,
                'updated_at' => $ctx->now,
            ];

            // Mirror the COALESCE(new, old) merge so dimension changes are known before writing.
            $previous = $final[$sourceId] ?? $existing[$sourceId] ?? ['project_id' => null, 'claude_account_id' => null];
            $final[$sourceId] = [
                'project_id' => $projectId ?? $previous['project_id'],
                'claude_account_id' => $accountId ?? $previous['claude_account_id'],
            ];
        }

        ClaudeSession::query()->upsert($rows, ['device_id', 'source_session_id'], [
            'started_at' => Upsert::least('started_at'),
            'last_activity_at' => Upsert::greatest('last_activity_at'),
            'ended_at' => Upsert::latestNonNull('ended_at'),
            'claude_account_id' => Upsert::latestNonNull('claude_account_id'),
            'project_id' => Upsert::latestNonNull('project_id'),
            'claude_model_id' => Upsert::latestNonNull('claude_model_id'),
            'claude_code_version' => Upsert::latestNonNull('claude_code_version'),
            'entrypoint' => Upsert::latestNonNull('entrypoint'),
            'git_branch' => Upsert::latestNonNull('git_branch'),
            'updated_at',
        ]);

        $stored = $this->stored($device->id, $sourceIds);
        $moved = [];

        foreach ($stored as $sourceId => $session) {
            $ctx->touchSession($session['id']);
            $ctx->touchProject($session['project_id']);

            $before = $existing[$sourceId] ?? null;

            if ($before !== null && ($before['project_id'] !== $session['project_id'] || $before['claude_account_id'] !== $session['claude_account_id'])) {
                $ctx->touchProject($before['project_id']);
                $moved[] = $session['id'];
            }
        }

        $this->moveUsageDimensions($ctx, $moved);

        return $stored;
    }

    /**
     * Re-point stored usage rows of sessions whose project/account changed, and re-roll their days.
     *
     * @param  list<int>  $sessionIds
     */
    private function moveUsageDimensions(BatchContext $ctx, array $sessionIds): void
    {
        if ($sessionIds === []) {
            return;
        }

        $in = implode(',', array_fill(0, count($sessionIds), '?'));

        DB::update(
            "UPDATE session_usage su JOIN claude_sessions s ON s.id = su.claude_session_id
             SET su.project_id = s.project_id, su.claude_account_id = s.claude_account_id, su.updated_at = ?
             WHERE su.claude_session_id IN ({$in})",
            [$ctx->now, ...$sessionIds],
        );

        $days = DB::table('session_usage')->whereIn('claude_session_id', $sessionIds)->distinct()->pluck('recorded_on');

        foreach ($days as $day) {
            $ctx->touchDate($ctx->device->id, (string) $day);
        }
    }

    /**
     * @param  list<string>  $sourceIds
     * @return array<string, array{id: int, project_id: int|null, claude_account_id: int|null}>
     */
    private function stored(int $deviceId, array $sourceIds): array
    {
        $sessions = [];

        foreach (array_chunk($sourceIds, 1000) as $chunk) {
            $rows = DB::table('claude_sessions')
                ->where('device_id', $deviceId)
                ->whereIn('source_session_id', $chunk)
                ->get(['id', 'source_session_id', 'project_id', 'claude_account_id']);

            foreach ($rows as $row) {
                $sessions[(string) $row->source_session_id] = [
                    'id' => (int) $row->id,
                    'project_id' => $row->project_id !== null ? (int) $row->project_id : null,
                    'claude_account_id' => $row->claude_account_id !== null ? (int) $row->claude_account_id : null,
                ];
            }
        }

        return $sessions;
    }

    /**
     * Keys referenced by sessions that are neither accepted in this batch nor rejected in it (so they may be stored).
     *
     * @param  array<int, array<string, mixed>>  $records
     * @param  array<string, int>  $known
     * @param  array<string, true>  $rejected
     * @return list<string>
     */
    private function missing(array $records, string $field, array $known, array $rejected): array
    {
        $keys = [];

        foreach ($records as $record) {
            $key = $record[$field];

            if ($key !== null && ! isset($known[$key]) && ! isset($rejected[$key])) {
                $keys[$key] = $key;
            }
        }

        return array_values($keys);
    }

    /**
     * @param  list<string>  $keys
     * @return array<string, int>
     */
    private function lookup(string $table, string $keyColumn, array $keys, ?int $developerId = null): array
    {
        if ($keys === []) {
            return [];
        }

        return DB::table($table)
            ->when($developerId !== null, fn ($query) => $query->where('developer_id', $developerId))
            ->whereIn($keyColumn, $keys)
            ->pluck('id', $keyColumn)
            ->map(fn ($id): int => (int) $id)
            ->all();
    }
}
