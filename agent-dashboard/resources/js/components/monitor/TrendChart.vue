<script setup lang="ts">
import type { ChartData, ChartOptions, TooltipItem } from 'chart.js';
import {
    CategoryScale,
    Chart as ChartJS,
    Filler,
    Legend,
    LinearScale,
    LineElement,
    PointElement,
    Tooltip,
} from 'chart.js';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Line } from 'vue-chartjs';
import EmptyState from '@/components/monitor/EmptyState.vue';
import { Button } from '@/components/ui/button';
import { formatTokens, formatTokensFull } from '@/lib/format';
import type { TrendPoint } from '@/types/monitor';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Tooltip,
    Legend,
    Filler,
);

type SeriesKey = 'total' | 'actual' | 'cache_read';

type Props = {
    points: TrendPoint[];
    series?: SeriesKey[];
    title?: string;
};

const props = withDefaults(defineProps<Props>(), {
    series: () => ['total', 'actual', 'cache_read'],
    title: undefined,
});

const seriesDefinitions: {
    key: SeriesKey;
    label: string;
    field:
        | 'total_token_activity'
        | 'actual_consumed_tokens'
        | 'cache_read_tokens';
    colorVar: string;
    fallback: string;
}[] = [
    {
        key: 'total',
        label: 'Total Token Activity',
        field: 'total_token_activity',
        colorVar: '--chart-1',
        fallback: '#3b82f6',
    },
    {
        key: 'actual',
        label: 'Actual Consumed Tokens',
        field: 'actual_consumed_tokens',
        colorVar: '--chart-2',
        fallback: '#10b981',
    },
    {
        key: 'cache_read',
        label: 'Cache Read Tokens',
        field: 'cache_read_tokens',
        colorVar: '--chart-3',
        fallback: '#f59e0b',
    },
];

const selected = ref<SeriesKey[]>([...props.series]);

watch(
    () => props.series.join(','),
    () => {
        selected.value = [...props.series];
    },
);

function isSelected(key: SeriesKey): boolean {
    return selected.value.includes(key);
}

function toggleSeries(key: SeriesKey): void {
    if (isSelected(key)) {
        if (selected.value.length > 1) {
            selected.value = selected.value.filter((item) => item !== key);
        }

        return;
    }

    selected.value = seriesDefinitions
        .map((definition) => definition.key)
        .filter((item) => item === key || selected.value.includes(item));
}

const themeVersion = ref(0);
let observer: MutationObserver | undefined;

onMounted(() => {
    themeVersion.value++;
    observer = new MutationObserver(() => {
        themeVersion.value++;
    });
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
    });
});

onBeforeUnmount(() => {
    observer?.disconnect();
});

function cssVar(name: string, fallback: string): string {
    if (typeof window === 'undefined') {
        return fallback;
    }

    const value = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();

    return value === '' ? fallback : value;
}

const palette = computed(() => {
    void themeVersion.value;

    return {
        series: Object.fromEntries(
            seriesDefinitions.map((definition) => [
                definition.key,
                cssVar(definition.colorVar, definition.fallback),
            ]),
        ) as Record<SeriesKey, string>,
        text: cssVar('--muted-foreground', '#737373'),
        grid: cssVar('--border', '#e5e5e5'),
    };
});

const isEmpty = computed(
    () =>
        props.points.length === 0 ||
        props.points.every(
            (point) =>
                point.total_token_activity === 0 &&
                point.actual_consumed_tokens === 0 &&
                point.cache_read_tokens === 0,
        ),
);

const chartData = computed<ChartData<'line'>>(() => ({
    labels: props.points.map((point) => point.label),
    datasets: seriesDefinitions
        .filter((definition) => isSelected(definition.key))
        .map((definition) => ({
            label: definition.label,
            data: props.points.map((point) => point[definition.field]),
            borderColor: palette.value.series[definition.key],
            backgroundColor: palette.value.series[definition.key],
            borderWidth: 2,
            pointRadius: props.points.length > 40 ? 0 : 3,
            pointHoverRadius: 5,
            tension: 0.3,
            fill: false,
        })),
}));

const chartOptions = computed<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
        legend: { display: false },
        tooltip: {
            callbacks: {
                label: (item: TooltipItem<'line'>) =>
                    `${item.dataset.label ?? ''}: ${formatTokensFull(Number(item.parsed.y))}`,
            },
        },
    },
    scales: {
        x: {
            ticks: {
                color: palette.value.text,
                maxRotation: 0,
                autoSkip: true,
            },
            grid: { display: false },
            border: { color: palette.value.grid },
        },
        y: {
            beginAtZero: true,
            ticks: {
                color: palette.value.text,
                callback: (value: string | number) =>
                    formatTokens(Number(value)),
            },
            grid: { color: palette.value.grid },
            border: { display: false },
        },
    },
}));

const ariaLabel = computed(() => {
    const labels = seriesDefinitions
        .filter((definition) => isSelected(definition.key))
        .map((definition) => definition.label)
        .join(', ');

    return `${props.title ?? 'Token trend'} line chart showing ${labels}`;
});
</script>

<template>
    <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 v-if="title" class="text-sm font-medium">{{ title }}</h3>
            <div
                role="group"
                aria-label="Chart series"
                class="flex flex-wrap items-center gap-1.5"
            >
                <Button
                    v-for="definition in seriesDefinitions"
                    :key="definition.key"
                    type="button"
                    size="sm"
                    variant="outline"
                    :aria-pressed="isSelected(definition.key)"
                    :class="isSelected(definition.key) ? '' : 'opacity-60'"
                    @click="toggleSeries(definition.key)"
                >
                    <span
                        class="size-2.5 rounded-full"
                        :style="{
                            backgroundColor: palette.series[definition.key],
                        }"
                        aria-hidden="true"
                    />
                    {{ definition.label }}
                </Button>
            </div>
        </div>
        <EmptyState v-if="isEmpty" />
        <div v-else class="relative h-72">
            <Line
                :data="chartData"
                :options="chartOptions"
                :aria-label="ariaLabel"
                role="img"
            />
        </div>
    </div>
</template>
