<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3';
import { FolderGit2, Laptop, TerminalSquare, Users } from '@lucide/vue';
import { computed } from 'vue';
import BreakdownTable from '@/components/monitor/BreakdownTable.vue';
import DateRangeFilter from '@/components/monitor/DateRangeFilter.vue';
import MetricCard from '@/components/monitor/MetricCard.vue';
import TokenMetricsGrid from '@/components/monitor/TokenMetricsGrid.vue';
import TrendChart from '@/components/monitor/TrendChart.vue';
import AgentHealthPanel from '@/pages/Overview/AgentHealthPanel.vue';
import OverviewSection from '@/pages/Overview/OverviewSection.vue';
import {
    describeRange,
    formatDay,
    rangeQuery,
    sessionsLabel,
} from '@/pages/Overview/range';
import RecentSessionsTable from '@/pages/Overview/RecentSessionsTable.vue';
import { dashboard } from '@/routes';
import { tokens as tokenAnalytics } from '@/routes/analytics';
import {
    index as developersIndex,
    show as developerShow,
} from '@/routes/developers';
import { index as devicesIndex } from '@/routes/devices';
import { index as projectsIndex, show as projectShow } from '@/routes/projects';
import { index as sessionsIndex } from '@/routes/sessions';
import type {
    AgentHealthSummary,
    BreakdownRow,
    DateRangeProps,
    ProblemAgent,
    SessionRow,
    TokenTotals,
    TrendPoint,
} from '@/types/monitor';

type Kpis = {
    totalDevelopers: number;
    activeDevices: number;
    sessionsInRange: number;
    activeProjects: number;
};

const props = defineProps<{
    range: DateRangeProps;
    kpis: Kpis;
    tokens: TokenTotals;
    trend: TrendPoint[];
    topDevelopers: BreakdownRow[];
    topProjects: BreakdownRow[];
    topModels: BreakdownRow[];
    recentSessions: SessionRow[];
    agentHealth: AgentHealthSummary;
    problemAgents: ProblemAgent[];
}>();

defineOptions({
    layout: {
        breadcrumbs: [
            {
                title: 'Overview',
                href: dashboard(),
            },
        ],
    },
});

const query = computed(() => rangeQuery(props.range));
const rangeText = computed(() => describeRange(props.range));
const isSingleDay = computed(() => props.range.from === props.range.to);

const trendDescription = computed(() =>
    isSingleDay.value
        ? `Daily totals for the 14 days ending ${formatDay(props.range.to)}. Hourly trends are not available, so the selected day is the last point.`
        : `Token activity for ${rangeText.value}.`,
);

const page = usePage();
const rangeError = computed<string | null>(() => {
    const errors = page.props.errors as Record<string, string> | undefined;

    return errors?.from ?? errors?.to ?? null;
});

function developerLink(row: BreakdownRow): string | null {
    return row.id === null
        ? null
        : developerShow.url(row.id, { query: query.value });
}

function projectLink(row: BreakdownRow): string | null {
    return row.id === null
        ? null
        : projectShow.url(row.id, { query: query.value });
}

function modelLink(row: BreakdownRow): string | null {
    return row.id === null
        ? null
        : tokenAnalytics.url({ query: { ...query.value, model: row.id } });
}
</script>

<template>
    <Head title="Overview" />

    <div class="flex min-w-0 flex-1 flex-col gap-6 p-4">
        <header class="flex flex-col gap-3">
            <div>
                <h1 class="text-xl font-semibold tracking-tight">
                    Organization overview
                </h1>
                <p class="text-sm text-muted-foreground">
                    Claude Code activity for {{ rangeText }}.
                </p>
            </div>
            <DateRangeFilter :range="range" />
            <p v-if="rangeError" role="alert" class="text-sm text-destructive">
                {{ rangeError }}
            </p>
        </header>

        <section
            aria-label="Activity"
            class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
            <MetricCard
                label="Total developers"
                :value="kpis.totalDevelopers"
                :icon="Users"
                hint="Active developers, all time"
            />
            <MetricCard
                label="Active devices"
                :value="kpis.activeDevices"
                :icon="Laptop"
                hint="Agents seen or with sessions in this period"
            />
            <MetricCard
                :label="sessionsLabel(range)"
                :value="kpis.sessionsInRange"
                :icon="TerminalSquare"
                hint="Claude Code sessions started"
            />
            <MetricCard
                label="Active projects"
                :value="kpis.activeProjects"
                :icon="FolderGit2"
                hint="Projects with session activity"
            />
        </section>

        <OverviewSection
            title="Token metrics"
            :description="`Token activity for ${rangeText}.`"
            :href="tokenAnalytics.url({ query })"
            link-label="Token analytics"
        >
            <TokenMetricsGrid :totals="tokens" />
        </OverviewSection>

        <OverviewSection title="Usage trends" :description="trendDescription">
            <TrendChart :points="trend" title="Token trend" />
        </OverviewSection>

        <div class="grid grid-cols-1 gap-6">
            <OverviewSection
                title="Top developers"
                :href="developersIndex.url({ query })"
            >
                <BreakdownTable
                    :rows="topDevelopers"
                    dimension-label="Developer"
                    :link-for="developerLink"
                />
            </OverviewSection>
            <OverviewSection
                title="Top projects"
                :href="projectsIndex.url({ query })"
            >
                <BreakdownTable
                    :rows="topProjects"
                    dimension-label="Project"
                    :link-for="projectLink"
                />
            </OverviewSection>
            <OverviewSection
                title="Top models"
                :href="tokenAnalytics.url({ query })"
                link-label="Token analytics"
            >
                <BreakdownTable
                    :rows="topModels"
                    dimension-label="Model"
                    :link-for="modelLink"
                />
            </OverviewSection>
        </div>

        <OverviewSection
            title="Recent activity"
            description="The latest sessions active in this period."
            :href="sessionsIndex.url({ query })"
        >
            <RecentSessionsTable :sessions="recentSessions" />
        </OverviewSection>

        <OverviewSection
            title="Offline/stale Agents"
            description="Current status of active agents that are stale, offline, failing to sync or outdated. Not affected by the date filter."
            :href="devicesIndex.url()"
            link-label="All devices"
        >
            <AgentHealthPanel :summary="agentHealth" :agents="problemAgents" />
        </OverviewSection>
    </div>
</template>
