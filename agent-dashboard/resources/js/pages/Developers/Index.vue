<script setup lang="ts">
import { Form, Head, Link, router, usePage } from '@inertiajs/vue3';
import { ChevronDown, Plus, Search, Users } from '@lucide/vue';
import { useDebounceFn } from '@vueuse/core';
import { computed, ref, useId, watch } from 'vue';
import InputError from '@/components/InputError.vue';
import DataTable from '@/components/monitor/DataTable.vue';
import DateRangeFilter from '@/components/monitor/DateRangeFilter.vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatTokens, formatTokensFull } from '@/lib/format';
import { cn } from '@/lib/utils';
import { index, show, store } from '@/routes/developers';
import type {
    DataTableColumn,
    DateRangeProps,
    MonitorSharedProps,
    Paginated,
} from '@/types/monitor';
import type {
    DeveloperIndexFilters,
    DeveloperRow,
    DeveloperStatus,
} from './types';

defineOptions({
    layout: {
        breadcrumbs: [{ title: 'Developers', href: index() }],
    },
});

const props = defineProps<{
    developers: Paginated<DeveloperRow>;
    filters: DeveloperIndexFilters;
    range: DateRangeProps;
}>();

const page = usePage<MonitorSharedProps>();
const id = useId();

const canManage = computed(() => page.props.can?.manageAgents === true);
const flashSuccess = computed(() => page.props.flash?.success ?? null);
const flashError = computed(() => page.props.flash?.error ?? null);

/** Open the developer page on the same period as the list. */
const rangeQuery = computed(() => {
    const { preset, from, to } = props.range;
    const query: Record<string, string> = { range: preset };

    if (preset === 'custom') {
        query.from = from;
        query.to = to;
    }

    return query;
});

const columns: DataTableColumn[] = [
    { key: 'name', label: 'Name', class: 'whitespace-nowrap' },
    { key: 'email', label: 'Email' },
    { key: 'team', label: 'Team' },
    { key: 'status', label: 'Status' },
    { key: 'devices_count', label: 'Devices', align: 'right' },
    { key: 'claude_accounts_count', label: 'Claude accounts', align: 'right' },
    { key: 'sessions_count', label: 'Sessions', align: 'right' },
    {
        key: 'actual_consumed_tokens',
        label: 'Actual Consumed Tokens',
        align: 'right',
    },
    {
        key: 'total_token_activity',
        label: 'Total Token Activity',
        align: 'right',
    },
    {
        key: 'last_activity_at',
        label: 'Last activity',
        class: 'whitespace-nowrap',
    },
    { key: 'last_sync_at', label: 'Last sync', class: 'whitespace-nowrap' },
];

const statusBadgeClasses: Record<DeveloperStatus, string> = {
    active: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300',
    inactive: 'border-border bg-muted text-muted-foreground',
};

const hasFilters = computed(
    () =>
        (props.filters.search !== null && props.filters.search !== '') ||
        props.filters.status !== null,
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

const search = ref(props.filters.search ?? '');

watch(
    () => props.filters.search,
    (value) => {
        if ((value ?? '') !== search.value.trim()) {
            search.value = value ?? '';
        }
    },
);

const submitSearch = useDebounceFn((value: string) => {
    const trimmed = value.trim();

    if (trimmed === (props.filters.search ?? '')) {
        return;
    }

    visit({ search: trimmed === '' ? null : trimmed });
}, 300);

watch(search, (value) => {
    void submitSearch(value);
});

function onStatusChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    visit({ status: target.value === '' ? null : target.value });
}

function clearFilters(): void {
    search.value = '';
    visit({ search: null, status: null });
}

const addOpen = ref(false);
</script>

