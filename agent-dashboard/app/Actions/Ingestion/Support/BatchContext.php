<?php

namespace App\Actions\Ingestion\Support;

use App\Models\Device;
use App\Models\TrackingSetting;
use Carbon\CarbonImmutable;

/**
 * Mutable state of one sync batch while it is being ingested: counts, rejections and what needs recomputing.
 */
final class BatchContext
{
    public const REJECTION_LIST_LIMIT = 100;

    public const SOURCE_ID_FIELDS = [
        'account' => 'account_key',
        'project' => 'project_key',
        'session' => 'source_session_id',
        'usage' => 'source_message_id',
        'message' => 'source_message_id',
    ];

    private const SOURCE_ID_MAX_LENGTH = 255;

    public int $created = 0;

    public int $updated = 0;

    public int $rejected = 0;

    /** @var list<array{type: string, source_id: string, reason: string}> */
    public array $rejections = [];

    /** @var array<int, int> */
    public array $touchedSessionIds = [];

    /** @var array<int, int> */
    public array $touchedProjectIds = [];

    /** @var array<string, array{0: int, 1: string}> */
    public array $rollupPairs = [];

    public function __construct(
        public readonly Device $device,
        public readonly TrackingSetting $settings,
        public readonly CarbonImmutable $now,
    ) {}

    /**
     * Reject a record, identifying it per contract §4.6: its id field, or `#<index>` when that is not a string.
     */
    public function rejectRecord(string $type, mixed $record, int|string $index, string $reason): void
    {
        $field = self::SOURCE_ID_FIELDS[$type];
        $sourceId = is_array($record) && is_string($record[$field] ?? null) && $record[$field] !== ''
            ? mb_substr($record[$field], 0, self::SOURCE_ID_MAX_LENGTH)
            : '#'.$index;

        $this->reject($type, $sourceId, $reason);
    }

    public function reject(string $type, string $sourceId, string $reason): void
    {
        $this->rejected++;

        if (count($this->rejections) < self::REJECTION_LIST_LIMIT) {
            $this->rejections[] = ['type' => $type, 'source_id' => $sourceId, 'reason' => $reason];
        }
    }

    /**
     * Count one accepted record: created when its unique key was not stored before, updated otherwise.
     */
    public function accept(bool $existed): void
    {
        $existed ? $this->updated++ : $this->created++;
    }

    public function touchSession(int $sessionId): void
    {
        $this->touchedSessionIds[$sessionId] = $sessionId;
    }

    public function touchProject(?int $projectId): void
    {
        if ($projectId !== null) {
            $this->touchedProjectIds[$projectId] = $projectId;
        }
    }

    public function touchDate(int $deviceId, string $date): void
    {
        $this->rollupPairs[$deviceId.'|'.$date] = [$deviceId, $date];
    }

    public function accepted(): int
    {
        return $this->created + $this->updated;
    }
}
