<script setup lang="ts">
import { Head, Link, router, setLayoutProps, usePage } from '@inertiajs/vue3';
import { Search } from '@lucide/vue';
import { computed, onBeforeUnmount, ref, useId, watch, watchEffect } from 'vue';
import DataTable from '@/components/monitor/DataTable.vue';
import DateRangeFilter from '@/components/monitor/DateRangeFilter.vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import EntityFilters from '@/components/monitor/EntityFilters.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import StatusBadge from '@/components/monitor/StatusBadge.vue';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    formatDateTime,
    formatDuration,
    formatTokens,
    formatTokensFull,
} from '@/lib/format';
import {
    index as sessionsIndex,
    show as sessionsShow,
} from '@/routes/sessions';
import type { BreadcrumbItem } from '@/types';
import type {
    DataTableColumn,
    DateRangeProps,
    FilterOptions,
    FilterValues,
    Paginated,
    SessionRow,
    SessionStatus,
    SortDirection,
} from '@/types/monitor';

type SessionListRow = SessionRow & { status: SessionStatus };

type SessionSort =
    | 'started_at'
    | 'last_activity_at'
    | 'duration_seconds'
    | 'total_token_activity'
    | 'actual_consumed_tokens';

const props = defineProps<{
    sessions: Paginated<SessionListRow>;
    range: DateRangeProps;
    options: FilterOptions;
    filters: FilterValues & { search: string };
    sort: SessionSort;
    direction: SortDirection;
}>();

const page = usePage();
const id = useId();

watchEffect(() => {
    setLayoutProps<{ breadcrumbs: BreadcrumbItem[] }>({
        breadcrumbs: [{ title: 'Sessions', href: sessionsIndex() }],
    });
});

const timezone = computed<string>(() => {
    const monitor = page.props.monitor as { timezone?: unknown } | undefined;

    return typeof monitor?.timezone === 'string'
        ? monitor.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone;
});

const columns: DataTableColumn[] = [
    { key: 'developer', label: 'Developer' },
    { key: 'project', label: 'Project' },
    { key: 'model', label: 'Model' },
    { key: 'device', label: 'Device' },
    { key: 'started_at', label: 'Start', sortable: true },
    {
        key: 'duration_seconds',
        label: 'Duration',
        sortable: true,
        align: 'right',
    },
    {
        key: 'total_token_activity',
        label: 'Token Activity',
        sortable: true,
        align: 'right',
    },
    {
        key: 'actual_consumed_tokens',
        label: 'Actual Consumed',
        sortable: true,
        align: 'right',
    },
    { key: 'last_activity_at', label: 'Last activity', sortable: true },
];

const search = ref(props.filters.search ?? '');
let searchTimer: ReturnType<typeof setTimeout> | undefined;

watch(
    () => props.filters.search,
    (value) => {
        if (searchTimer === undefined) {
            search.value = value ?? '';
        }
    },
);

function applySearch(): void {
    searchTimer = undefined;

    const origin =
        typeof window !== 'undefined'
            ? window.location.origin
            : 'http://localhost';
    const url = new URL(page.url, origin);
    const query: Record<string, string> = Object.fromEntries(
        url.searchParams.entries(),
    );
    delete query.page;

    const term = search.value.trim();

    if (term === '') {
        delete query.search;
    } else {
        query.search = term;
    }

    router.get(url.pathname, query, {
        preserveState: true,
        preserveScroll: true,
        replace: true,
    });
}

function onSearchInput(value: string | number): void {
    search.value = String(value);

    if (searchTimer !== undefined) {
        clearTimeout(searchTimer);
    }

    searchTimer = setTimeout(applySearch, 300);
}

onBeforeUnmount(() => {
    if (searchTimer !== undefined) {
        clearTimeout(searchTimer);
    }
});

const hasFilters = computed<boolean>(
    () =>
        (props.filters.search ?? '') !== '' ||
        (['developer', 'device', 'account', 'project', 'model'] as const).some(
            (key) =>
                props.filters[key] !== null && props.filters[key] !== undefined,
        ),
);
</script>

<template>
    <Head title="Sessions" />

    <div class="flex flex-1 flex-col gap-6 p-4">
        <h1 class="text-xl font-semibold tracking-tight">Sessions</h1>

        <section aria-label="Session filters" class="flex flex-col gap-4">
            <DateRangeFilter :range="range" />
            <div class="flex flex-wrap items-end gap-3">
                <div class="grid w-full gap-1.5 sm:w-72">
                    <Label :for="`${id}-search`">Search</Label>
                    <div class="relative">
                        <Search
                            class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                        />
                        <Input
                            :id="`${id}-search`"
                            type="search"
                            name="search"
                            autocomplete="off"
                            placeholder="Session ID, project or developer"
                            class="pl-8"
                            :model-value="search"
                            @update:model-value="onSearchInput"
                        />
                    </div>
                </div>
            </div>
            <EntityFilters :options="options" :values="filters" />
        </section>

        <DataTable
            :paginator="sessions"
            :columns="columns"
            :sort="sort"
            :direction="direction"
        >
            <template #cell-developer="{ row }">
                <Link
                    :href="sessionsShow(row.id)"
                    class="font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline"
                >
                    {{ row.developer }}
                </Link>
            </template>
            <template #cell-project="{ row }">
                <span v-if="row.project">{{ row.project }}</span>
                <span v-else class="text-muted-foreground">—</span>
            </template>
            <template #cell-model="{ row }">
                <span v-if="row.model">{{ row.model }}</span>
                <span v-else class="text-muted-foreground">—</span>
            </template>
            <template #cell-started_at="{ row }">
                <Link
                    :href="sessionsShow(row.id)"
                    class="whitespace-nowrap underline-offset-4 hover:underline focus-visible:underline"
                    :aria-label="`Open session started ${formatDateTime(row.started_at, timezone)}`"
                >
                    {{ formatDateTime(row.started_at, timezone) }}
                </Link>
            </template>
            <template #cell-duration_seconds="{ row }">
                <span class="whitespace-nowrap tabular-nums">
                    {{ formatDuration(row.duration_seconds) }}
                </span>
            </template>
            <template #cell-total_token_activity="{ row }">
                <span
                    class="tabular-nums"
                    :title="formatTokensFull(row.total_token_activity)"
                >
                    {{ formatTokens(row.total_token_activity) }}
                </span>
            </template>
            <template #cell-actual_consumed_tokens="{ row }">
                <span
                    class="tabular-nums"
                    :title="formatTokensFull(row.actual_consumed_tokens)"
                >
                    {{ formatTokens(row.actual_consumed_tokens) }}
                </span>
            </template>
            <template #cell-last_activity_at="{ row }">
                <div class="flex items-center gap-2 whitespace-nowrap">
                    <RelativeTime
                        :value="row.last_activity_at"
                        :timezone="timezone"
                    />
                    <StatusBadge kind="session" :status="row.status" />
                </div>
            </template>
            <template #empty>
                <EmptyState
                    v-if="hasFilters"
                    title="No sessions match these filters"
                    description="Try a different date range, search term or filter."
                />
                <EmptyState
                    v-else
                    title="No sessions for this period"
                    description="Sessions appear here once agents sync Claude Code activity."
                />
            </template>
        </DataTable>
    </div>
</template>