<template>
    <Head title="Developers" />

    <div class="flex flex-1 flex-col gap-6 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <h1 class="text-xl font-semibold tracking-tight">Developers</h1>
            <Dialog v-if="canManage" v-model:open="addOpen">
                <DialogTrigger as-child>
                    <Button type="button">
                        <Plus class="size-4" aria-hidden="true" />
                        Add developer
                    </Button>
                </DialogTrigger>
                <DialogContent>
                    <Form
                        v-bind="store.form()"
                        reset-on-success
                        :options="{ preserveScroll: true }"
                        class="space-y-6"
                        v-slot="{ errors, processing, reset, clearErrors }"
                        @success="addOpen = false"
                    >
                        <DialogHeader>
                            <DialogTitle>Add developer</DialogTitle>
                            <DialogDescription>
                                Create a developer, then generate a pairing code
                                from their page to connect a device.
                            </DialogDescription>
                        </DialogHeader>

                        <div class="grid gap-2">
                            <Label :for="`${id}-name`">Name</Label>
                            <Input
                                :id="`${id}-name`"
                                name="name"
                                required
                                autocomplete="off"
                                :aria-invalid="errors.name ? true : undefined"
                            />
                            <InputError :message="errors.name" />
                        </div>

                        <div class="grid gap-2">
                            <Label :for="`${id}-email`">Email</Label>
                            <Input
                                :id="`${id}-email`"
                                name="email"
                                type="email"
                                required
                                autocomplete="off"
                                :aria-invalid="errors.email ? true : undefined"
                            />
                            <InputError :message="errors.email" />
                        </div>

                        <div class="grid gap-2">
                            <Label :for="`${id}-team`">
                                Team
                                <span class="font-normal text-muted-foreground"
                                    >(optional)</span
                                >
                            </Label>
                            <Input
                                :id="`${id}-team`"
                                name="team"
                                autocomplete="off"
                                :aria-invalid="errors.team ? true : undefined"
                            />
                            <InputError :message="errors.team" />
                        </div>

                        <DialogFooter class="gap-2">
                            <DialogClose as-child>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    @click="
                                        () => {
                                            clearErrors();
                                            reset();
                                        }
                                    "
                                >
                                    Cancel
                                </Button>
                            </DialogClose>
                            <Button type="submit" :disabled="processing">
                                Add developer
                            </Button>
                        </DialogFooter>
                    </Form>
                </DialogContent>
            </Dialog>
        </div>

        <div
            v-if="flashSuccess"
            role="status"
            class="rounded-lg border border-emerald-600/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-400/30 dark:text-emerald-200"
        >
            {{ flashSuccess }}
        </div>
        <div
            v-if="flashError"
            role="alert"
            class="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
            {{ flashError }}
        </div>

        <DateRangeFilter :range="range" />

        <div
            role="search"
            aria-label="Filter developers"
            class="flex flex-wrap items-end gap-3"
        >
            <div class="grid w-full gap-1.5 sm:w-72">
                <Label :for="`${id}-search`">Search</Label>
                <div class="relative">
                    <Search
                        class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <Input
                        :id="`${id}-search`"
                        v-model="search"
                        type="search"
                        class="pl-8"
                        placeholder="Name, email or team"
                        autocomplete="off"
                    />
                </div>
            </div>
            <div class="grid w-full gap-1.5 sm:w-48">
                <Label :for="`${id}-status`">Status</Label>
                <div class="relative">
                    <select
                        :id="`${id}-status`"
                        :value="filters.status ?? ''"
                        class="h-9 w-full appearance-none truncate rounded-md border border-input bg-transparent py-1 pr-8 pl-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                        @change="onStatusChange"
                    >
                        <option
                            value=""
                            class="bg-popover text-popover-foreground"
                        >
                            All
                        </option>
                        <option
                            value="active"
                            class="bg-popover text-popover-foreground"
                        >
                            Active
                        </option>
                        <option
                            value="inactive"
                            class="bg-popover text-popover-foreground"
                        >
                            Inactive
                        </option>
                    </select>
                    <ChevronDown
                        class="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                </div>
            </div>
            <Button
                v-if="hasFilters"
                type="button"
                variant="ghost"
                size="sm"
                class="h-9"
                @click="clearFilters"
            >
                Clear filters
            </Button>
        </div>

        <DataTable :paginator="developers" :columns="columns">
            <template #empty>
                <EmptyState
                    :icon="Users"
                    :title="
                        hasFilters
                            ? 'No developers match these filters'
                            : 'No developers yet'
                    "
                    :description="
                        hasFilters
                            ? 'Try a different search or status.'
                            : canManage
                              ? 'Add a developer to start pairing devices.'
                              : undefined
                    "
                />
            </template>

            <template #cell-name="{ row }">
                <Link
                    :href="show(row.id, { query: rangeQuery })"
                    class="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    {{ row.name }}
                </Link>
            </template>

            <template #cell-email="{ row }">
                <span class="break-all">{{ row.email }}</span>
            </template>

            <template #cell-team="{ row }">
                <span v-if="row.team">{{ row.team }}</span>
                <span v-else class="text-muted-foreground">—</span>
            </template>

            <template #cell-status="{ row }">
                <Badge
                    variant="outline"
                    :class="cn(statusBadgeClasses[row.status])"
                >
                    {{ row.status === 'active' ? 'Active' : 'Inactive' }}
                </Badge>
            </template>

            <template #cell-devices_count="{ row }">
                <span class="tabular-nums">{{
                    formatTokensFull(row.devices_count)
                }}</span>
            </template>

            <template #cell-claude_accounts_count="{ row }">
                <span class="tabular-nums">{{
                    formatTokensFull(row.claude_accounts_count)
                }}</span>
            </template>

            <template #cell-sessions_count="{ row }">
                <span class="tabular-nums">{{
                    formatTokensFull(row.sessions_count)
                }}</span>
            </template>

            <template #cell-actual_consumed_tokens="{ row }">
                <span
                    class="tabular-nums"
                    :title="formatTokensFull(row.actual_consumed_tokens)"
                    >{{ formatTokens(row.actual_consumed_tokens) }}</span
                >
            </template>

            <template #cell-total_token_activity="{ row }">
                <span
                    class="tabular-nums"
                    :title="formatTokensFull(row.total_token_activity)"
                    >{{ formatTokens(row.total_token_activity) }}</span
                >
            </template>

            <template #cell-last_activity_at="{ row }">
                <RelativeTime :value="row.last_activity_at" />
            </template>

            <template #cell-last_sync_at="{ row }">
                <RelativeTime :value="row.last_sync_at" />
            </template>
        </DataTable>
    </div>
</template>
