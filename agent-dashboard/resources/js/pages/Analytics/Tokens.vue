<script setup lang="ts">
import { Head, router, setLayoutProps, usePage } from '@inertiajs/vue3';
import { computed, useId, watchEffect } from 'vue';
import DateRangeFilter from '@/components/monitor/DateRangeFilter.vue';
import EntityFilters from '@/components/monitor/EntityFilters.vue';
import TokenMetricsGrid from '@/components/monitor/TokenMetricsGrid.vue';
import { Button } from '@/components/ui/button';
import type { BreadcrumbItem } from '@/types';
import type {
    BreakdownRow,
    DateRangeProps,
    FilterOptions,
    TokenTotals,
    TrendPoint,
} from '@/types/monitor';
import AnalyticsBreakdownTable from './components/AnalyticsBreakdownTable.vue';
import MetricTrendChart from './components/MetricTrendChart.vue';
import type { Granularity, GroupKey, MetricKey } from './components/metrics';
import {
    granularityAdjectives,
    granularityLabels,
    groupColumnLabel,
    groupDefinitions,
    metricDefinition,
    metricDefinitions,
} from './components/metrics';

type Props = {
    range: DateRangeProps;
    filters: {
        developer: number | null;
        device: number | null;
        account: number | null;
        project: number | null;
        model: number | null;
    };
    options: FilterOptions;
    granularity: { value: Granularity; auto: boolean };
    group: GroupKey;
    metric: MetricKey;
    totals: TokenTotals;
    trend: TrendPoint[];
    breakdown: BreakdownRow[];
    breakdownLimit: number;
};

const props = defineProps<Props>();

const title = 'Token Analytics';
const page = usePage();
const id = useId();

watchEffect(() => {
    setLayoutProps<{ breadcrumbs: BreadcrumbItem[] }>({
        breadcrumbs: [{ title, href: page.url }],
    });
});

const granularityOrder: Granularity[] = ['day', 'week', 'month', 'year'];

const selectedMetric = computed(() => metricDefinition(props.metric));

const metricTotal = computed(() => props.totals[selectedMetric.value.field]);

const breakdownLabel = computed(() => groupColumnLabel(props.group));

const granularityCaption = computed(() => {
    const label = granularityLabels[props.granularity.value];

    return props.granularity.auto ? `Auto (${label})` : label;
});

const isTruncated = computed(
    () =>
        props.breakdownLimit > 0 &&
        props.breakdown.length >= props.breakdownLimit,
);

function visit(changes: Record<string, string | null>): void {
    const origin =
        typeof window !== 'undefined'
            ? window.location.origin
            : 'http://localhost';
    const url = new URL(page.url, origin);
    const query: Record<string, string> = Object.fromEntries(
        url.searchParams.entries(),
    );
    delete query.page;

    for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === '') {
            delete query[key];
        } else {
            query[key] = value;
        }
    }

    router.get(url.pathname, query, {
        preserveState: true,
        preserveScroll: true,
        replace: true,
    });
}

function isGranularityActive(value: Granularity | null): boolean {
    return value === null
        ? props.granularity.auto
        : !props.granularity.auto && props.granularity.value === value;
}

function selectGranularity(value: Granularity | null): void {
    visit({ granularity: value });
}

function selectGroup(value: GroupKey): void {
    visit({ group: value });
}

function onMetricChange(event: Event): void {
    visit({ metric: (event.target as HTMLSelectElement).value });
}
</script>

