import type { FilterDimension, TokenTotals } from '@/types/monitor';

export type MetricKey =
    | 'total'
    | 'actual'
    | 'cache_read'
    | 'input'
    | 'output'
    | 'cache_creation';

export type MetricField = Exclude<keyof TokenTotals, 'message_count'>;

export type Granularity = 'day' | 'week' | 'month' | 'year';

export type GroupKey = FilterDimension;

export type MetricDefinition = {
    key: MetricKey;
    label: string;
    field: MetricField;
};

// Exact PRD §19 labels, in display order.
export const metricDefinitions: MetricDefinition[] = [
    {
        key: 'total',
        label: 'Total Token Activity',
        field: 'total_token_activity',
    },
    {
        key: 'actual',
        label: 'Actual Consumed Tokens',
        field: 'actual_consumed_tokens',
    },
    { key: 'input', label: 'Input Tokens', field: 'input_tokens' },
    { key: 'output', label: 'Output Tokens', field: 'output_tokens' },
    {
        key: 'cache_creation',
        label: 'Cache Creation Tokens',
        field: 'cache_creation_tokens',
    },
    {
        key: 'cache_read',
        label: 'Cache Read Tokens',
        field: 'cache_read_tokens',
    },
];

export function metricDefinition(key: MetricKey): MetricDefinition {
    return (
        metricDefinitions.find((definition) => definition.key === key) ??
        metricDefinitions[0]
    );
}

export const granularityLabels: Record<Granularity, string> = {
    day: 'Day',
    week: 'Week',
    month: 'Month',
    year: 'Year',
};

export const granularityAdjectives: Record<Granularity, string> = {
    day: 'Daily',
    week: 'Weekly',
    month: 'Monthly',
    year: 'Yearly',
};

export const groupDefinitions: {
    key: GroupKey;
    label: string;
    columnLabel: string;
}[] = [
    { key: 'developer', label: 'Developer', columnLabel: 'Developer' },
    { key: 'device', label: 'Device', columnLabel: 'Device' },
    {
        key: 'account',
        label: 'Claude Account',
        columnLabel: 'Claude Account',
    },
    { key: 'project', label: 'Project', columnLabel: 'Project' },
    { key: 'model', label: 'Model', columnLabel: 'Model' },
];

export function groupColumnLabel(key: GroupKey): string {
    return (
        groupDefinitions.find((definition) => definition.key === key)
            ?.columnLabel ?? 'Developer'
    );
}
