<?php

namespace App\Actions\Ingestion;

use App\Actions\Ingestion\Support\BatchContext;
use App\Actions\Ingestion\Support\RecordValidator;
use App\Models\SessionMessage;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * Stores prompt records (only reached when Prompt is ON) with insert-ignore: stored content is never overwritten.
 *
 * Content is encrypted exactly as SessionMessage's `encrypted` cast does, because a bulk insert bypasses casts.
 */
class UpsertMessages
{
    private const CHUNK = 200;

    /**
     * @param  array<int, array<string, mixed>>  $records  validated MessageRecords whose session resolved
     * @param  array<string, array{id: int, project_id: int|null, claude_account_id: int|null}>  $sessions
     */
    public function handle(BatchContext $ctx, array $records, array $sessions): void
    {
        foreach (array_chunk($records, self::CHUNK) as $chunk) {
            $sessionIds = [];
            $messageIds = [];

            foreach ($chunk as $record) {
                $sessionIds[] = $sessions[$record['source_session_id']]['id'];
                $messageIds[] = $record['source_message_id'];
            }

            $seen = [];

            DB::table('session_messages')
                ->whereIn('claude_session_id', array_unique($sessionIds))
                ->whereIn('source_message_id', array_unique($messageIds))
                ->get(['claude_session_id', 'source_message_id'])
                ->each(function (object $row) use (&$seen): void {
                    $seen[$row->claude_session_id.'|'.$row->source_message_id] = true;
                });

            $rows = [];

            foreach ($chunk as $i => $record) {
                $key = $sessionIds[$i].'|'.$record['source_message_id'];
                $ctx->accept(isset($seen[$key]));

                if (isset($seen[$key])) {
                    continue;
                }

                $seen[$key] = true;
                $rows[] = [
                    'claude_session_id' => $sessionIds[$i],
                    'source_message_id' => $record['source_message_id'],
                    'role' => $record['role'],
                    'content' => Crypt::encryptString($record['content']),
                    'recorded_at' => RecordValidator::parseTimestamp($record['recorded_at'])?->format('Y-m-d H:i:s.v'),
                ];
            }

            if ($rows !== []) {
                SessionMessage::query()->insertOrIgnore($rows);
            }
        }
    }
}
