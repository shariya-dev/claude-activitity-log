<script setup lang="ts">
import { Head, Link, router, setLayoutProps, usePage } from '@inertiajs/vue3';
import { FolderGit2, Search } from '@lucide/vue';
import { onBeforeUnmount, ref, useId, watch, watchEffect } from 'vue';
import DataTable from '@/components/monitor/DataTable.vue';
import DateRangeFilter from '@/components/monitor/DateRangeFilter.vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import EntityFilters from '@/components/monitor/EntityFilters.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatTokens, formatTokensFull } from '@/lib/format';
import { index as projectsIndex, show as projectShow } from '@/routes/projects';
import type { BreadcrumbItem } from '@/types';
import type {
    DataTableColumn,
    DateRangeProps,
    FilterOption,
    Paginated,
    SortDirection,
} from '@/types/monitor';

type ProjectSort =
    | 'name'
    | 'developers_count'
    | 'devices_count'
    | 'sessions_count'
    | 'total_token_activity'
    | 'actual_consumed_tokens'
    | 'cache_read_tokens'
    | 'last_activity_at';

type ProjectListRow = {
    id: number;
    name: string;
    git_remote: string | null;
    developers_count: number;
    devices_count: number;
    sessions_count: number;
    total_token_activity: number;
    actual_consumed_tokens: number;
    cache_read_tokens: number;
    last_activity_at: string | null;
};

type Props = {
    range: DateRangeProps;
    filters: { search: string; developer: number | null };
    filterOptions: { developer: FilterOption[] };
    sort: ProjectSort;
    direction: SortDirection;
    projects: Paginated<ProjectListRow>;
};

const props = defineProps<Props>();

const page = usePage();
const searchId = useId();

watchEffect(() => {
    setLayoutProps<{ breadcrumbs: BreadcrumbItem[] }>({
        breadcrumbs: [{ title: 'Projects', href: projectsIndex().url }],
    });
});

const columns: DataTableColumn[] = [
    { key: 'name', label: 'Project', sortable: true, class: 'min-w-48' },
    {
        key: 'developers_count',
        label: 'Developers',
        sortable: true,
        align: 'right',
    },
    { key: 'devices_count', label: 'Devices', sortable: true, align: 'right' },
    {
        key: 'sessions_count',
        label: 'Sessions',
        sortable: true,
        align: 'right',
    },
    {
        key: 'total_token_activity',
        label: 'Total Token Activity',
        sortable: true,
        align: 'right',
    },
    {
        key: 'actual_consumed_tokens',
        label: 'Actual Consumed Tokens',
        sortable: true,
        align: 'right',
    },
    {
        key: 'cache_read_tokens',
        label: 'Cache Read Tokens',
        sortable: true,
        align: 'right',
    },
    {
        key: 'last_activity_at',
        label: 'Last activity',
        sortable: true,
        class: 'whitespace-nowrap',
    },
];

const tokenFields = [
    'total_token_activity',
    'actual_consumed_tokens',
    'cache_read_tokens',
] as const;

const countFields = [
    'developers_count',
    'devices_count',
    'sessions_count',
] as const;

const search = ref(props.filters.search);
let searchTimer: ReturnType<typeof setTimeout> | undefined;

watch(
    () => props.filters.search,
    (value) => {
        if (searchTimer === undefined && value !== search.value) {
            search.value = value;
        }
    },
);

function applySearch(value: string): void {
    const origin =
        typeof window !== 'undefined'
            ? window.location.origin
            : 'http://localhost';
    const url = new URL(page.url, origin);
    const query: Record<string, string> = Object.fromEntries(
        url.searchParams.entries(),
    );
    delete query.page;

    const term = value.trim();

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

    searchTimer = setTimeout(() => {
        searchTimer = undefined;
        applySearch(search.value);
    }, 300);
}

onBeforeUnmount(() => {
    if (searchTimer !== undefined) {
        clearTimeout(searchTimer);
    }
});
</script>

<template>
    <Head title="Projects" />

    <div class="flex flex-1 flex-col gap-6 p-4">
        <div class="flex flex-col gap-1">
            <h1 class="text-xl font-semibold tracking-tight">Projects</h1>
            <p class="text-sm text-muted-foreground">
                Claude Code activity grouped by project. Sessions and token
                columns cover the selected period; Developers, Devices and Last
                activity are all-time.
            </p>
        </div>

        <DateRangeFilter :range="range" />

        <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div class="grid w-full gap-1.5 sm:w-80">
                <Label :for="searchId">Search by project name or path</Label>
                <div class="relative">
                    <Search
                        class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <Input
                        :id="searchId"
                        type="search"
                        name="search"
                        autocomplete="off"
                        class="pl-8"
                        :model-value="search"
                        @update:model-value="onSearchInput"
                    />
                </div>
            </div>
            <EntityFilters
                :options="filterOptions"
                :values="{ developer: filters.developer }"
            />
        </div>

        <DataTable
            :paginator="projects"
            :columns="columns"
            :sort="sort"
            :direction="direction"
        >
            <template #cell-name="{ row }">
                <div class="flex min-w-0 flex-col">
                    <Link
                        :href="projectShow(row.id).url"
                        class="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                        {{ row.name }}
                    </Link>
                    <span
                        v-if="row.git_remote"
                        class="text-xs break-all text-muted-foreground"
                    >
                        {{ row.git_remote }}
                    </span>
                </div>
            </template>
            <template
                v-for="field in countFields"
                :key="field"
                #[`cell-${field}`]="{ row }"
            >
                <span class="tabular-nums">
                    {{ formatTokensFull(row[field]) }}
                </span>
            </template>
            <template
                v-for="field in tokenFields"
                :key="field"
                #[`cell-${field}`]="{ row }"
            >
                <span
                    class="tabular-nums"
                    :title="formatTokensFull(row[field])"
                >
                    {{ formatTokens(row[field]) }}
                </span>
            </template>
            <template #cell-last_activity_at="{ row }">
                <RelativeTime :value="row.last_activity_at" />
            </template>
            <template #empty>
                <EmptyState
                    :icon="FolderGit2"
                    title="No projects found"
                    description="No projects match the current search and filters."
                />
            </template>
        </DataTable>
    </div>
</template>
