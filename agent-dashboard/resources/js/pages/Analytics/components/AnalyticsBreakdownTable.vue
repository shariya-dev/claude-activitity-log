<script setup lang="ts">
import { computed } from 'vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import { formatTokens, formatTokensFull } from '@/lib/format';
import type { BreakdownRow } from '@/types/monitor';
import type { MetricDefinition, MetricField } from './metrics';

type Props = {
    rows: BreakdownRow[];
    metric: MetricDefinition;
    metricTotal: number;
    dimensionLabel: string;
};

const props = defineProps<Props>();

const extraColumns: { field: MetricField; label: string }[] = [
    { field: 'total_token_activity', label: 'Total Token Activity' },
    { field: 'actual_consumed_tokens', label: 'Actual Consumed Tokens' },
    { field: 'cache_read_tokens', label: 'Cache Read Tokens' },
];

const percentFormatter = new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
});

const sortedRows = computed(() =>
    props.rows
        .map((row, index) => ({ row, index }))
        .sort(
            (a, b) =>
                b.row[props.metric.field] - a.row[props.metric.field] ||
                a.index - b.index,
        )
        .map(({ row }) => row),
);

function share(row: BreakdownRow): number | null {
    if (props.metricTotal <= 0) {
        return null;
    }

    return Math.min(
        Math.max(row[props.metric.field] / props.metricTotal, 0),
        1,
    );
}

function formatShare(value: number | null): string {
    return value === null ? '—' : percentFormatter.format(value);
}
</script>

<template>
    <EmptyState
        v-if="rows.length === 0"
        :description="`No ${dimensionLabel.toLowerCase()} activity for the selected range and filters.`"
    />
    <div v-else class="overflow-x-auto rounded-lg border">
        <table class="w-full min-w-[52rem] text-sm">
            <thead class="bg-muted/50 text-muted-foreground">
                <tr class="border-b">
                    <th scope="col" class="px-4 py-2.5 text-left font-medium">
                        {{ dimensionLabel }}
                    </th>
                    <th
                        scope="col"
                        class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                        aria-sort="descending"
                    >
                        {{ metric.label }}
                    </th>
                    <th
                        scope="col"
                        class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                    >
                        Share of total
                    </th>
                    <template
                        v-for="column in extraColumns"
                        :key="column.field"
                    >
                        <th
                            v-if="column.field !== metric.field"
                            scope="col"
                            class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                        >
                            {{ column.label }}
                        </th>
                    </template>
                    <th scope="col" class="px-4 py-2.5 text-right font-medium">
                        Messages
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="(row, index) in sortedRows"
                    :key="row.id ?? `unknown-${index}`"
                    class="border-b last:border-b-0 hover:bg-muted/30"
                >
                    <th
                        scope="row"
                        class="max-w-[16rem] truncate px-4 py-2.5 text-left font-medium"
                        :title="row.label"
                    >
                        {{ row.label }}
                    </th>
                    <td
                        class="px-4 py-2.5 text-right font-medium tabular-nums"
                        :title="formatTokensFull(row[metric.field])"
                    >
                        {{ formatTokens(row[metric.field]) }}
                    </td>
                    <td class="px-4 py-2.5">
                        <div class="flex items-center gap-2">
                            <div
                                class="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-muted"
                                aria-hidden="true"
                            >
                                <div
                                    class="h-full rounded-full bg-chart-1"
                                    :style="{
                                        width: `${(share(row) ?? 0) * 100}%`,
                                    }"
                                />
                            </div>
                            <span class="w-14 text-right tabular-nums">
                                {{ formatShare(share(row)) }}
                            </span>
                        </div>
                    </td>
                    <template
                        v-for="column in extraColumns"
                        :key="column.field"
                    >
                        <td
                            v-if="column.field !== metric.field"
                            class="px-4 py-2.5 text-right tabular-nums"
                            :title="formatTokensFull(row[column.field])"
                        >
                            {{ formatTokens(row[column.field]) }}
                        </td>
                    </template>
                    <td class="px-4 py-2.5 text-right tabular-nums">
                        {{ formatTokensFull(row.message_count) }}
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
