<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import EmptyState from '@/components/monitor/EmptyState.vue';
import { formatTokens, formatTokensFull } from '@/lib/format';
import type { BreakdownRow } from '@/types/monitor';

type Props = {
    rows: BreakdownRow[];
    dimensionLabel: string;
    linkFor?: (row: BreakdownRow) => string | null;
};

const props = withDefaults(defineProps<Props>(), {
    linkFor: undefined,
});

const tokenColumns: {
    field:
        | 'total_token_activity'
        | 'actual_consumed_tokens'
        | 'cache_read_tokens';
    label: string;
}[] = [
    { field: 'total_token_activity', label: 'Total Token Activity' },
    { field: 'actual_consumed_tokens', label: 'Actual Consumed Tokens' },
    { field: 'cache_read_tokens', label: 'Cache Read Tokens' },
];

function hrefFor(row: BreakdownRow): string | null {
    return props.linkFor ? props.linkFor(row) : null;
}
</script>

<template>
    <EmptyState v-if="rows.length === 0" />
    <div v-else class="overflow-x-auto rounded-lg border">
        <table class="w-full min-w-[36rem] text-sm">
            <thead class="bg-muted/50 text-muted-foreground">
                <tr class="border-b">
                    <th scope="col" class="px-4 py-2.5 text-left font-medium">
                        {{ dimensionLabel }}
                    </th>
                    <th
                        v-for="column in tokenColumns"
                        :key="column.field"
                        scope="col"
                        class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                    >
                        {{ column.label }}
                    </th>
                    <th scope="col" class="px-4 py-2.5 text-right font-medium">
                        Messages
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="(row, index) in rows"
                    :key="row.id ?? `unknown-${index}`"
                    class="border-b last:border-b-0 hover:bg-muted/30"
                >
                    <th scope="row" class="px-4 py-2.5 text-left font-medium">
                        <Link
                            v-if="hrefFor(row)"
                            :href="hrefFor(row) ?? ''"
                            class="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                            {{ row.label }}
                        </Link>
                        <span v-else>{{ row.label }}</span>
                    </th>
                    <td
                        v-for="column in tokenColumns"
                        :key="column.field"
                        class="px-4 py-2.5 text-right tabular-nums"
                        :title="formatTokensFull(row[column.field])"
                    >
                        {{ formatTokens(row[column.field]) }}
                    </td>
                    <td
                        class="px-4 py-2.5 text-right tabular-nums"
                        :title="formatTokensFull(row.message_count)"
                    >
                        {{ formatTokens(row.message_count) }}
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
