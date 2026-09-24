<?php

namespace App\Actions\Ingestion\Support;

use Carbon\CarbonImmutable;

/**
 * Record-level validation (docs/contracts/sync-api-v1.md §6.2–6.3).
 *
 * Returns the first failing reason in contract order, or null when the record is storable. It must catch every
 * value the database would refuse, so a record never reaches a DB error.
 */
final class RecordValidator
{
    public const MAX_TOKEN_VALUE = 9007199254740991;

    private const TIMESTAMP_PATTERN = '/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?Z$/';

    /** Earliest instant a MySQL TIMESTAMP column accepts. */
    private const MIN_TIMESTAMP = 1;

    /**
     * Field specs: [kind, min length, max length, nullable].
     *
     * @var array<string, array<string, array{0: string, 1?: int, 2?: int, 3?: bool}>>
     */
    private const SPECS = [
        'account' => [
            'account_key' => ['hash'],
            'account_uuid' => ['string', 1, 64, true],
            'email' => ['string', 1, 191, true],
            'display_name' => ['string', 1, 191, true],
            'organization_uuid' => ['string', 1, 64, true],
            'organization_name' => ['string', 1, 191, true],
            'observed_at' => ['timestamp'],
        ],
        'project' => [
            'project_key' => ['hash'],
            'name' => ['string', 1, 191],
            'path' => ['string', 1, 4096],
            'git_remote' => ['string', 1, 255, true],
            'first_seen_at' => ['timestamp'],
            'last_seen_at' => ['timestamp'],
        ],
        'session' => [
            'source_session_id' => ['string', 1, 64],
            'project_key' => ['hash', 0, 0, true],
            'account_key' => ['hash', 0, 0, true],
            'first_seen_at' => ['timestamp'],
            'last_seen_at' => ['timestamp'],
            'ended_at' => ['timestamp', 0, 0, true],
            'claude_code_version' => ['string', 1, 64, true],
            'entrypoint' => ['string', 1, 64, true],
            'git_branch' => ['string', 1, 191, true],
            'model' => ['string', 1, 128, true],
        ],
        'usage' => [
            'source_message_id' => ['string', 1, 64],
            'source_session_id' => ['string', 1, 64],
            'request_id' => ['string', 1, 64, true],
            'model' => ['string', 1, 128, true],
            'is_sidechain' => ['bool'],
            'recorded_at' => ['timestamp'],
            'input_tokens' => ['token'],
            'output_tokens' => ['token'],
            'cache_creation_tokens' => ['token'],
            'cache_read_tokens' => ['token'],
        ],
        'message' => [
            'source_message_id' => ['string', 1, 64],
            'source_session_id' => ['string', 1, 64],
            'role' => ['role'],
            'content' => ['utf16', 1, 100000],
            'recorded_at' => ['timestamp'],
        ],
    ];

    /** Records whose first/last seen pair must be ordered. */
    private const ORDERED_PAIRS = ['project', 'session'];

    /**
     * @param  'account'|'project'|'session'|'usage'|'message'  $type
     */
    public static function reason(string $type, mixed $record, CarbonImmutable $now): ?string
    {
        if (! is_array($record)) {
            return 'invalid_value';
        }

        $specs = self::SPECS[$type];

        foreach ($specs as $field => $spec) {
            if ($spec[0] === 'token' && (is_int($record[$field] ?? null) || is_float($record[$field] ?? null)) && $record[$field] < 0) {
                return 'negative_token_value';
            }
        }

        foreach ($specs as $field => $spec) {
            if (! array_key_exists($field, $record) || ! self::validValue($spec, $record[$field])) {
                return 'invalid_value';
            }
        }

        $timestamps = [];

        foreach ($specs as $field => $spec) {
            if ($spec[0] !== 'timestamp' || $record[$field] === null) {
                continue;
            }

            $parsed = self::parseTimestamp($record[$field]);

            if ($parsed === null) {
                return 'invalid_timestamp';
            }

            $timestamps[$field] = $parsed;
        }

        if (in_array($type, self::ORDERED_PAIRS, true) && $timestamps['first_seen_at']->greaterThan($timestamps['last_seen_at'])) {
            return 'invalid_value';
        }

        $limit = $now->addDay();

        foreach ($timestamps as $timestamp) {
            if ($timestamp->greaterThan($limit)) {
                return 'future_timestamp';
            }
        }

        return null;
    }

    /**
     * Parse a contract timestamp (ISO-8601 UTC ending in Z). Null when malformed or outside the TIMESTAMP range start.
     */
    public static function parseTimestamp(mixed $value): ?CarbonImmutable
    {
        if (! is_string($value) || preg_match(self::TIMESTAMP_PATTERN, $value, $m) !== 1) {
            return null;
        }

        [, $year, $month, $day, $hour, $minute, $second] = array_map('intval', $m);

        if (! checkdate($month, $day, $year) || $hour > 23 || $minute > 59 || $second > 59) {
            return null;
        }

        $micro = isset($m[7]) ? substr(str_pad(substr($m[7], 1), 6, '0'), 0, 6) : '000000';
        $parsed = CarbonImmutable::createFromFormat('Y-m-d H:i:s.u', sprintf('%04d-%02d-%02d %02d:%02d:%02d.%s', $year, $month, $day, $hour, $minute, $second, $micro), 'UTC');

        if ($parsed === null || $parsed->getTimestamp() < self::MIN_TIMESTAMP) {
            return null;
        }

        return $parsed;
    }

    /**
     * Type/length check. Any non-null timestamp passes here; its format is checked after (invalid_timestamp).
     *
     * @param  array{0: string, 1?: int, 2?: int, 3?: bool}  $spec
     */
    private static function validValue(array $spec, mixed $value): bool
    {
        $nullable = $spec[3] ?? false;

        if ($value === null) {
            return $nullable;
        }

        return match ($spec[0]) {
            'hash' => is_string($value) && preg_match('/^[0-9a-f]{64}$/', $value) === 1,
            'string' => is_string($value) && self::lengthBetween(mb_strlen($value), $spec),
            'utf16' => is_string($value) && self::lengthBetween(intdiv(strlen((string) mb_convert_encoding($value, 'UTF-16LE', 'UTF-8')), 2), $spec),
            'timestamp' => true,
            'bool' => is_bool($value),
            'token' => is_int($value) && $value >= 0 && $value <= self::MAX_TOKEN_VALUE,
            'role' => $value === 'user',
            default => false,
        };
    }

    /**
     * @param  array{0: string, 1?: int, 2?: int, 3?: bool}  $spec
     */
    private static function lengthBetween(int $length, array $spec): bool
    {
        return $length >= ($spec[1] ?? 0) && $length <= ($spec[2] ?? PHP_INT_MAX);
    }
}
