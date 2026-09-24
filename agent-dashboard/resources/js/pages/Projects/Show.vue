<script setup lang="ts">
import { Head, Link, setLayoutProps, usePage } from '@inertiajs/vue3';
import { computed, watchEffect } from 'vue';
import DateRangeFilter from '@/components/monitor/DateRangeFilter.vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import MetricCard from '@/components/monitor/MetricCard.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import TokenMetricsGrid from '@/components/monitor/TokenMetricsGrid.vue';
import TrendChart from '@/components/monitor/TrendChart.vue';
import {
    formatDateTime,
    formatDuration,
    formatTokens,
    formatTokensFull,
} from '@/lib/format';
import { show as developerShow } from '@/routes/developers';
import { show as deviceShow } from '@/routes/devices';
import { index as projectsIndex, show as projectShow } from '@/routes/projects';
import { show as sessionShow } from '@/routes/sessions';
import type { BreadcrumbItem } from '@/types';
import type {
    DateRangeProps,
    SessionRow,
    TokenTotals,
    TrendPoint,
} from '@/types/monitor';

type ProjectDetail = {
    id: number;
    name: string;
    git_remote: string | null;
    first_activity_at: string | null;
    last_activity_at: string | null;
};

type ProjectPathRow = {
    id: number;
    path: string;
    device: string;
    device_uid: string;
    developer: string;
    first_seen_at: string | null;
    last_seen_at: string | null;
};

type TokenColumns = {
    total_token_activity: number;
    actual_consumed_tokens: number;
    cache_read_tokens: number;
};

type ProjectDeveloperRow = TokenColumns & {
    id: number;
    name: string;
    email: string;
    sessions_count: number;
    last_activity_at: string | null;
};

type ProjectDeviceRow = TokenColumns & {
    id: number;
    device_uid: string;
    label: string;
    platform: string;
    developer: string;
    sessions_count: number;
    last_activity_at: string | null;
};

type Props = {
    project: ProjectDetail;
    range: DateRangeProps;
    totals: TokenTotals;
    trend: TrendPoint[];
    sessionsCount: number;
    paths: ProjectPathRow[];
    developers: ProjectDeveloperRow[];
    devices: ProjectDeviceRow[];
    recentSessions: SessionRow[];
};

const props = defineProps<Props>();

const page = usePage();

watchEffect(() => {
    setLayoutProps<{ breadcrumbs: BreadcrumbItem[] }>({
        breadcrumbs: [
            { title: 'Projects', href: projectsIndex().url },
            {
                title: props.project.name,
                href: projectShow(props.project.id).url,
            },
        ],
    });
});

const timezone = computed<string>(() => {
    const monitor = page.props.monitor as { timezone?: unknown } | undefined;

    return typeof monitor?.timezone === 'string'
        ? monitor.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone;
});

const tokenColumns: { field: keyof TokenColumns; label: string }[] = [
    { field: 'total_token_activity', label: 'Total Token Activity' },
    { field: 'actual_consumed_tokens', label: 'Actual Consumed Tokens' },
    { field: 'cache_read_tokens', label: 'Cache Read Tokens' },
];

const linkClass =
    'rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50';
const headCellClass = 'px-4 py-2.5 text-left font-medium whitespace-nowrap';
const headNumericClass = 'px-4 py-2.5 text-right font-medium whitespace-nowrap';
const cellClass = 'px-4 py-2.5 text-left';
const numericCellClass = 'px-4 py-2.5 text-right tabular-nums';
</script>

