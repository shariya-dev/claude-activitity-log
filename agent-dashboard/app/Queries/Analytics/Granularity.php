<?php

namespace App\Queries\Analytics;

use Carbon\CarbonImmutable;

/**
 * Trend bucket size. Periods are keyed `Y-m-d` (day), Monday `Y-m-d` (week), `Y-m` (month), `Y` (year).
 */
enum Granularity: string
{
    case Day = 'day';
    case Week = 'week';
    case Month = 'month';
    case Year = 'year';

    private const MAX_DAYS_FOR_DAILY = 45;

    private const MAX_WEEKS_FOR_WEEKLY = 26;

    private const MAX_YEARS_FOR_MONTHLY = 3;

    public static function auto(DateRange $r): self
    {
        $days = $r->days();

        return match (true) {
            $days <= self::MAX_DAYS_FOR_DAILY => self::Day,
            $days <= self::MAX_WEEKS_FOR_WEEKLY * 7 => self::Week,
            $r->end->startOfDay()->lessThan($r->start->startOfDay()->addYears(self::MAX_YEARS_FOR_MONTHLY)) => self::Month,
            default => self::Year,
        };
    }

    /**
     * SQL expression bucketing a DATE column into this granularity's period key.
     */
    public function periodSql(string $dateColumn): string
    {
        return match ($this) {
            self::Day => "DATE_FORMAT({$dateColumn}, '%Y-%m-%d')",
            self::Week => "DATE_FORMAT(DATE_SUB({$dateColumn}, INTERVAL WEEKDAY({$dateColumn}) DAY), '%Y-%m-%d')",
            self::Month => "DATE_FORMAT({$dateColumn}, '%Y-%m')",
            self::Year => "DATE_FORMAT({$dateColumn}, '%Y')",
        };
    }

    /**
     * The first period start that contains $date.
     */
    public function periodStart(CarbonImmutable $date): CarbonImmutable
    {
        return match ($this) {
            self::Day => $date->startOfDay(),
            self::Week => $date->startOfWeek(CarbonImmutable::MONDAY),
            self::Month => $date->startOfMonth(),
            self::Year => $date->startOfYear(),
        };
    }

    public function next(CarbonImmutable $periodStart): CarbonImmutable
    {
        return match ($this) {
            self::Day => $periodStart->addDay(),
            self::Week => $periodStart->addWeek(),
            self::Month => $periodStart->addMonthNoOverflow(),
            self::Year => $periodStart->addYear(),
        };
    }

    public function periodKey(CarbonImmutable $periodStart): string
    {
        return match ($this) {
            self::Day, self::Week => $periodStart->format('Y-m-d'),
            self::Month => $periodStart->format('Y-m'),
            self::Year => $periodStart->format('Y'),
        };
    }

    public function label(CarbonImmutable $periodStart): string
    {
        return match ($this) {
            self::Day => $periodStart->format('M j'),
            self::Week => $periodStart->format('M j').' – '.$periodStart->addDays(6)->format('M j'),
            self::Month => $periodStart->format('M Y'),
            self::Year => $periodStart->format('Y'),
        };
    }
}
