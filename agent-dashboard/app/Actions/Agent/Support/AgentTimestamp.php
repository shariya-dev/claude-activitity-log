<?php

namespace App\Actions\Agent\Support;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Contract timestamp handling: ISO-8601 UTC ending in `Z` (sync-api-v1 §1).
 */
final class AgentTimestamp
{
    /**
     * Validation rules for a contract timestamp that fits a MySQL TIMESTAMP column.
     *
     * @return array<int, string>
     */
    public static function rules(): array
    {
        return [
            'string',
            'regex:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/',
            'date',
            'after_or_equal:1970-01-01T00:00:01Z',
            'before:2038-01-19T03:14:07Z',
        ];
    }

    public static function parse(?string $value): ?CarbonImmutable
    {
        return $value === null ? null : CarbonImmutable::parse($value)->utc();
    }

    public static function format(?CarbonInterface $value): ?string
    {
        return $value === null ? null : CarbonImmutable::instance($value)->utc()->format('Y-m-d\TH:i:s\Z');
    }
}
