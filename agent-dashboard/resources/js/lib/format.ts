const EMPTY = '—';

const integerFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
});

const compactUnits: { value: number; suffix: string }[] = [
    { value: 1e12, suffix: 'T' },
    { value: 1e9, suffix: 'B' },
    { value: 1e6, suffix: 'M' },
    { value: 1e3, suffix: 'K' },
];

function toSignificant(value: number): string {
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;

    return Number(value.toFixed(digits)).toString();
}

export function formatTokens(n: number): string {
    if (!Number.isFinite(n)) {
        return EMPTY;
    }

    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);

    if (abs < 1000) {
        return sign + integerFormatter.format(abs);
    }

    for (let i = 0; i < compactUnits.length; i++) {
        const unit = compactUnits[i];
        const scaled = abs / unit.value;

        if (scaled < 1) {
            continue;
        }

        const rounded = toSignificant(scaled);

        if (Number(rounded) >= 1000 && i > 0) {
            const bigger = compactUnits[i - 1];

            return sign + toSignificant(abs / bigger.value) + bigger.suffix;
        }

        return sign + rounded + unit.suffix;
    }

    return sign + integerFormatter.format(abs);
}

export function formatTokensFull(n: number): string {
    if (!Number.isFinite(n)) {
        return EMPTY;
    }

    return integerFormatter.format(n);
}

export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '0s';
    }

    const total = Math.floor(seconds);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (days > 0) {
        return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }

    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    if (minutes > 0) {
        return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
    }

    return `${secs}s`;
}

function parseDate(iso: string | null | undefined): Date | null {
    if (!iso) {
        return null;
    }

    const date = new Date(iso);

    return Number.isNaN(date.getTime()) ? null : date;
}

function dateTimeParts(date: Date, tz?: string): Record<string, string> {
    const formatter = new Intl.DateTimeFormat('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        ...(tz ? { timeZone: tz } : {}),
    });

    return Object.fromEntries(
        formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
}

export function formatDateTime(iso: string | null, tz: string): string {
    const date = parseDate(iso);

    if (date === null) {
        return EMPTY;
    }

    let parts: Record<string, string>;

    try {
        parts = dateTimeParts(date, tz);
    } catch {
        parts = dateTimeParts(date);
    }

    return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

const relativeFormatter = new Intl.RelativeTimeFormat('en', {
    numeric: 'auto',
});

const relativeSteps: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] =
    [
        { unit: 'year', seconds: 31536000 },
        { unit: 'month', seconds: 2592000 },
        { unit: 'week', seconds: 604800 },
        { unit: 'day', seconds: 86400 },
        { unit: 'hour', seconds: 3600 },
        { unit: 'minute', seconds: 60 },
    ];

export function formatRelative(
    iso: string | null,
    now: Date = new Date(),
): string {
    const date = parseDate(iso);

    if (date === null) {
        return EMPTY;
    }

    const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
    const abs = Math.abs(diffSeconds);

    if (abs < 45) {
        return 'just now';
    }

    for (const step of relativeSteps) {
        if (abs >= step.seconds) {
            return relativeFormatter.format(
                Math.round(diffSeconds / step.seconds),
                step.unit,
            );
        }
    }

    return relativeFormatter.format(Math.round(diffSeconds / 60), 'minute');
}
