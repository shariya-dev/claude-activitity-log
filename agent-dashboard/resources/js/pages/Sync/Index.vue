<script setup lang="ts">
import { Head, Link, setLayoutProps } from '@inertiajs/vue3';
import type { LucideIcon } from '@lucide/vue';
import {
    Ban,
    ChevronDown,
    ChevronRight,
    CircleCheck,
    CircleX,
    Monitor,
    TriangleAlert,
    WifiOff,
} from '@lucide/vue';
import { computed, ref, useId, watchEffect } from 'vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import MetricCard from '@/components/monitor/MetricCard.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import StatusBadge from '@/components/monitor/StatusBadge.vue';
import { Button } from '@/components/ui/button';
import { formatTokensFull } from '@/lib/format';
import { cn } from '@/lib/utils';
import OutdatedBadge from '@/pages/Devices/components/OutdatedBadge.vue';
import SyncBatchRejections from '@/pages/Devices/components/SyncBatchRejections.vue';
import SyncBatchStatusBadge from '@/pages/Devices/components/SyncBatchStatusBadge.vue';
import type {
    SyncDeviceRow,
    SyncFailureRow,
    SyncHealthCounts,
} from '@/pages/Sync/types';
import { show as showDevice } from '@/routes/devices';
import { index } from '@/routes/sync';
import type { BreadcrumbItem } from '@/types';
import type { SyncHealth } from '@/types/monitor';

const props = defineProps<{
    counts: SyncHealthCounts;
    devices: SyncDeviceRow[];
    filters: { health: SyncHealth | null };
    recent_failures: SyncFailureRow[];
}>();

watchEffect(() => {
    setLayoutProps<{ breadcrumbs: BreadcrumbItem[] }>({
        breadcrumbs: [{ title: 'Sync Monitor', href: index() }],
    });
});

const id = useId();

const healthCards: {
    health: SyncHealth;
    label: string;
    icon: LucideIcon;
    count: keyof SyncHealthCounts;
}[] = [
    {
        health: 'healthy',
        label: 'Healthy',
        icon: CircleCheck,
        count: 'healthy',
    },
    { health: 'offline', label: 'Offline', icon: WifiOff, count: 'offline' },
    {
        health: 'sync_failed',
        label: 'Sync Failed',
        icon: CircleX,
        count: 'sync_failed',
    },
    { health: 'disabled', label: 'Disabled', icon: Ban, count: 'disabled' },
];

const healthOptions = computed<{ value: SyncHealth | null; label: string }[]>(
    () => [
        { value: null, label: `All (${formatTokensFull(props.counts.total)})` },
        ...healthCards.map((card) => ({
            value: card.health,
            label: card.label,
        })),
    ],
);

function healthHref(health: SyncHealth | null) {
    return health === null ? index() : index({ query: { health } });
}

function isActive(health: SyncHealth | null): boolean {
    return props.filters.health === health;
}

const activeLabel = computed<string | null>(
    () =>
        healthCards.find((card) => card.health === props.filters.health)
            ?.label ?? null,
);

const expanded = ref<number[]>([]);

function isExpanded(batchId: number): boolean {
    return expanded.value.includes(batchId);
}

function toggle(batchId: number): void {
    expanded.value = isExpanded(batchId)
        ? expanded.value.filter((item) => item !== batchId)
        : [...expanded.value, batchId];
}

function lastError(row: SyncDeviceRow): string | null {
    const parts = [row.last_error_code, row.last_error_message].filter(
        (part): part is string => part !== null && part !== '',
    );

    return parts.length > 0 ? parts.join(': ') : null;
}

const linkClass =
    'rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50';
</script>

