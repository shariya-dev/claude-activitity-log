<script setup lang="ts">
import { Head, Link, router, setLayoutProps } from '@inertiajs/vue3';
import { ChevronDown, Monitor } from '@lucide/vue';
import { computed, useId, watchEffect } from 'vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import StatusBadge from '@/components/monitor/StatusBadge.vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import OutdatedBadge from '@/pages/Devices/components/OutdatedBadge.vue';
import type {
    DeviceIndexFilters,
    DeviceIndexOptions,
    DeviceRow,
} from '@/pages/Devices/types';
import { show as showDeveloper } from '@/routes/developers';
import { index, show } from '@/routes/devices';
import type { BreadcrumbItem } from '@/types';

type FilterKey =
    | 'platform'
    | 'status'
    | 'connection'
    | 'outdated'
    | 'developer';

type FilterField = {
    key: FilterKey;
    label: string;
    options: { value: string; label: string }[];
};

const props = defineProps<{
    devices: DeviceRow[];
    filters: DeviceIndexFilters;
    options: DeviceIndexOptions;
    min_agent_version: string;
}>();

watchEffect(() => {
    setLayoutProps<{ breadcrumbs: BreadcrumbItem[] }>({
        breadcrumbs: [{ title: 'Devices', href: index() }],
    });
});

const id = useId();

const fields = computed<FilterField[]>(() => [
    {
        key: 'developer',
        label: 'Developer',
        options: props.options.developers.map((option) => ({
            value: String(option.id),
            label: option.label,
        })),
    },
    {
        key: 'platform',
        label: 'OS',
        options: props.options.platforms.map((platform) => ({
            value: platform,
            label: platform,
        })),
    },
    {
        key: 'status',
        label: 'Status',
        options: [
            { value: 'active', label: 'Active' },
            { value: 'disabled', label: 'Disabled' },
            { value: 'uninstalled', label: 'Uninstalled' },
        ],
    },
    {
        key: 'connection',
        label: 'Connection',
        options: [
            { value: 'online', label: 'Online' },
            { value: 'stale', label: 'Stale' },
            { value: 'offline', label: 'Offline' },
        ],
    },
    {
        key: 'outdated',
        label: 'Agent version',
        options: [
            { value: '1', label: 'Outdated' },
            { value: '0', label: 'Up to date' },
        ],
    },
]);

const currentQuery = computed<Record<FilterKey, string>>(() => ({
    platform: props.filters.platform ?? '',
    status: props.filters.status ?? '',
    connection: props.filters.connection ?? '',
    outdated:
        props.filters.outdated === null
            ? ''
            : props.filters.outdated
              ? '1'
              : '0',
    developer:
        props.filters.developer === null ? '' : String(props.filters.developer),
}));

const hasActiveFilters = computed(() =>
    Object.values(currentQuery.value).some((value) => value !== ''),
);

function visit(query: Partial<Record<FilterKey, string>>): void {
    const cleaned = Object.fromEntries(
        Object.entries(query).filter(([, value]) => value !== ''),
    );

    router.get(index().url, cleaned, {
        preserveState: true,
        preserveScroll: true,
        replace: true,
    });
}

function onChange(key: FilterKey, event: Event): void {
    const target = event.target as HTMLSelectElement;
    visit({ ...currentQuery.value, [key]: target.value });
}

function clearFilters(): void {
    visit({});
}

function osLabel(device: DeviceRow): string {
    return device.platform_version
        ? `${device.platform} ${device.platform_version}`
        : device.platform;
}
</script>

