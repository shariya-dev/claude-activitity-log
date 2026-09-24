<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Organization clock: timestamps are stored in UTC, day buckets use the org timezone.
 */
final class OrgClock
{
    public static function timezone(): string
    {
        return (string) config('monitor.timezone');
    }

    /**
     * The org-timezone calendar date (Y-m-d) for the given instant.
     */
    public static function dateFor(CarbonInterface $utc): string
    {
        return CarbonImmutable::instance($utc)->setTimezone(self::timezone())->format('Y-m-d');
    }

    /**
     * Org-timezone midnight of the given Y-m-d date, expressed in UTC.
     */
    public static function startOfDayUtc(string $date): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat('!Y-m-d', $date, self::timezone())->utc();
    }

    public static function now(): CarbonImmutable
    {
        return CarbonImmutable::now('UTC');
    }
}
