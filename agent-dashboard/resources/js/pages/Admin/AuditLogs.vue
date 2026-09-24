<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { ScrollText } from '@lucide/vue';
import { computed, ref, useId, watch } from 'vue';
import DataTable from '@/components/monitor/DataTable.vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import NativeSelect from '@/pages/Admin/partials/NativeSelect.vue';
import type {
    AuditLogFilters,
    AuditLogOptions,
    AuditLogPaginator,
    AuditLogRow,
} from '@/pages/Admin/types';
import { index } from '@/routes/audit-logs';
import type { DataTableColumn } from '@/types/monitor';

defineOptions({
    layout: {
        breadcrumbs: [{ title: 'Audit log', href: index() }],
    },
});

const props = defineProps<{
    logs: AuditLogPaginator;
    filters: AuditLogFilters;
    options: AuditLogOptions;
}>();

const id = useId();

const columns: DataTableColumn[] = [
    { key: 'created_at', label: 'Time', class: 'whitespace-nowrap' },
    { key: 'actor', label: 'Actor', class: 'whitespace-nowrap' },
    { key: 'action', label: 'Action', class: 'whitespace-nowrap' },
    { key: 'subject', label: 'Subject' },
    { key: 'ip_address', label: 'IP', class: 'whitespace-nowrap' },
    { key: 'metadata', label: 'Metadata', class: 'min-w-48' },
];

const actionOptions = computed(() =>
    props.options.actions.map((action) => ({ value: action, label: action })),
);

const actorOptions = computed(() =>
    props.options.actors.map((actor) => ({
        value: String(actor.id),
        label: actor.name,
    })),
);

const subjectTypeOptions = computed(() =>
    props.options.subjectTypes.map((type) => ({
        value: type.value,
        label: type.label,
    })),
);

const from = ref(props.filters.from ?? '');
const to = ref(props.filters.to ?? '');
const dateError = ref<string | null>(null);

watch(
    () => [props.filters.from, props.filters.to],
    () => {
        from.value = props.filters.from ?? '';
        to.value = props.filters.to ?? '';
        dateError.value = null;
    },
);

const hasActiveFilters = computed(() =>
    Object.values(props.filters).some(
        (value) => value !== null && value !== '',
    ),
);

type FilterQuery = {
    action: string;
    actor: string;
    subject_type: string;
    from: string;
    to: string;
};

function currentQuery(): FilterQuery {
    return {
        action: props.filters.action ?? '',
        actor: props.filters.actor === null ? '' : String(props.filters.actor),
        subject_type: props.filters.subject_type ?? '',
        from: props.filters.from ?? '',
        to: props.filters.to ?? '',
    };
}

function visit(changes: Partial<FilterQuery>): void {
    const merged = { ...currentQuery(), ...changes };
    const query = Object.fromEntries(
        Object.entries(merged).filter(([, value]) => value !== ''),
    );

    router.get(index.url(), query, {
        preserveState: true,
        preserveScroll: true,
        replace: true,
    });
}

function applyDates(): void {
    if (from.value && to.value && from.value > to.value) {
        dateError.value = 'The start date must be on or before the end date.';

        return;
    }

    dateError.value = null;
    visit({ from: from.value, to: to.value });
}

function clearFilters(): void {
    dateError.value = null;
    router.get(
        index.url(),
        {},
        { preserveState: true, preserveScroll: true, replace: true },
    );
}

function prettyJson(value: Record<string, unknown>): string {
    return JSON.stringify(value, null, 2);
}

function metadataSummary(value: Record<string, unknown>): string {
    const keys = Object.keys(value);

    if (keys.length === 0) {
        return 'Empty';
    }

    return keys.length === 1 ? '1 field' : `${keys.length} fields`;
}

function hasMetadata(row: AuditLogRow): row is AuditLogRow & {
    metadata: Record<string, unknown>;
} {
    return row.metadata !== null && Object.keys(row.metadata).length > 0;
}
</script>

