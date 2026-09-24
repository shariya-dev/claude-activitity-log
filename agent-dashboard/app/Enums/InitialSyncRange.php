<?php

namespace App\Enums;

use Carbon\CarbonImmutable;

enum InitialSyncRange: string
{
    case OneDay = '1d';
    case SevenDays = '7d';
    case ThirtyDays = '30d';
    case All = 'all';

    /**
     * The UTC-midnight lower bound for the initial sync, or null for all history.
     */
    public function sinceFrom(CarbonImmutable $now): ?CarbonImmutable
    {
        $days = match ($this) {
            self::OneDay => 1,
            self::SevenDays => 7,
            self::ThirtyDays => 30,
            self::All => null,
        };

        return $days === null ? null : $now->utc()->subDays($days)->startOfDay();
    }
}
