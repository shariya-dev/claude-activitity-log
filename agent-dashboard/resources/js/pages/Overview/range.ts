import type { DatePreset, DateRangeProps } from '@/types/monitor';

const sessionLabels: Record<DatePreset, string> = {
    today: 'Sessions today',
    yesterday: 'Sessions yesterday',
    week: 'Sessions this week',
    month: 'Sessions this month',
    year: 'Sessions this year',
    custom: 'Sessions in range',
};

const dateFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
});

export function sessionsLabel(range: DateRangeProps): string {
    return sessionLabels[range.preset];
}

export function formatDay(date: string): string {
    const parsed = new Date(`${date}T00:00:00Z`);

    return Number.isNaN(parsed.getTime()) ? date : dateFormatter.format(parsed);
}

export function describeRange(range: DateRangeProps): string {
    return range.from === range.to
        ? formatDay(range.from)
        : `${formatDay(range.from)} – ${formatDay(range.to)}`;
}

/**
 * Query params that carry the selected range to detail pages.
 */
export function rangeQuery(range: DateRangeProps): Record<string, string> {
    return range.preset === 'custom'
        ? { range: 'custom', from: range.from, to: range.to }
        : { range: range.preset };
}
