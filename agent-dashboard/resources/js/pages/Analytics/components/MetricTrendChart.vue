<script setup lang="ts">
import type { ChartData, ChartOptions, TooltipItem } from 'chart.js';
import {
    CategoryScale,
    Chart as ChartJS,
    Filler,
    LinearScale,
    LineElement,
    PointElement,
    Tooltip,
} from 'chart.js';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Line } from 'vue-chartjs';
import EmptyState from '@/components/monitor/EmptyState.vue';
import { formatTokens, formatTokensFull } from '@/lib/format';
import type { TrendPoint } from '@/types/monitor';
import type { MetricDefinition } from './metrics';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Tooltip,
    Filler,
);

type Props = {
    points: TrendPoint[];
    metric: MetricDefinition;
    granularityLabel: string;
};

const props = defineProps<Props>();

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

function withAlpha(color: string, alpha: number): string {
    const fn = /^(hsl|rgb|oklch|oklab|lab|lch)a?\(([^/)]*)\)$/i.exec(color);

    if (fn) {
        const args = fn[2].trim();

        return args.includes(',')
            ? `${fn[1]}(${args}, ${alpha})`
            : `${fn[1]}(${args} / ${alpha})`;
    }

    if (/^#[0-9a-f]{6}$/i.test(color)) {
        return `${color}${Math.round(alpha * 255)
            .toString(16)
            .padStart(2, '0')}`;
    }

    return 'transparent';
}

const palette = computed(() => {
    void themeVersion.value;

    const series = cssVar('--chart-1', '#3b82f6');

    return {
        series,
        fill: withAlpha(series, 0.12),
        surface: cssVar('--card', '#ffffff'),
        text: cssVar('--muted-foreground', '#737373'),
        grid: cssVar('--border', '#e5e5e5'),
    };
});

const values = computed(() =>
    props.points.map((point) => point[props.metric.field]),
);

const isEmpty = computed(
    () =>
        props.points.length === 0 || values.value.every((value) => value === 0),
);

const chartData = computed<ChartData<'line'>>(() => ({
    labels: props.points.map((point) => point.label),
    datasets: [
        {
            label: props.metric.label,
            data: values.value,
            borderColor: palette.value.series,
            backgroundColor: palette.value.fill,
            pointBackgroundColor: palette.value.series,
            pointBorderColor: palette.value.surface,
            pointBorderWidth: 2,
            borderWidth: 2,
            pointRadius: props.points.length > 40 ? 0 : 4,
            pointHoverRadius: 6,
            pointHitRadius: 12,
            tension: 0.3,
            fill: 'origin',
        },
    ],
}));

const chartOptions = computed<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
        legend: { display: false },
        tooltip: {
            displayColors: false,
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

const captionText = computed(
    () => `${props.granularityLabel} ${props.metric.label}`,
);

const ariaLabel = computed(() => {
    const total = values.value.reduce((sum, value) => sum + value, 0);
    const first = props.points[0]?.label ?? '';
    const last = props.points[props.points.length - 1]?.label ?? '';

    return `${props.granularityLabel} ${props.metric.label} line chart from ${first} to ${last}, ${props.points.length} periods, ${formatTokensFull(total)} in total`;
});
</script>

<template>
    <div class="flex flex-col gap-3">
        <EmptyState
            v-if="isEmpty"
            :description="`No ${metric.label} recorded for the selected range and filters.`"
        />
        <template v-else>
            <div class="relative h-72">
                <Line
                    :data="chartData"
                    :options="chartOptions"
                    :aria-label="ariaLabel"
                    role="img"
                />
            </div>
            <details class="group text-sm">
                <summary
                    class="w-fit cursor-pointer rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    View as table
                </summary>
                <div class="mt-2 max-h-72 overflow-auto rounded-lg border">
                    <table class="w-full text-sm">
                        <caption class="sr-only">
                            {{
                                captionText
                            }}
                        </caption>
                        <thead
                            class="sticky top-0 bg-muted text-muted-foreground"
                        >
                            <tr class="border-b">
                                <th
                                    scope="col"
                                    class="px-4 py-2 text-left font-medium"
                                >
                                    Period
                                </th>
                                <th
                                    scope="col"
                                    class="px-4 py-2 text-right font-medium"
                                >
                                    {{ metric.label }}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="point in points"
                                :key="point.period"
                                class="border-b last:border-b-0"
                            >
                                <th
                                    scope="row"
                                    class="px-4 py-2 text-left font-normal"
                                >
                                    {{ point.label }}
                                </th>
                                <td class="px-4 py-2 text-right tabular-nums">
                                    {{ formatTokensFull(point[metric.field]) }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </details>
        </template>
    </div>
</template>
