<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * The ONLY place token formulas live.
 *
 * actual = input + output + cache_creation; total = actual + cache_read.
 * This is a monitoring calculation — not billing, cost, or quota.
 */
final class TokenMath
{
    public static function actual(int $in, int $out, int $cacheCreation): int
    {
        self::assertNonNegative(compact('in', 'out', 'cacheCreation'));

        return $in + $out + $cacheCreation;
    }

    public static function total(int $in, int $out, int $cacheCreation, int $cacheRead): int
    {
        self::assertNonNegative(compact('cacheRead'));

        return self::actual($in, $out, $cacheCreation) + $cacheRead;
    }

    /**
     * @param  array{input_tokens?: int, output_tokens?: int, cache_creation_tokens?: int, cache_read_tokens?: int}  $raw
     * @return array{actual_consumed_tokens: int, total_token_activity: int}
     */
    public static function forRow(array $raw): array
    {
        $in = (int) ($raw['input_tokens'] ?? 0);
        $out = (int) ($raw['output_tokens'] ?? 0);
        $cacheCreation = (int) ($raw['cache_creation_tokens'] ?? 0);
        $cacheRead = (int) ($raw['cache_read_tokens'] ?? 0);

        return [
            'actual_consumed_tokens' => self::actual($in, $out, $cacheCreation),
            'total_token_activity' => self::total($in, $out, $cacheCreation, $cacheRead),
        ];
    }

    /**
     * @param  array<string, int>  $values
     */
    private static function assertNonNegative(array $values): void
    {
        foreach ($values as $name => $value) {
            if ($value < 0) {
                throw new InvalidArgumentException("Token count [{$name}] must not be negative, got {$value}.");
            }
        }
    }
}
