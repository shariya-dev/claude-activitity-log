<?php

namespace App\Actions\Ingestion;

use App\Actions\Ingestion\Exceptions\BatchInProgressException;
use App\Actions\Ingestion\Exceptions\PersistenceFailedException;
use App\Actions\Ingestion\Support\BatchContext;
use App\Actions\Ingestion\Support\RecordValidator;
use App\Actions\Ingestion\Support\Upsert;
use App\Enums\SyncBatchStatus;
use App\Enums\SyncHealth;
use App\Models\AgentSyncState;
use App\Models\Device;
use App\Models\SyncBatch;
use App\Models\TrackingSetting;
use App\Support\OrgClock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * POST /sync ingestion (docs/contracts/sync-api-v1.md §3.4, §8).
 *
 * 1. A short transaction claims the (device, batch_id) row: succeeded ⇒ replay the stored response;
 *    processing and younger than 2 min ⇒ 409; otherwise mark it processing.
 * 2. One data transaction, holding the device row lock: gate categories, validate records, upsert
 *    accounts → projects → sessions → usage → messages, recompute session/project totals and daily rollups,
 *    then update device, sync state and batch. Any exception rolls all of it back.
 * 3. On failure the batch and sync state are marked failed outside the rolled-back transaction.
 *
 * created/updated: each accepted record is "updated" when its unique key was already stored (or appeared earlier
 * in the same batch), otherwise "created". The stored keys are read in the same transaction before each upsert.
 * This is used instead of MySQL upsert affected-rows (1 insert / 2 update / 0 unchanged) because the affected-rows
 * total cannot separate created rows from unchanged matches, and the contract counts unchanged matches as updated.
 */
class IngestSyncBatch
{
    public const STALE_PROCESSING_SECONDS = 120;

    /** Retries on deadlock: shared rows (projects, models) can be locked by another device's batch. */
    private const TRANSACTION_ATTEMPTS = 3;

    public function __construct(
        private readonly GateCategories $gate,
        private readonly UpsertAccounts $accounts,
        private readonly UpsertProjects $projects,
        private readonly UpsertSessions $sessions,
        private readonly UpsertUsage $usage,
        private readonly UpsertMessages $messages,
        private readonly RecomputeSessionTotals $sessionTotals,
        private readonly RefreshProjectTotals $projectTotals,
        private readonly RefreshDailyRollups $rollups,
    ) {}

    /**
     * @param  array<string, mixed>  $validated  envelope-validated sync request body
     * @return array<string, mixed> contract success response body
     *
     * @throws BatchInProgressException
     * @throws PersistenceFailedException
     */
    public function handle(Device $device, array $validated, int $payloadBytes = 0): array
    {
        $started = hrtime(true);
        $batchId = (string) $validated['sync']['batch_id'];

        try {
            $replay = $this->claim($device, $batchId, (bool) $validated['sync']['is_initial'], $payloadBytes);
        } catch (BatchInProgressException $e) {
            throw $e;
        } catch (Throwable $e) {
            Log::error('sync.claim_failed', ['device' => $device->device_uid, 'batch_id' => $batchId, 'exception' => $e::class]);

            throw new PersistenceFailedException('The sync batch could not be claimed.', previous: $e);
        }

        if ($replay !== null) {
            return $replay;
        }

        try {
            return DB::transaction(fn (): array => $this->ingest($device, $validated, $started), self::TRANSACTION_ATTEMPTS);
        } catch (Throwable $e) {
            $this->recordFailure($device, $batchId, $e, $started);

            throw new PersistenceFailedException('The sync batch could not be persisted.', previous: $e);
        }
    }

