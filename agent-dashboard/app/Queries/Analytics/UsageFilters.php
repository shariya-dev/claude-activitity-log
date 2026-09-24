<?php

namespace App\Queries\Analytics;

use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;

/**
 * Date range + optional dimension filters shared by every analytics query.
 */
final class UsageFilters
{
    public function __construct(
        public readonly DateRange $range,
        public readonly ?int $developerId = null,
        public readonly ?int $deviceId = null,
        public readonly ?int $accountId = null,
        public readonly ?int $projectId = null,
        public readonly ?int $modelId = null,
    ) {}

    /**
     * Reads `developer`, `device`, `account`, `project`, `model` query params; non-positive or non-integer ids are ignored.
     */
    public static function fromRequest(Request $r): self
    {
        return new self(
            DateRange::fromRequest($r),
            self::id($r->query('developer')),
            self::id($r->query('device')),
            self::id($r->query('account')),
            self::id($r->query('project')),
            self::id($r->query('model')),
        );
    }

    /**
     * Apply the dimension filters to a query over a table carrying the Dimension::column() foreign keys
     * (usage_daily_rollups or claude_sessions). $table is a trusted, code-defined alias — never user input.
     *
     * @internal
     */
    public function applyDimensions(Builder $query, string $table): Builder
    {
        $values = [
            Dimension::Developer->column() => $this->developerId,
            Dimension::Device->column() => $this->deviceId,
            Dimension::Account->column() => $this->accountId,
            Dimension::Project->column() => $this->projectId,
            Dimension::Model->column() => $this->modelId,
        ];

        foreach ($values as $column => $value) {
            if ($value !== null) {
                $query->where("{$table}.{$column}", $value);
            }
        }

        return $query;
    }

    private static function id(mixed $value): ?int
    {
        $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $id === false ? null : $id;
    }
}
