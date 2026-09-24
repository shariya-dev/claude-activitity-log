<?php

namespace App\Actions\Ingestion;

use App\Actions\Ingestion\Support\BatchContext;
use App\Actions\Ingestion\Support\RecordValidator;
use App\Actions\Ingestion\Support\Upsert;
use App\Models\ClaudeModel;
use App\Models\SessionUsage;
use App\Support\OrgClock;
use App\Support\TokenMath;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Upserts usage records (one row per Claude API message) on (claude_session_id, source_message_id).
 *
 * Raw token columns merge with GREATEST, so a partial/split message never lowers a stored value. The stored row is
 * read first so the merged raw values are known in PHP; the calc columns are then produced by TokenMath from those
 * merged values and written in the same upsert statement. recorded_at keeps the earliest line timestamp.
 */
class UpsertUsage
{
    private const CHUNK = 500;

    private const TOKENS = ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens'];

    /**
     * @param  array<int, array<string, mixed>>  $records  validated UsageRecords whose session resolved
     * @param  array<string, array{id: int, project_id: int|null, claude_account_id: int|null}>  $sessions
     */
    public function handle(BatchContext $ctx, array $records, array $sessions): void
    {
        $merged = [];

        foreach ($records as $record) {
            $sessionId = $sessions[$record['source_session_id']]['id'];
            $key = $sessionId.'|'.$record['source_message_id'];
            $merged[$key] = isset($merged[$key]) ? $this->merge($merged[$key], $record) : $record + ['claude_session_id' => $sessionId];
        }

        $counted = [];

        foreach (array_chunk($merged, self::CHUNK, true) as $chunk) {
            $existing = $this->stored($chunk);
            $rows = [];

            foreach ($chunk as $key => $record) {
                $session = $sessions[$record['source_session_id']];
                $old = $existing[$key] ?? null;
                $raw = [];

                foreach (self::TOKENS as $column) {
                    $raw[$column] = max((int) $record[$column], (int) ($old[$column] ?? 0));
                }

                $recordedAt = RecordValidator::parseTimestamp($record['recorded_at']);
                assert($recordedAt instanceof CarbonImmutable);

                if ($old !== null && $old['recorded_at']->lessThan($recordedAt)) {
                    $recordedAt = $old['recorded_at'];
                }

                $recordedOn = OrgClock::dateFor($recordedAt);
                $modelId = $record['model'] !== null ? ClaudeModel::idFor($record['model']) : ($old['claude_model_id'] ?? null);

                $rows[] = [
                    'claude_session_id' => $session['id'],
                    'source_message_id' => $record['source_message_id'],
                    'request_id' => $record['request_id'] ?? ($old['request_id'] ?? null),
                    'is_sidechain' => $record['is_sidechain'],
                    'claude_model_id' => $modelId,
                    'device_id' => $ctx->device->id,
                    'developer_id' => $ctx->device->developer_id,
                    'project_id' => $session['project_id'],
                    'claude_account_id' => $session['claude_account_id'],
                    ...$raw,
                    ...TokenMath::forRow($raw),
                    'recorded_at' => $recordedAt->format('Y-m-d H:i:s.v'),
                    'recorded_on' => $recordedOn,
                    'created_at' => $ctx->now,
                    'updated_at' => $ctx->now,
                ];

                $counted[$key] = $old !== null;
                $ctx->touchSession($session['id']);
                $ctx->touchDate($ctx->device->id, $recordedOn);

                if ($old !== null && $old['recorded_on'] !== $recordedOn) {
                    $ctx->touchDate($ctx->device->id, $old['recorded_on']);
                }
            }

            SessionUsage::query()->upsert($rows, ['claude_session_id', 'source_message_id'], [
                'input_tokens' => Upsert::greatest('input_tokens'),
                'output_tokens' => Upsert::greatest('output_tokens'),
                'cache_creation_tokens' => Upsert::greatest('cache_creation_tokens'),
                'cache_read_tokens' => Upsert::greatest('cache_read_tokens'),
                'actual_consumed_tokens',
                'total_token_activity',
                'request_id',
                'is_sidechain',
                'claude_model_id',
                'project_id',
                'claude_account_id',
                'recorded_at',
                'recorded_on',
                'updated_at',
            ]);
        }

        // Every input record counts once; a duplicate within the batch counts as an update of the first copy.
        $seen = [];

        foreach ($records as $record) {
            $key = $sessions[$record['source_session_id']]['id'].'|'.$record['source_message_id'];
            $ctx->accept($counted[$key] || isset($seen[$key]));
            $seen[$key] = true;
        }
    }

    /**
     * Merge two copies of the same message inside one batch: per-field max for tokens, earliest timestamp,
     * latest non-null for the rest (the agent already merges split lines; this keeps the backend safe regardless).
     *
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $b
     * @return array<string, mixed>
     */
    private function merge(array $a, array $b): array
    {
        foreach (self::TOKENS as $column) {
            $a[$column] = max((int) $a[$column], (int) $b[$column]);
        }

        $aAt = RecordValidator::parseTimestamp($a['recorded_at']);
        $bAt = RecordValidator::parseTimestamp($b['recorded_at']);

        if ($aAt !== null && $bAt !== null && $bAt->lessThan($aAt)) {
            $a['recorded_at'] = $b['recorded_at'];
        }

        $a['model'] = $b['model'] ?? $a['model'];
        $a['request_id'] = $b['request_id'] ?? $a['request_id'];
        $a['is_sidechain'] = $b['is_sidechain'];

        return $a;
    }

    /**
     * @param  array<string, array<string, mixed>>  $chunk
     * @return array<string, array{input_tokens: int, output_tokens: int, cache_creation_tokens: int, cache_read_tokens: int, recorded_at: CarbonImmutable, recorded_on: string, claude_model_id: int|null, request_id: string|null}>
     */
    private function stored(array $chunk): array
    {
        $sessionIds = array_values(array_unique(array_column($chunk, 'claude_session_id')));
        $messageIds = array_values(array_unique(array_column($chunk, 'source_message_id')));

        $rows = DB::table('session_usage')
            ->whereIn('claude_session_id', $sessionIds)
            ->whereIn('source_message_id', $messageIds)
            ->get(['claude_session_id', 'source_message_id', ...self::TOKENS, 'recorded_at', 'recorded_on', 'claude_model_id', 'request_id']);

        $stored = [];

        foreach ($rows as $row) {
            $key = $row->claude_session_id.'|'.$row->source_message_id;

            if (! isset($chunk[$key])) {
                continue;
            }

            $stored[$key] = [
                'input_tokens' => (int) $row->input_tokens,
                'output_tokens' => (int) $row->output_tokens,
                'cache_creation_tokens' => (int) $row->cache_creation_tokens,
                'cache_read_tokens' => (int) $row->cache_read_tokens,
                'recorded_at' => CarbonImmutable::parse((string) $row->recorded_at, 'UTC'),
                'recorded_on' => substr((string) $row->recorded_on, 0, 10),
                'claude_model_id' => $row->claude_model_id !== null ? (int) $row->claude_model_id : null,
                'request_id' => $row->request_id !== null ? (string) $row->request_id : null,
            ];
        }

        return $stored;
    }
}