<template>
    <Head title="Devices" />

    <div class="flex flex-1 flex-col gap-6 p-4">
        <div class="flex flex-col gap-1">
            <h1 class="text-xl font-semibold tracking-tight">Devices</h1>
            <p class="text-sm text-muted-foreground">
                Every machine running the agent. Devices with problems are
                listed first.
            </p>
        </div>

        <div
            role="group"
            aria-label="Filters"
            class="flex flex-wrap items-end gap-3"
        >
            <div
                v-for="field in fields"
                :key="field.key"
                class="grid w-full gap-1.5 sm:w-44"
            >
                <Label :for="`${id}-${field.key}`">{{ field.label }}</Label>
                <div class="relative">
                    <select
                        :id="`${id}-${field.key}`"
                        :name="field.key"
                        :value="currentQuery[field.key]"
                        class="h-9 w-full appearance-none truncate rounded-md border border-input bg-transparent py-1 pr-8 pl-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                        @change="onChange(field.key, $event)"
                    >
                        <option
                            value=""
                            class="bg-popover text-popover-foreground"
                        >
                            All
                        </option>
                        <option
                            v-for="option in field.options"
                            :key="option.value"
                            :value="option.value"
                            class="bg-popover text-popover-foreground"
                        >
                            {{ option.label }}
                        </option>
                    </select>
                    <ChevronDown
                        class="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                </div>
            </div>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-9"
                :disabled="!hasActiveFilters"
                @click="clearFilters"
            >
                Clear
            </Button>
        </div>

        <EmptyState
            v-if="devices.length === 0"
            :icon="Monitor"
            :title="
                hasActiveFilters
                    ? 'No devices match these filters'
                    : 'No devices yet'
            "
            :description="
                hasActiveFilters
                    ? 'Try clearing a filter to see more devices.'
                    : 'Devices appear here after a developer pairs the agent.'
            "
        />
        <div v-else class="overflow-x-auto rounded-lg border">
            <table class="w-full min-w-[72rem] text-sm">
                <caption class="sr-only">
                    Devices
                </caption>
                <thead class="bg-muted/50 text-muted-foreground">
                    <tr class="border-b">
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
                            Device
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium"
                        >
                            OS
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium"
                        >
                            Architecture
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                        >
                            Agent version
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                        >
                            Claude Code
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                        >
                            Last seen
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                        >
                            Last sync
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium"
                        >
                            Connection
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                        >
                            Sync status
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="device in devices"
                        :key="device.device_uid"
                        class="border-b last:border-b-0 hover:bg-muted/30"
                    >
                        <td class="px-4 py-2.5 whitespace-nowrap">
                            <Link
                                :href="showDeveloper(device.developer.id)"
                                class="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                            >
                                {{ device.developer.name }}
                            </Link>
                        </td>
                        <th scope="row" class="px-4 py-2.5 text-left">
                            <div class="flex flex-wrap items-center gap-2">
                                <Link
                                    :href="show(device.device_uid)"
                                    class="rounded-sm font-medium break-all underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                >
                                    {{ device.hostname ?? device.device_uid }}
                                </Link>
                                <StatusBadge
                                    v-if="device.status !== 'active'"
                                    kind="device"
                                    :status="device.status"
                                />
                            </div>
                        </th>
                        <td class="px-4 py-2.5 whitespace-nowrap">
                            {{ osLabel(device) }}
                        </td>
                        <td class="px-4 py-2.5">
                            {{ device.architecture ?? '—' }}
                        </td>
                        <td class="px-4 py-2.5">
                            <div
                                class="flex flex-wrap items-center gap-2 whitespace-nowrap"
                            >
                                <span class="font-mono text-xs">{{
                                    device.agent_version ?? '—'
                                }}</span>
                                <OutdatedBadge
                                    v-if="device.outdated"
                                    :min-version="min_agent_version"
                                />
                            </div>
                        </td>
                        <td class="px-4 py-2.5 font-mono text-xs">
                            {{ device.claude_code_version ?? '—' }}
                        </td>
                        <td class="px-4 py-2.5 whitespace-nowrap">
                            <RelativeTime :value="device.last_seen_at" />
                        </td>
                        <td class="px-4 py-2.5 whitespace-nowrap">
                            <RelativeTime :value="device.last_sync_at" />
                        </td>
                        <td class="px-4 py-2.5">
                            <StatusBadge
                                kind="connection"
                                :status="device.connection"
                            />
                        </td>
                        <td class="px-4 py-2.5">
                            <StatusBadge kind="sync" :status="device.health" />
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