<template>
    <Head title="Audit log" />

    <div class="flex flex-1 flex-col gap-6 p-4">
        <div class="flex flex-col gap-1">
            <h1 class="text-xl font-semibold tracking-tight">Audit log</h1>
            <p class="text-sm text-muted-foreground">
                A read-only record of administrative actions and sensitive
                access on this server.
            </p>
        </div>

        <div
            role="group"
            aria-label="Filters"
            class="flex flex-col gap-3 rounded-lg border p-4"
        >
            <div class="grid gap-3 sm:grid-cols-3">
                <div class="grid gap-1.5">
                    <Label :for="`${id}-action`">Action</Label>
                    <NativeSelect
                        :id="`${id}-action`"
                        name="action"
                        placeholder="All actions"
                        :model-value="filters.action ?? ''"
                        :options="actionOptions"
                        @update:model-value="visit({ action: $event })"
                    />
                </div>
                <div class="grid gap-1.5">
                    <Label :for="`${id}-actor`">Actor</Label>
                    <NativeSelect
                        :id="`${id}-actor`"
                        name="actor"
                        placeholder="All actors"
                        :model-value="
                            filters.actor === null ? '' : String(filters.actor)
                        "
                        :options="actorOptions"
                        @update:model-value="visit({ actor: $event })"
                    />
                </div>
                <div class="grid gap-1.5">
                    <Label :for="`${id}-subject-type`">Subject type</Label>
                    <NativeSelect
                        :id="`${id}-subject-type`"
                        name="subject_type"
                        placeholder="All subjects"
                        :model-value="filters.subject_type ?? ''"
                        :options="subjectTypeOptions"
                        @update:model-value="visit({ subject_type: $event })"
                    />
                </div>
            </div>

            <form
                class="flex flex-wrap items-end gap-3"
                aria-label="Date range"
                novalidate
                @submit.prevent="applyDates"
            >
                <div class="grid gap-1.5">
                    <Label :for="`${id}-from`">From</Label>
                    <Input
                        :id="`${id}-from`"
                        v-model="from"
                        name="from"
                        type="date"
                        class="w-auto"
                        :max="to || undefined"
                        :aria-invalid="dateError !== null"
                        :aria-describedby="
                            dateError ? `${id}-date-error` : undefined
                        "
                    />
                </div>
                <div class="grid gap-1.5">
                    <Label :for="`${id}-to`">To</Label>
                    <Input
                        :id="`${id}-to`"
                        v-model="to"
                        name="to"
                        type="date"
                        class="w-auto"
                        :min="from || undefined"
                        :aria-invalid="dateError !== null"
                        :aria-describedby="
                            dateError ? `${id}-date-error` : undefined
                        "
                    />
                </div>
                <Button type="submit" size="sm" class="h-9">
                    Apply dates
                </Button>
                <Button
                    v-if="hasActiveFilters"
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="h-9"
                    @click="clearFilters"
                >
                    Clear filters
                </Button>
                <p
                    v-if="dateError"
                    :id="`${id}-date-error`"
                    role="alert"
                    class="w-full text-sm text-destructive"
                >
                    {{ dateError }}
                </p>
            </form>
        </div>

        <DataTable :paginator="logs" :columns="columns">
            <template #empty>
                <EmptyState
                    :icon="ScrollText"
                    title="No audit entries"
                    :description="
                        hasActiveFilters
                            ? 'No entries match these filters.'
                            : 'Administrative actions will appear here.'
                    "
                />
            </template>

            <template #cell-created_at="{ row }">
                <RelativeTime :value="row.created_at" />
            </template>

            <template #cell-actor="{ row }">
                <span v-if="row.actor">{{ row.actor.name }}</span>
                <span v-else class="text-muted-foreground">System</span>
            </template>

            <template #cell-action="{ row }">
                <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {{ row.action }}
                </code>
            </template>

            <template #cell-subject="{ row }">
                <template v-if="row.subject">
                    <span class="block text-xs text-muted-foreground">
                        {{ row.subject.type }}
                    </span>
                    <Link
                        v-if="row.subject.url"
                        :href="row.subject.url"
                        class="font-medium underline-offset-4 hover:underline"
                    >
                        {{ row.subject.label }}
                    </Link>
                    <span v-else>{{ row.subject.label }}</span>
                </template>
                <span v-else class="text-muted-foreground">—</span>
            </template>

            <template #cell-ip_address="{ row }">
                <span v-if="row.ip_address" class="font-mono text-xs">
                    {{ row.ip_address }}
                </span>
                <span v-else class="text-muted-foreground">—</span>
            </template>

            <template #cell-metadata="{ row }">
                <details v-if="hasMetadata(row)" class="group">
                    <summary
                        class="cursor-pointer rounded-sm text-sm text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                        {{ metadataSummary(row.metadata) }}
                    </summary>
                    <pre
                        class="mt-2 max-h-80 max-w-md overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre text-foreground"
                    ><code>{{ prettyJson(row.metadata) }}</code></pre>
                </details>
                <span v-else class="text-muted-foreground">—</span>
            </template>
        </DataTable>
    </div>
</template>