<template>
    <Head title="Sync Monitor" />

    <div class="flex flex-1 flex-col gap-6 p-4">
        <div class="flex flex-col gap-1">
            <h1 class="text-xl font-semibold tracking-tight">Sync Monitor</h1>
            <p class="text-sm text-muted-foreground">
                Sync health for every device. Select a card to filter the list.
            </p>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Link
                v-for="card in healthCards"
                :key="card.health"
                :href="healthHref(isActive(card.health) ? null : card.health)"
                preserve-scroll
                :aria-current="isActive(card.health) ? 'true' : undefined"
                :aria-label="`${card.label}: ${formatTokensFull(counts[card.count])} devices. ${isActive(card.health) ? 'Selected; select to show all devices.' : 'Filter by this status.'}`"
                :class="
                    cn(
                        'rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>*]:transition-colors [&>*]:hover:border-foreground/30',
                        isActive(card.health) &&
                            '[&>*]:border-primary [&>*]:ring-1 [&>*]:ring-primary',
                    )
                "
            >
                <MetricCard
                    :label="card.label"
                    :value="counts[card.count]"
                    :icon="card.icon"
                    :hint="
                        card.count === 'disabled' && counts.uninstalled > 0
                            ? `Includes ${counts.uninstalled} uninstalled`
                            : undefined
                    "
                />
            </Link>
            <MetricCard
                label="Outdated"
                :value="counts.outdated"
                :icon="TriangleAlert"
                hint="Active agents below the minimum version"
            />
        </div>

        <section aria-labelledby="devices-heading" class="flex flex-col gap-3">
            <div
                class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
                <h2 id="devices-heading" class="text-base font-semibold">
                    Devices
                    <span
                        v-if="activeLabel"
                        class="font-normal text-muted-foreground"
                        >· {{ activeLabel }}</span
                    >
                </h2>
                <nav
                    aria-label="Filter by sync health"
                    class="flex flex-wrap gap-1.5"
                >
                    <Button
                        v-for="option in healthOptions"
                        :key="option.value ?? 'all'"
                        as-child
                        size="sm"
                        :variant="
                            isActive(option.value) ? 'default' : 'outline'
                        "
                    >
                        <Link
                            :href="healthHref(option.value)"
                            preserve-scroll
                            :aria-current="
                                isActive(option.value) ? 'page' : undefined
                            "
                        >
                            {{ option.label }}
                        </Link>
                    </Button>
                </nav>
            </div>

            <EmptyState
                v-if="devices.length === 0"
                :icon="Monitor"
                :title="
                    activeLabel
                        ? `No devices with status ${activeLabel}`
                        : 'No devices yet'
                "
            />
            <div v-else class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[72rem] text-sm">
                    <thead class="bg-muted/50 text-muted-foreground">
                        <tr class="border-b">
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Device
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Developer
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                            >
                                Agent version
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Health
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                            >
                                Last successful sync
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                            >
                                Last failed sync
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium"
                            >
                                Created
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium"
                            >
                                Updated
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium"
                            >
                                Rejected
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                            >
                                Last error
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="row in devices"
                            :key="row.device_uid"
                            class="border-b last:border-b-0 hover:bg-muted/30"
                        >
                            <th
                                scope="row"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                <Link
                                    :href="showDevice(row.device_uid)"
                                    :class="cn(linkClass, 'break-all')"
                                >
                                    {{ row.hostname ?? row.device_uid }}
                                </Link>
                            </th>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                {{ row.developer }}
                            </td>
                            <td class="px-4 py-2.5">
                                <div
                                    class="flex flex-wrap items-center gap-2 whitespace-nowrap"
                                >
                                    <span class="font-mono text-xs">{{
                                        row.agent_version ?? '—'
                                    }}</span>
                                    <OutdatedBadge v-if="row.outdated" />
                                </div>
                            </td>
                            <td class="px-4 py-2.5">
                                <div
                                    class="flex flex-wrap items-center gap-2 whitespace-nowrap"
                                >
                                    <StatusBadge
                                        kind="sync"
                                        :status="row.health"
                                    />
                                    <StatusBadge
                                        v-if="row.status !== 'active'"
                                        kind="device"
                                        :status="row.status"
                                    />
                                </div>
                            </td>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                <RelativeTime :value="row.last_success_at" />
                            </td>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                <RelativeTime :value="row.last_failure_at" />
                            </td>
                            <td class="px-4 py-2.5 text-right tabular-nums">
                                {{
                                    formatTokensFull(row.records_created_total)
                                }}
                            </td>
                            <td class="px-4 py-2.5 text-right tabular-nums">
                                {{
                                    formatTokensFull(row.records_updated_total)
                                }}
                            </td>
                            <td class="px-4 py-2.5 text-right tabular-nums">
                                {{
                                    formatTokensFull(row.records_rejected_total)
                                }}
                            </td>
                            <td class="px-4 py-2.5">
                                <p
                                    v-if="lastError(row)"
                                    class="max-w-xs truncate text-xs"
                                    :title="lastError(row) ?? undefined"
                                >
                                    <span
                                        v-if="row.last_error_code"
                                        class="font-mono"
                                        >{{ row.last_error_code }}</span
                                    >
                                    <template
                                        v-if="
                                            row.last_error_code &&
                                            row.last_error_message
                                        "
                                        >:
                                    </template>
                                    <span
                                        v-if="row.last_error_message"
                                        class="text-muted-foreground"
                                        >{{ row.last_error_message }}</span
                                    >
                                </p>
                                <span v-else class="text-muted-foreground"
                                    >—</span
                                >
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <section aria-labelledby="failures-heading" class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
                <h2 id="failures-heading" class="text-base font-semibold">
                    Recent failures (last 7 days)
                </h2>
                <p class="text-sm text-muted-foreground">
                    Failed batches and batches with rejected records.
                </p>
            </div>

            <EmptyState
                v-if="recent_failures.length === 0"
                :icon="CircleCheck"
                title="No failures in the last 7 days"
            />
            <div v-else class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[48rem] text-sm">
                    <thead class="bg-muted/50 text-muted-foreground">
                        <tr class="border-b">
                            <th scope="col" class="w-10 px-2 py-2.5">
                                <span class="sr-only">Rejections</span>
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Received
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Device
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Developer
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Status
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium"
                            >
                                Rejected
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Error
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <template
                            v-for="batch in recent_failures"
                            :key="batch.id"
                        >
                            <tr
                                class="border-b last:border-b-0 hover:bg-muted/30"
                            >
                                <td class="px-2 py-2">
                                    <Button
                                        v-if="batch.rejections.length > 0"
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        :aria-expanded="isExpanded(batch.id)"
                                        :aria-controls="`${id}-rejections-${batch.id}`"
                                        :aria-label="`${isExpanded(batch.id) ? 'Hide' : 'Show'} ${batch.rejections.length} rejections`"
                                        @click="toggle(batch.id)"
                                    >
                                        <ChevronDown
                                            v-if="isExpanded(batch.id)"
                                            aria-hidden="true"
                                        />
                                        <ChevronRight
                                            v-else
                                            aria-hidden="true"
                                        />
                                    </Button>
                                </td>
                                <td class="px-4 py-2.5 whitespace-nowrap">
                                    <RelativeTime :value="batch.received_at" />
                                </td>
                                <td class="px-4 py-2.5">
                                    <Link
                                        :href="showDevice(batch.device_uid)"
                                        :class="cn(linkClass, 'break-all')"
                                    >
                                        {{ batch.hostname ?? batch.device_uid }}
                                    </Link>
                                </td>
                                <td class="px-4 py-2.5 whitespace-nowrap">
                                    {{ batch.developer }}
                                </td>
                                <td class="px-4 py-2.5">
                                    <SyncBatchStatusBadge
                                        :status="batch.status"
                                    />
                                </td>
                                <td class="px-4 py-2.5 text-right tabular-nums">
                                    {{ formatTokensFull(batch.rejected) }}
                                </td>
                                <td class="px-4 py-2.5 font-mono text-xs">
                                    <span v-if="batch.error_code">{{
                                        batch.error_code
                                    }}</span>
                                    <span v-else class="text-muted-foreground"
                                        >—</span
                                    >
                                </td>
                            </tr>
                            <tr
                                v-if="batch.rejections.length > 0"
                                v-show="isExpanded(batch.id)"
                                :id="`${id}-rejections-${batch.id}`"
                                class="border-b bg-muted/20 last:border-b-0"
                            >
                                <td :colspan="7" class="px-4 py-3 pl-12">
                                    <p
                                        class="mb-2 text-xs font-medium text-muted-foreground"
                                    >
                                        Rejected records
                                    </p>
                                    <SyncBatchRejections
                                        :rejections="batch.rejections"
                                    />
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>
        </section>
    </div>
</template>