    /**
     * @return array<string, mixed>|null the stored response when the batch already succeeded
     */
    private function claim(Device $device, string $batchId, bool $isInitial, int $payloadBytes): ?array
    {
        return DB::transaction(function () use ($device, $batchId, $isInitial, $payloadBytes): ?array {
            $now = OrgClock::now();

            $inserted = SyncBatch::query()->insertOrIgnore([
                'device_id' => $device->id,
                'batch_uuid' => $batchId,
                'status' => SyncBatchStatus::Processing->value,
                'is_initial' => $isInitial,
                'payload_bytes' => $payloadBytes,
                'received_at' => $now,
            ]);

            $batch = SyncBatch::query()
                ->where('device_id', $device->id)
                ->where('batch_uuid', $batchId)
                ->lockForUpdate()
                ->firstOrFail();

            if ($inserted === 1) {
                return null;
            }

            if ($batch->status === SyncBatchStatus::Succeeded) {
                /** @var array<string, mixed> $response */
                $response = $batch->response ?? [];

                return $response;
            }

            if ($batch->status === SyncBatchStatus::Processing
                && $batch->received_at->greaterThan($now->subSeconds(self::STALE_PROCESSING_SECONDS))) {
                throw new BatchInProgressException('Batch is already being processed.');
            }

            $batch->forceFill([
                'status' => SyncBatchStatus::Processing,
                'is_initial' => $isInitial,
                'payload_bytes' => $payloadBytes,
                'error_code' => null,
                'received_at' => $now,
                'completed_at' => null,
            ])->save();

            return null;
        });
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function ingest(Device $device, array $payload, int $started): array
    {
        $device = Device::query()->whereKey($device->id)->lockForUpdate()->firstOrFail();
        $ctx = new BatchContext($device, TrackingSetting::current(), OrgClock::now());

        $records = $this->gate->handle($ctx, $payload);

        [$accounts, $rejectedAccountKeys] = $this->validate($ctx, 'account', $records['accounts']);
        [$projects, $rejectedProjectKeys] = $this->validate($ctx, 'project', $records['projects']);
        [$sessions, $rejectedSessionIds] = $this->validate($ctx, 'session', $records['sessions']);

        $accountIds = $this->accounts->handle($ctx, $accounts);
        $projectIds = $this->projects->handle($ctx, $projects);

        [$storedSessions, $unresolvedSessionIds] = $this->sessions->handle($ctx, $sessions, $accountIds, $projectIds, $rejectedAccountKeys, $rejectedProjectKeys);
        $rejectedSessionIds += $unresolvedSessionIds;

        foreach ($storedSessions as $sourceId => $session) {
            unset($rejectedSessionIds[$sourceId]);
        }

        [$usage] = $this->validate($ctx, 'usage', $records['usage']);
        [$messages] = $this->validate($ctx, 'message', $records['messages']);

        $storedSessions += $this->lookupSessions($device, [...$usage, ...$messages], $storedSessions, $rejectedSessionIds);

        $this->usage->handle($ctx, $this->resolved($ctx, 'usage', $usage, $storedSessions), $storedSessions);
        $this->messages->handle($ctx, $this->resolved($ctx, 'message', $messages, $storedSessions), $storedSessions);

        $this->sessionTotals->handle(array_values($ctx->touchedSessionIds));
        $this->projectTotals->handle(array_values($ctx->touchedProjectIds));
        $this->rollups->handle(array_values($ctx->rollupPairs));

        return $this->finish($ctx, $payload, $started);
    }

    /**
     * Field-level validation. Returns the storable records and the ids of rejected ones (for dependency checks).
     *
     * @param  'account'|'project'|'session'|'usage'|'message'  $type
     * @param  array<int, mixed>  $records
     * @return array{0: array<int, array<string, mixed>>, 1: array<string, true>}
     */
    private function validate(BatchContext $ctx, string $type, array $records): array
    {
        $valid = [];
        $rejectedIds = [];
        $idField = BatchContext::SOURCE_ID_FIELDS[$type];

        foreach ($records as $index => $record) {
            $reason = RecordValidator::reason($type, $record, $ctx->now);

            if ($reason === null) {
                /** @var array<string, mixed> $record */
                $valid[$index] = $record;

                continue;
            }

            $ctx->rejectRecord($type, $record, $index, $reason);

            if (is_array($record) && is_string($record[$idField] ?? null)) {
                $rejectedIds[$record[$idField]] = true;
            }
        }

        foreach ($valid as $record) {
            unset($rejectedIds[$record[$idField]]);
        }

        return [$valid, $rejectedIds];
    }

    /**
     * Sessions referenced by usage/messages but not sent in this batch are resolved from the DB (contract §4.6),
     * unless the batch rejected them.
     *
     * @param  array<int, array<string, mixed>>  $records
     * @param  array<string, array{id: int, project_id: int|null, claude_account_id: int|null}>  $known
     * @param  array<string, true>  $rejected
     * @return array<string, array{id: int, project_id: int|null, claude_account_id: int|null}>
     */
    private function lookupSessions(Device $device, array $records, array $known, array $rejected): array
    {
        $missing = [];

        foreach ($records as $record) {
            $sourceId = $record['source_session_id'];

            if (! isset($known[$sourceId]) && ! isset($rejected[$sourceId])) {
                $missing[$sourceId] = $sourceId;
            }
        }

        $found = [];

        foreach (array_chunk(array_values($missing), 1000) as $chunk) {
            $rows = DB::table('claude_sessions')
                ->where('device_id', $device->id)
                ->whereIn('source_session_id', $chunk)
                ->get(['id', 'source_session_id', 'project_id', 'claude_account_id']);

            foreach ($rows as $row) {
                $found[(string) $row->source_session_id] = [
                    'id' => (int) $row->id,
                    'project_id' => $row->project_id !== null ? (int) $row->project_id : null,
                    'claude_account_id' => $row->claude_account_id !== null ? (int) $row->claude_account_id : null,
                ];
            }
        }

        return $found;
    }

    /**
     * Drop (and reject as unknown_session) records whose session is not stored.
     *
     * @param  'usage'|'message'  $type
     * @param  array<int, array<string, mixed>>  $records
     * @param  array<string, array{id: int, project_id: int|null, claude_account_id: int|null}>  $sessions
     * @return array<int, array<string, mixed>>
     */
    private function resolved(BatchContext $ctx, string $type, array $records, array $sessions): array
    {
        foreach ($records as $index => $record) {
            if (! isset($sessions[$record['source_session_id']])) {
                $ctx->rejectRecord($type, $record, $index, 'unknown_session');
                unset($records[$index]);
            }
        }

        return $records;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function finish(BatchContext $ctx, array $payload, int $started): array
    {
        $device = $ctx->device;
        $agent = $payload['agent'];
        $sync = $payload['sync'];
        $batchId = (string) $sync['batch_id'];
        $sequence = (int) $sync['sequence'];

        $cursor = rtrim(strtr(base64_encode((string) json_encode([
            'sequence' => $sequence,
            'batch_id' => $batchId,
            'acked_at' => $ctx->now->format('Y-m-d\TH:i:s\Z'),
        ], JSON_UNESCAPED_SLASHES)), '+/', '-_'), '=');

        $response = [
            'success' => true,
            'batch_id' => $batchId,
            'sync' => [
                'accepted' => $ctx->accepted(),
                'created' => $ctx->created,
                'updated' => $ctx->updated,
                'rejected' => $ctx->rejected,
            ],
            'rejected_records' => $ctx->rejections,
            'cursor' => $cursor,
            'settings_version' => (int) $ctx->settings->version,
            'server_time' => $ctx->now->format('Y-m-d\TH:i:s\Z'),
        ];

        $device->forceFill([
            'last_sync_at' => $ctx->now,
            'agent_version' => $agent['agent_version'],
            'platform_version' => $agent['platform_version'] ?? $device->platform_version,
            'claude_code_version' => $agent['claude_code_version'] ?? $device->claude_code_version,
        ])->save();

        AgentSyncState::query()->upsert([[
            'device_id' => $device->id,
            'cursor' => $cursor,
            'sequence' => $sequence,
            'last_batch_uuid' => $batchId,
            'last_success_at' => $ctx->now,
            'consecutive_failures' => 0,
            'records_created_total' => $ctx->created,
            'records_updated_total' => $ctx->updated,
            'records_rejected_total' => $ctx->rejected,
            'health' => SyncHealth::Healthy->value,
            'created_at' => $ctx->now,
            'updated_at' => $ctx->now,
        ]], ['device_id'], [
            'cursor', 'sequence', 'last_batch_uuid', 'last_success_at', 'consecutive_failures', 'health', 'updated_at',
            'records_created_total' => Upsert::increment('records_created_total'),
            'records_updated_total' => Upsert::increment('records_updated_total'),
            'records_rejected_total' => Upsert::increment('records_rejected_total'),
        ]);

        SyncBatch::query()
            ->where('device_id', $device->id)
            ->where('batch_uuid', $batchId)
            ->update([
                'status' => SyncBatchStatus::Succeeded->value,
                'accepted' => $ctx->accepted(),
                'created' => $ctx->created,
                'updated' => $ctx->updated,
                'rejected' => $ctx->rejected,
                'rejections' => json_encode($ctx->rejections, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'response' => json_encode($response, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'duration_ms' => $this->elapsedMs($started),
                'completed_at' => $ctx->now,
            ]);

        return $response;
    }

    /**
     * Runs after the data transaction rolled back. Never logs the exception message: a query error can carry
     * bound values such as prompt content.
     */
    private function recordFailure(Device $device, string $batchId, Throwable $e, int $started): void
    {
        $now = OrgClock::now();

        Log::error('sync.persistence_failed', [
            'device' => $device->device_uid,
            'batch_id' => $batchId,
            'exception' => $e::class,
            'code' => $e->getCode(),
        ]);

        try {
            SyncBatch::query()
                ->where('device_id', $device->id)
                ->where('batch_uuid', $batchId)
                ->update([
                    'status' => SyncBatchStatus::Failed->value,
                    'error_code' => 'persistence_failed',
                    'duration_ms' => $this->elapsedMs($started),
                    'completed_at' => $now,
                ]);

            AgentSyncState::query()->upsert([[
                'device_id' => $device->id,
                'last_failure_at' => $now,
                'last_error_code' => 'persistence_failed',
                'last_error_message' => 'The sync batch could not be persisted ('.class_basename($e).').',
                'consecutive_failures' => 1,
                'health' => SyncHealth::SyncFailed->value,
                'created_at' => $now,
                'updated_at' => $now,
            ]], ['device_id'], [
                'last_failure_at', 'last_error_code', 'last_error_message', 'health', 'updated_at',
                'consecutive_failures' => Upsert::increment('consecutive_failures'),
            ]);
        } catch (Throwable $recordingError) {
            Log::error('sync.failure_not_recorded', ['device' => $device->device_uid, 'exception' => $recordingError::class]);
        }
    }

    private function elapsedMs(int $started): int
    {
        return (int) round((hrtime(true) - $started) / 1_000_000);
    }
}