<template>
    <Head :title="title" />

    <div class="flex min-w-0 flex-1 flex-col gap-6 p-4">
        <h1 class="text-xl font-semibold tracking-tight">{{ title }}</h1>

        <section
            aria-label="Filters"
            class="flex flex-col gap-4 rounded-xl border p-4"
        >
            <DateRangeFilter :range="range" />
            <EntityFilters :options="options" :values="filters" />
            <div class="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:gap-6">
                <div class="flex flex-col gap-1.5">
                    <span
                        :id="`${id}-granularity`"
                        class="text-sm leading-none font-medium"
                    >
                        Granularity
                    </span>
                    <div
                        role="group"
                        :aria-labelledby="`${id}-granularity`"
                        class="flex flex-wrap items-center gap-1.5"
                    >
                        <Button
                            type="button"
                            size="sm"
                            :variant="
                                isGranularityActive(null)
                                    ? 'default'
                                    : 'outline'
                            "
                            :aria-pressed="isGranularityActive(null)"
                            @click="selectGranularity(null)"
                        >
                            {{
                                granularity.auto
                                    ? `Auto (${granularityLabels[granularity.value]})`
                                    : 'Auto'
                            }}
                        </Button>
                        <Button
                            v-for="value in granularityOrder"
                            :key="value"
                            type="button"
                            size="sm"
                            :variant="
                                isGranularityActive(value)
                                    ? 'default'
                                    : 'outline'
                            "
                            :aria-pressed="isGranularityActive(value)"
                            @click="selectGranularity(value)"
                        >
                            {{ granularityLabels[value] }}
                        </Button>
                    </div>
                </div>
                <div class="flex flex-col gap-1.5">
                    <span
                        :id="`${id}-group`"
                        class="text-sm leading-none font-medium"
                    >
                        Group by
                    </span>
                    <div
                        role="group"
                        :aria-labelledby="`${id}-group`"
                        class="flex flex-wrap items-center gap-1.5"
                    >
                        <Button
                            v-for="definition in groupDefinitions"
                            :key="definition.key"
                            type="button"
                            size="sm"
                            :variant="
                                group === definition.key ? 'default' : 'outline'
                            "
                            :aria-pressed="group === definition.key"
                            @click="selectGroup(definition.key)"
                        >
                            {{ definition.label }}
                        </Button>
                    </div>
                </div>
            </div>
        </section>

        <section :aria-labelledby="`${id}-totals`" class="flex flex-col gap-3">
            <h2 :id="`${id}-totals`" class="text-base font-semibold">Totals</h2>
            <TokenMetricsGrid :totals="totals" />
        </section>

        <section
            :aria-labelledby="`${id}-trend`"
            class="flex flex-col gap-4 rounded-xl border p-4"
        >
            <div
                class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
            >
                <div class="flex flex-col gap-1">
                    <h2 :id="`${id}-trend`" class="text-base font-semibold">
                        {{ granularityAdjectives[granularity.value] }}
                        {{ selectedMetric.label }}
                    </h2>
                    <p class="text-sm text-muted-foreground">
                        Granularity: {{ granularityCaption }} ·
                        {{ range.from }} to {{ range.to }}
                    </p>
                </div>
                <div class="grid gap-1.5 sm:w-64">
                    <label
                        :for="`${id}-metric`"
                        class="text-sm leading-none font-medium"
                    >
                        Metric
                    </label>
                    <select
                        :id="`${id}-metric`"
                        name="metric"
                        :value="metric"
                        class="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                        @change="onMetricChange"
                    >
                        <option
                            v-for="definition in metricDefinitions"
                            :key="definition.key"
                            :value="definition.key"
                            class="bg-popover text-popover-foreground"
                        >
                            {{ definition.label }}
                        </option>
                    </select>
                </div>
            </div>
            <MetricTrendChart
                :points="trend"
                :metric="selectedMetric"
                :granularity-label="granularityAdjectives[granularity.value]"
            />
        </section>

        <section
            :aria-labelledby="`${id}-breakdown`"
            class="flex flex-col gap-3"
        >
            <div class="flex flex-col gap-1">
                <h2 :id="`${id}-breakdown`" class="text-base font-semibold">
                    {{ selectedMetric.label }} by {{ breakdownLabel }}
                </h2>
                <p class="text-sm text-muted-foreground">
                    Sorted by {{ selectedMetric.label }}. Share of total is each
                    row's {{ selectedMetric.label }} divided by the filtered
                    total.
                </p>
            </div>
            <AnalyticsBreakdownTable
                :rows="breakdown"
                :metric="selectedMetric"
                :metric-total="metricTotal"
                :dimension-label="breakdownLabel"
            />
            <p v-if="isTruncated" class="text-xs text-muted-foreground">
                Showing the top {{ breakdownLimit }} by Total Token Activity;
                shares are of the filtered total.
            </p>
        </section>

        <section
            :aria-labelledby="`${id}-explain`"
            class="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4"
        >
            <h2 :id="`${id}-explain`" class="text-base font-semibold">
                How these numbers are calculated
            </h2>
            <ul class="flex flex-col gap-2 text-sm">
                <li>
                    <span class="font-medium">Total Token Activity</span> =
                    Input + Output + Cache Creation + Cache Read
                </li>
                <li>
                    <span class="font-medium">Actual Consumed Tokens</span> =
                    Input + Output + Cache Creation (Cache Read excluded)
                </li>
            </ul>
            <p class="text-sm text-muted-foreground">
                Actual Consumed Tokens is a monitoring calculation, not an
                Anthropic billing or quota value.
            </p>
            <div class="flex flex-col gap-2 text-sm">
                <p class="font-medium">Example</p>
                <dl
                    class="grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums"
                >
                    <dt class="text-muted-foreground">Input Tokens</dt>
                    <dd class="text-right">100,000</dd>
                    <dt class="text-muted-foreground">Output Tokens</dt>
                    <dd class="text-right">20,000</dd>
                    <dt class="text-muted-foreground">Cache Creation Tokens</dt>
                    <dd class="text-right">30,000</dd>
                    <dt class="text-muted-foreground">Cache Read Tokens</dt>
                    <dd class="text-right">500,000</dd>
                    <dt class="border-t pt-1 font-medium">
                        Total Token Activity
                    </dt>
                    <dd class="border-t pt-1 text-right font-medium">
                        650,000
                    </dd>
                    <dt class="font-medium">Actual Consumed Tokens</dt>
                    <dd class="text-right font-medium">150,000</dd>
                </dl>
            </div>
        </section>
    </div>
</template>