<template>
    <Head :title="project.name" />

    <div class="flex flex-1 flex-col gap-8 p-4">
        <header class="flex flex-col gap-3">
            <div class="flex min-w-0 flex-col gap-1">
                <h1 class="text-xl font-semibold tracking-tight break-words">
                    {{ project.name }}
                </h1>
                <p
                    v-if="project.git_remote"
                    class="font-mono text-sm break-all text-muted-foreground"
                >
                    {{ project.git_remote }}
                </p>
                <p v-else class="text-sm text-muted-foreground">
                    No git remote — identified by path
                </p>
            </div>
            <dl class="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div class="flex gap-1.5">
                    <dt class="text-muted-foreground">First activity</dt>
                    <dd>
                        <RelativeTime :value="project.first_activity_at" />
                    </dd>
                </div>
                <div class="flex gap-1.5">
                    <dt class="text-muted-foreground">Last activity</dt>
                    <dd>
                        <RelativeTime :value="project.last_activity_at" />
                    </dd>
                </div>
            </dl>
        </header>

        <DateRangeFilter :range="range" />

        <section aria-labelledby="project-activity-heading" class="space-y-4">
            <h2 id="project-activity-heading" class="sr-only">Activity</h2>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard label="Sessions" :value="sessionsCount" />
            </div>
            <TokenMetricsGrid :totals="totals" />
        </section>

        <section class="rounded-lg border p-4">
            <TrendChart :points="trend" title="Usage trend" />
        </section>

        <section aria-labelledby="project-paths-heading" class="space-y-3">
            <h2 id="project-paths-heading" class="text-base font-semibold">
                Paths
            </h2>
            <EmptyState
                v-if="paths.length === 0"
                title="No paths recorded"
                description="No local paths have been reported for this project."
            />
            <div v-else class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[36rem] text-sm">
                    <thead class="bg-muted/50 text-muted-foreground">
                        <tr class="border-b">
                            <th scope="col" :class="headCellClass">Path</th>
                            <th scope="col" :class="headCellClass">Device</th>
                            <th scope="col" :class="headCellClass">
                                Developer
                            </th>
                            <th scope="col" :class="headCellClass">
                                Last seen
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="row in paths"
                            :key="row.id"
                            class="border-b last:border-b-0 hover:bg-muted/30"
                        >
                            <th
                                scope="row"
                                class="px-4 py-2.5 text-left font-mono text-xs font-normal break-all"
                            >
                                {{ row.path }}
                            </th>
                            <td :class="cellClass">
                                <Link
                                    :href="
                                        deviceShow({ device: row.device_uid })
                                            .url
                                    "
                                    :class="linkClass"
                                >
                                    {{ row.device }}
                                </Link>
                            </td>
                            <td :class="cellClass">{{ row.developer }}</td>
                            <td :class="[cellClass, 'whitespace-nowrap']">
                                <RelativeTime :value="row.last_seen_at" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <section aria-labelledby="project-developers-heading" class="space-y-3">
            <h2 id="project-developers-heading" class="text-base font-semibold">
                Developers
            </h2>
            <EmptyState
                v-if="developers.length === 0"
                title="No developers recorded"
            />
            <div v-else class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[48rem] text-sm">
                    <thead class="bg-muted/50 text-muted-foreground">
                        <tr class="border-b">
                            <th scope="col" :class="headCellClass">
                                Developer
                            </th>
                            <th scope="col" :class="headNumericClass">
                                Sessions
                            </th>
                            <th
                                v-for="column in tokenColumns"
                                :key="column.field"
                                scope="col"
                                :class="headNumericClass"
                            >
                                {{ column.label }}
                            </th>
                            <th scope="col" :class="headCellClass">
                                Last activity
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="row in developers"
                            :key="row.id"
                            class="border-b last:border-b-0 hover:bg-muted/30"
                        >
                            <th
                                scope="row"
                                class="px-4 py-2.5 text-left font-normal"
                            >
                                <div class="flex flex-col">
                                    <Link
                                        :href="
                                            developerShow({ developer: row.id })
                                                .url
                                        "
                                        :class="linkClass"
                                    >
                                        {{ row.name }}
                                    </Link>
                                    <span
                                        class="text-xs break-all text-muted-foreground"
                                    >
                                        {{ row.email }}
                                    </span>
                                </div>
                            </th>
                            <td :class="numericCellClass">
                                {{ formatTokensFull(row.sessions_count) }}
                            </td>
                            <td
                                v-for="column in tokenColumns"
                                :key="column.field"
                                :class="numericCellClass"
                                :title="formatTokensFull(row[column.field])"
                            >
                                {{ formatTokens(row[column.field]) }}
                            </td>
                            <td :class="[cellClass, 'whitespace-nowrap']">
                                <RelativeTime :value="row.last_activity_at" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <section aria-labelledby="project-devices-heading" class="space-y-3">
            <h2 id="project-devices-heading" class="text-base font-semibold">
                Devices
            </h2>
            <EmptyState
                v-if="devices.length === 0"
                title="No devices recorded"
            />
            <div v-else class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[56rem] text-sm">
                    <thead class="bg-muted/50 text-muted-foreground">
                        <tr class="border-b">
                            <th scope="col" :class="headCellClass">Device</th>
                            <th scope="col" :class="headCellClass">
                                Developer
                            </th>
                            <th scope="col" :class="headNumericClass">
                                Sessions
                            </th>
                            <th
                                v-for="column in tokenColumns"
                                :key="column.field"
                                scope="col"
                                :class="headNumericClass"
                            >
                                {{ column.label }}
                            </th>
                            <th scope="col" :class="headCellClass">
                                Last activity
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="row in devices"
                            :key="row.id"
                            class="border-b last:border-b-0 hover:bg-muted/30"
                        >
                            <th
                                scope="row"
                                class="px-4 py-2.5 text-left font-normal"
                            >
                                <div class="flex flex-col">
                                    <Link
                                        :href="
                                            deviceShow({
                                                device: row.device_uid,
                                            }).url
                                        "
                                        :class="linkClass"
                                    >
                                        {{ row.label }}
                                    </Link>
                                    <span class="text-xs text-muted-foreground">
                                        {{ row.platform }}
                                    </span>
                                </div>
                            </th>
                            <td :class="cellClass">{{ row.developer }}</td>
                            <td :class="numericCellClass">
                                {{ formatTokensFull(row.sessions_count) }}
                            </td>
                            <td
                                v-for="column in tokenColumns"
                                :key="column.field"
                                :class="numericCellClass"
                                :title="formatTokensFull(row[column.field])"
                            >
                                {{ formatTokens(row[column.field]) }}
                            </td>
                            <td :class="[cellClass, 'whitespace-nowrap']">
                                <RelativeTime :value="row.last_activity_at" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <section aria-labelledby="project-sessions-heading" class="space-y-3">
            <h2 id="project-sessions-heading" class="text-base font-semibold">
                Recent sessions
            </h2>
            <EmptyState
                v-if="recentSessions.length === 0"
                title="No sessions in this period"
            />
            <div v-else class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[44rem] text-sm">
                    <thead class="bg-muted/50 text-muted-foreground">
                        <tr class="border-b">
                            <th scope="col" :class="headCellClass">
                                Developer
                            </th>
                            <th scope="col" :class="headCellClass">Model</th>
                            <th scope="col" :class="headCellClass">Device</th>
                            <th scope="col" :class="headCellClass">Start</th>
                            <th scope="col" :class="headNumericClass">
                                Duration
                            </th>
                            <th scope="col" :class="headNumericClass">
                                Token Activity
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="row in recentSessions"
                            :key="row.id"
                            class="border-b last:border-b-0 hover:bg-muted/30"
                        >
                            <th
                                scope="row"
                                class="px-4 py-2.5 text-left font-normal"
                            >
                                {{ row.developer }}
                            </th>
                            <td :class="cellClass">
                                <span
                                    v-if="row.model"
                                    class="font-mono text-xs"
                                >
                                    {{ row.model }}
                                </span>
                                <span v-else class="text-muted-foreground">
                                    —
                                </span>
                            </td>
                            <td :class="cellClass">{{ row.device }}</td>
                            <td :class="[cellClass, 'whitespace-nowrap']">
                                <Link
                                    :href="sessionShow({ session: row.id }).url"
                                    :class="linkClass"
                                >
                                    <time :datetime="row.started_at">
                                        {{
                                            formatDateTime(
                                                row.started_at,
                                                timezone,
                                            )
                                        }}
                                    </time>
                                </Link>
                            </td>
                            <td
                                :class="[numericCellClass, 'whitespace-nowrap']"
                            >
                                {{ formatDuration(row.duration_seconds) }}
                            </td>
                            <td
                                :class="numericCellClass"
                                :title="
                                    formatTokensFull(row.total_token_activity)
                                "
                            >
                                {{ formatTokens(row.total_token_activity) }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
    </div>
</template>
