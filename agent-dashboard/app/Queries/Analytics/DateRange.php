<?php

namespace App\Queries\Analytics;

use App\Support\OrgClock;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * An inclusive calendar-day range in the organization timezone (weeks start Monday).
 * `start` is 00:00:00 of the first day and `end` is 23:59:59.999999 of the last day, both in org tz.
 */
final class DateRange
{
    public const PRESETS = ['today', 'yesterday', 'week', 'month', 'year'];

    public const CUSTOM = 'custom';

    public const MAX_CUSTOM_YEARS = 3;

    public function __construct(
        public readonly CarbonImmutable $start,
        public readonly CarbonImmutable $end,
        public readonly string $preset,
    ) {}

    /**
     * Reads `range`, `from`, `to` query params. Unknown presets fall back to $default;
     * an invalid custom range throws a ValidationException.
     */
    public static function fromRequest(Request $r, string $default = 'week'): self
    {
        $preset = $r->query('range');

        if ($preset === self::CUSTOM) {
            return self::custom($r->query('from'), $r->query('to'));
        }

        return self::preset(is_string($preset) && in_array($preset, self::PRESETS, true) ? $preset : $default);
    }

    public static function preset(string $preset, ?CarbonImmutable $now = null): self
    {
        $today = ($now ?? CarbonImmutable::now())->setTimezone(OrgClock::timezone());

        [$start, $end] = match ($preset) {
            'today' => [$today->startOfDay(), $today->endOfDay()],
            'yesterday' => [$today->subDay()->startOfDay(), $today->subDay()->endOfDay()],
            'week' => [$today->startOfWeek(CarbonImmutable::MONDAY), $today->endOfWeek(CarbonImmutable::SUNDAY)],
            'month' => [$today->startOfMonth(), $today->endOfMonth()],
            'year' => [$today->startOfYear(), $today->endOfYear()],
            default => throw new InvalidArgumentException("Unknown date range preset [{$preset}]."),
        };

        return new self($start, $end, $preset);
    }

    public function startDate(): string
    {
        return $this->start->format('Y-m-d');
    }

    public function endDate(): string
    {
        return $this->end->format('Y-m-d');
    }

    /**
     * @return array{preset: string, from: string, to: string}
     */
    public function toArray(): array
    {
        return ['preset' => $this->preset, 'from' => $this->startDate(), 'to' => $this->endDate()];
    }

    /**
     * Number of calendar days covered, inclusive.
     */
    public function days(): int
    {
        return (int) round($this->start->startOfDay()->diffInDays($this->end->startOfDay())) + 1;
    }

    /**
     * @throws ValidationException
     */
    private static function custom(mixed $from, mixed $to): self
    {
        $data = Validator::validate(['from' => $from, 'to' => $to], [
            'from' => ['required', 'string', 'date_format:Y-m-d'],
            'to' => ['required', 'string', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);

        $timezone = OrgClock::timezone();
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $data['from'], $timezone);
        $end = CarbonImmutable::createFromFormat('!Y-m-d', $data['to'], $timezone);

        if ($start === null || $end === null) {
            throw ValidationException::withMessages(['from' => 'The date range is invalid.']);
        }

        if ($end->greaterThanOrEqualTo($start->addYears(self::MAX_CUSTOM_YEARS))) {
            throw ValidationException::withMessages([
                'to' => 'The date range may not be longer than '.self::MAX_CUSTOM_YEARS.' years.',
            ]);
        }

        return new self($start->startOfDay(), $end->endOfDay(), self::CUSTOM);
    }
}
