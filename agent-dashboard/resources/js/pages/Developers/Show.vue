<script setup lang="ts">
import {
    Form,
    Head,
    Link,
    router,
    setLayoutProps,
    usePage,
} from '@inertiajs/vue3';
import {
    Check,
    ChevronDown,
    Copy,
    KeyRound,
    Laptop,
    Pencil,
    UserRound,
} from '@lucide/vue';
import {
    computed,
    nextTick,
    onBeforeUnmount,
    ref,
    useId,
    watch,
    watchEffect,
} from 'vue';
import InputError from '@/components/InputError.vue';
import BreakdownTable from '@/components/monitor/BreakdownTable.vue';
import DateRangeFilter from '@/components/monitor/DateRangeFilter.vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import EntityFilters from '@/components/monitor/EntityFilters.vue';
import MetricCard from '@/components/monitor/MetricCard.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import StatusBadge from '@/components/monitor/StatusBadge.vue';
import TokenMetricsGrid from '@/components/monitor/TokenMetricsGrid.vue';
import TrendChart from '@/components/monitor/TrendChart.vue';
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
import { formatDuration, formatTokens, formatTokensFull } from '@/lib/format';
import { cn } from '@/lib/utils';
import { index, show, update } from '@/routes/developers';
import { store as storePairingCode } from '@/routes/developers/pairing-codes';
import { show as deviceShow } from '@/routes/devices';
import { show as projectShow } from '@/routes/projects';
import { show as sessionShow } from '@/routes/sessions';
import type { BreadcrumbItem } from '@/types';
import type {
    BreakdownRow,
    DateRangeProps,
    FilterValues,
    MonitorSharedProps,
    SessionRow,
    TokenTotals,
    TrendPoint,
} from '@/types/monitor';
import type {
    DeveloperAccount,
    DeveloperBreakdowns,
    DeveloperDetail,
    DeveloperDevice,
    DeveloperFilterOptions,
    DeveloperStatus,
} from './types';

const props = defineProps<{
    developer: DeveloperDetail;
    range: DateRangeProps;
    filters: FilterValues;
    filterOptions: DeveloperFilterOptions;
    totals: TokenTotals;
    sessionsCount: number;
    trend: TrendPoint[];
    breakdowns: DeveloperBreakdowns;
    devices: DeveloperDevice[];
    accounts: DeveloperAccount[];
    recentSessions: SessionRow[];
    pairingCodeTtlMinutes: number;
}>();

const page = usePage<MonitorSharedProps>();
const id = useId();

watchEffect(() => {
    setLayoutProps<{ breadcrumbs: BreadcrumbItem[] }>({
        breadcrumbs: [
            { title: 'Developers', href: index() },
            { title: props.developer.name, href: show(props.developer.id) },
        ],
    });
});

const canManage = computed(() => page.props.can?.manageAgents === true);
const flashSuccess = computed(() => page.props.flash?.success ?? null);
const flashError = computed(() => page.props.flash?.error ?? null);
const isActive = computed(() => props.developer.status === 'active');

const statusBadgeClasses: Record<DeveloperStatus, string> = {
    active: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300',
    inactive: 'border-border bg-muted text-muted-foreground',
};

/* ---------------------------------------------------------------- links */

function currentUrlWith(
    changes: Record<string, string | number | null>,
): string {
    const origin =
        typeof window !== 'undefined'
            ? window.location.origin
            : 'http://localhost';
    const url = new URL(page.url, origin);
    url.searchParams.delete('page');

    for (const [key, value] of Object.entries(changes)) {
        if (value === null) {
            url.searchParams.delete(key);
        } else {
            url.searchParams.set(key, String(value));
        }
    }

    const query = url.searchParams.toString();

    return query === '' ? url.pathname : `${url.pathname}?${query}`;
}

/** The active date range (range/from/to) so drill-down pages open on the same period. */
function rangeQuery(): Record<string, string> {
    const origin =
        typeof window !== 'undefined'
            ? window.location.origin
            : 'http://localhost';
    const params = new URL(page.url, origin).searchParams;

    return Object.fromEntries(
        ['range', 'from', 'to'].flatMap((key) => {
            const value = params.get(key);

            return value === null ? [] : [[key, value]];
        }),
    );
}

function deviceHref(deviceUid: string): string {
    return deviceShow(deviceUid, { query: rangeQuery() }).url;
}

const deviceUidById = computed(
    () =>
        new Map(props.devices.map((device) => [device.id, device.device_uid])),
);

function deviceLink(row: BreakdownRow): string | null {
    if (row.id === null) {
        return null;
    }

    const uid = deviceUidById.value.get(row.id);

    return uid ? deviceHref(uid) : null;
}

function accountLink(row: BreakdownRow): string | null {
    return row.id === null ? null : currentUrlWith({ account: row.id });
}

function projectLink(row: BreakdownRow): string | null {
    return row.id === null
        ? null
        : projectShow(row.id, {
              query: { ...rangeQuery(), developer: props.developer.id },
          }).url;
}

function modelLink(row: BreakdownRow): string | null {
    return row.id === null ? null : currentUrlWith({ model: row.id });
}

function deviceLabel(device: DeveloperDevice): string {
    return device.hostname && device.hostname !== ''
        ? device.hostname
        : device.device_uid;
}

function accountStatusLabel(status: string): string {
    return status === ''
        ? '—'
        : status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

function accountLabel(account: DeveloperAccount): string {
    return account.email || account.display_name || `Account #${account.id}`;
}

/* ----------------------------------------------------------- edit dialog */

const editOpen = ref(false);

/* ------------------------------------------------------ pairing code flow */

const generating = ref(false);
const pairingCode = ref<string | null>(null);
const pairingExpiresAt = ref<Date | null>(null);
const copied = ref(false);
const copyError = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

function generatePairingCode(): void {
    if (!isActive.value || generating.value) {
        return;
    }

    router.post(
        storePairingCode(props.developer.id).url,
        {},
        {
            preserveState: false,
            preserveScroll: true,
            onStart: () => {
                generating.value = true;
            },
            onFinish: () => {
                generating.value = false;
            },
        },
    );
}

watch(
    () => page.props.flash?.pairing_code,
    (code) => {
        if (typeof code !== 'string' || code === '') {
            return;
        }

        pairingCode.value = code;
        pairingExpiresAt.value = new Date(
            Date.now() + props.pairingCodeTtlMinutes * 60_000,
        );
        copied.value = false;
        copyError.value = false;

        // Scrub the one-time code from Inertia page state and history so
        // navigating back or refreshing never shows it again.
        void nextTick(() => {
            router.replaceProp('flash.pairing_code', null);
        });
    },
    { immediate: true },
);

const pairingOpen = computed<boolean>({
    get: () => pairingCode.value !== null,
    set: (open) => {
        if (!open) {
            closePairingDialog();
        }
    },
});

function closePairingDialog(): void {
    pairingCode.value = null;
    pairingExpiresAt.value = null;
    copied.value = false;
    copyError.value = false;

    if (copiedTimer !== undefined) {
        clearTimeout(copiedTimer);
        copiedTimer = undefined;
    }
}

const expiresAtLabel = computed<string>(() => {
    const date = pairingExpiresAt.value;

    if (date === null) {
        return '';
    }

    const options: Intl.DateTimeFormatOptions = {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    };
    const timezone = page.props.monitor?.timezone;

    try {
        return new Intl.DateTimeFormat('en-GB', {
            ...options,
            ...(timezone ? { timeZone: timezone } : {}),
        }).format(date);
    } catch {
        return new Intl.DateTimeFormat('en-GB', options).format(date);
    }
});

async function copyPairingCode(): Promise<void> {
    const code = pairingCode.value;

    if (code === null) {
        return;
    }

    try {
        await navigator.clipboard.writeText(code);
        copied.value = true;
        copyError.value = false;
    } catch {
        copied.value = false;
        copyError.value = true;

        return;
    }

    if (copiedTimer !== undefined) {
        clearTimeout(copiedTimer);
    }

    copiedTimer = setTimeout(() => {
        copied.value = false;
        copiedTimer = undefined;
    }, 2000);
}

onBeforeUnmount(() => {
    if (copiedTimer !== undefined) {
        clearTimeout(copiedTimer);
    }

    pairingCode.value = null;
});
</script>

<template>
    <Head :title="developer.name" />

    <div class="flex flex-1 flex-col gap-8 p-4">
        <!-- Header -->
        <header
            class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
        >
            <div class="flex min-w-0 flex-col gap-2">
                <div class="flex flex-wrap items-center gap-2">
                    <h1
                        class="text-xl font-semibold tracking-tight break-words"
                    >
                        {{ developer.name }}
                    </h1>
                    <Badge
                        variant="outline"
                        :class="cn(statusBadgeClasses[developer.status])"
                    >
                        {{ isActive ? 'Active' : 'Inactive' }}
                    </Badge>
                </div>
                <dl
                    class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]"
                >
                    <dt class="text-muted-foreground">Email</dt>
                    <dd class="break-all">{{ developer.email }}</dd>
                    <dt class="text-muted-foreground">Team</dt>
                    <dd>
                        <span v-if="developer.team">{{ developer.team }}</span>
                        <span v-else class="text-muted-foreground">—</span>
                    </dd>
                    <dt class="text-muted-foreground">Last activity</dt>
                    <dd>
                        <RelativeTime :value="developer.last_activity_at" />
                    </dd>
                    <dt class="text-muted-foreground">Last sync</dt>
                    <dd><RelativeTime :value="developer.last_sync_at" /></dd>
                </dl>
            </div>

            <div v-if="canManage" class="flex flex-col gap-2 lg:items-end">
                <div class="flex flex-wrap gap-2">
                    <Dialog v-model:open="editOpen">
                        <DialogTrigger as-child>
                            <Button type="button" variant="outline">
                                <Pencil class="size-4" aria-hidden="true" />
                                Edit
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <Form
                                v-bind="update.form(developer.id)"
                                :options="{ preserveScroll: true }"
                                class="space-y-6"
                                v-slot="{
                                    errors,
                                    processing,
                                    reset,
                                    clearErrors,
                                }"
                                @success="editOpen = false"
                            >
                                <DialogHeader>
                                    <DialogTitle>Edit developer</DialogTitle>
                                    <DialogDescription>
                                        Update this developer's details.
                                    </DialogDescription>
                                </DialogHeader>

                                <div class="grid gap-2">
                                    <Label :for="`${id}-name`">Name</Label>
                                    <Input
                                        :id="`${id}-name`"
                                        name="name"
                                        :default-value="developer.name"
                                        required
                                        autocomplete="off"
                                        :aria-invalid="
                                            errors.name ? true : undefined
                                        "
                                    />
                                    <InputError :message="errors.name" />
                                </div>

                                <div class="grid gap-2">
                                    <Label :for="`${id}-email`">Email</Label>
                                    <Input
                                        :id="`${id}-email`"
                                        name="email"
                                        type="email"
                                        :default-value="developer.email"
                                        required
                                        autocomplete="off"
                                        :aria-invalid="
                                            errors.email ? true : undefined
                                        "
                                    />
                                    <InputError :message="errors.email" />
                                </div>

                                <div class="grid gap-2">
                                    <Label :for="`${id}-team`">
                                        Team
                                        <span
                                            class="font-normal text-muted-foreground"
                                            >(optional)</span
                                        >
                                    </Label>
                                    <Input
                                        :id="`${id}-team`"
                                        name="team"
                                        :default-value="developer.team ?? ''"
                                        autocomplete="off"
                                        :aria-invalid="
                                            errors.team ? true : undefined
                                        "
                                    />
                                    <InputError :message="errors.team" />
                                </div>

                                <div class="grid gap-2">
                                    <Label :for="`${id}-status`">Status</Label>
                                    <div class="relative">
                                        <select
                                            :id="`${id}-status`"
                                            name="status"
                                            :aria-describedby="`${id}-status-help`"
                                            class="h-9 w-full appearance-none truncate rounded-md border border-input bg-transparent py-1 pr-8 pl-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                                        >
                                            <option
                                                value="active"
                                                :selected="
                                                    developer.status ===
                                                    'active'
                                                "
                                                class="bg-popover text-popover-foreground"
                                            >
                                                Active
                                            </option>
                                            <option
                                                value="inactive"
                                                :selected="
                                                    developer.status ===
                                                    'inactive'
                                                "
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
                                    <p
                                        :id="`${id}-status-help`"
                                        class="text-xs text-muted-foreground"
                                    >
                                        Deactivating keeps this developer's
                                        devices and all history. Inactive
                                        developers can't receive new pairing
                                        codes.
                                    </p>
                                    <InputError :message="errors.status" />
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
                                    <Button
                                        type="submit"
                                        :disabled="processing"
                                    >
                                        Save
                                    </Button>
                                </DialogFooter>
                            </Form>
                        </DialogContent>
                    </Dialog>

                    <Button
                        type="button"
                        :disabled="!isActive || generating"
                        :aria-describedby="
                            isActive ? undefined : `${id}-pairing-disabled`
                        "
                        @click="generatePairingCode"
                    >
                        <KeyRound class="size-4" aria-hidden="true" />
                        Generate pairing code
                    </Button>
                </div>
                <p
                    v-if="!isActive"
                    :id="`${id}-pairing-disabled`"
                    class="max-w-xs text-xs text-muted-foreground lg:text-right"
                >
                    Pairing codes can only be generated for active developers.
                    Reactivate this developer to pair a new device.
                </p>
            </div>
        </header>

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

        <!-- Filters -->
        <div class="flex flex-col gap-4">
            <DateRangeFilter :range="range" />
            <EntityFilters :options="filterOptions" :values="filters" />
        </div>

        <!-- Stats -->
        <section class="flex flex-col gap-4" aria-label="Summary">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <MetricCard label="Sessions" :value="sessionsCount" />
                <MetricCard label="Devices" :value="devices.length" />
                <MetricCard label="Claude accounts" :value="accounts.length" />
            </div>
            <TokenMetricsGrid :totals="totals" />
            <TrendChart :points="trend" title="Token activity trend" />
        </section>

        <!-- Breakdowns -->
        <section
            class="flex flex-col gap-4"
            :aria-labelledby="`${id}-breakdowns`"
        >
            <h2
                :id="`${id}-breakdowns`"
                class="text-lg font-semibold tracking-tight"
            >
                Breakdowns
            </h2>
            <div class="grid gap-6 xl:grid-cols-2">
                <div class="flex min-w-0 flex-col gap-2">
                    <h3 class="text-sm font-medium">By device</h3>
                    <BreakdownTable
                        :rows="breakdowns.device"
                        dimension-label="Device"
                        :link-for="deviceLink"
                    />
                </div>
                <div class="flex min-w-0 flex-col gap-2">
                    <h3 class="text-sm font-medium">By Claude account</h3>
                    <BreakdownTable
                        :rows="breakdowns.account"
                        dimension-label="Claude account"
                        :link-for="accountLink"
                    />
                </div>
                <div class="flex min-w-0 flex-col gap-2">
                    <h3 class="text-sm font-medium">By project</h3>
                    <BreakdownTable
                        :rows="breakdowns.project"
                        dimension-label="Project"
                        :link-for="projectLink"
                    />
                </div>
                <div class="flex min-w-0 flex-col gap-2">
                    <h3 class="text-sm font-medium">By model</h3>
                    <BreakdownTable
                        :rows="breakdowns.model"
                        dimension-label="Model"
                        :link-for="modelLink"
                    />
                </div>
            </div>
        </section>

        <!-- Devices -->
        <section class="flex flex-col gap-4" :aria-labelledby="`${id}-devices`">
            <h2
                :id="`${id}-devices`"
                class="text-lg font-semibold tracking-tight"
            >
                Devices
            </h2>
            <EmptyState
                v-if="devices.length === 0"
                :icon="Laptop"
                title="No devices paired yet"
                :description="
                    canManage && isActive
                        ? 'Generate a pairing code, install the agent, then enter the code to pair a device.'
                        : undefined
                "
            />
            <div v-else class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[56rem] text-sm">
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
                                Platform
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
                                Claude Code version
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Status
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
                                Last seen
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                            >
                                Last sync
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="device in devices"
                            :key="device.id"
                            class="border-b last:border-b-0 hover:bg-muted/30"
                        >
                            <th
                                scope="row"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                <Link
                                    :href="deviceHref(device.device_uid)"
                                    class="rounded-sm break-all underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                >
                                    {{ deviceLabel(device) }}
                                </Link>
                            </th>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                {{ device.platform }}
                                <span
                                    v-if="device.platform_version"
                                    class="text-muted-foreground"
                                >
                                    {{ device.platform_version }}
                                </span>
                            </td>
                            <td class="px-4 py-2.5">
                                {{ device.architecture ?? '—' }}
                            </td>
                            <td class="px-4 py-2.5 font-mono text-xs">
                                {{ device.agent_version ?? '—' }}
                            </td>
                            <td class="px-4 py-2.5 font-mono text-xs">
                                {{ device.claude_code_version ?? '—' }}
                            </td>
                            <td class="px-4 py-2.5">
                                <StatusBadge
                                    kind="device"
                                    :status="device.status"
                                />
                            </td>
                            <td class="px-4 py-2.5">
                                <StatusBadge
                                    kind="connection"
                                    :status="device.connection"
                                />
                            </td>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                <RelativeTime :value="device.last_seen_at" />
                            </td>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                <RelativeTime :value="device.last_sync_at" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- Claude accounts -->
        <section
            class="flex flex-col gap-4"
            :aria-labelledby="`${id}-accounts`"
        >
            <h2
                :id="`${id}-accounts`"
                class="text-lg font-semibold tracking-tight"
            >
                Claude accounts
            </h2>
            <EmptyState
                v-if="accounts.length === 0"
                :icon="UserRound"
                title="No Claude accounts seen yet"
                description="Accounts appear after a paired device syncs Claude Code activity."
            />
            <div v-else class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[36rem] text-sm">
                    <thead class="bg-muted/50 text-muted-foreground">
                        <tr class="border-b">
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Account
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                            >
                                First seen
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                            >
                                Last seen
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Status
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Devices
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="account in accounts"
                            :key="account.id"
                            class="border-b last:border-b-0 hover:bg-muted/30"
                        >
                            <th
                                scope="row"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                <span class="break-all">{{
                                    accountLabel(account)
                                }}</span>
                                <span
                                    v-if="account.email && account.display_name"
                                    class="block text-xs font-normal text-muted-foreground"
                                >
                                    {{ account.display_name }}
                                </span>
                            </th>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                <RelativeTime :value="account.first_seen_at" />
                            </td>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                <RelativeTime :value="account.last_seen_at" />
                            </td>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                {{ accountStatusLabel(account.status) }}
                            </td>
                            <td class="px-4 py-2.5">
                                <ul
                                    v-if="account.devices.length > 0"
                                    class="flex flex-wrap gap-1.5"
                                >
                                    <li
                                        v-for="device in account.devices"
                                        :key="device.device_uid"
                                    >
                                        <Link
                                            :href="
                                                deviceHref(device.device_uid)
                                            "
                                            class="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                        >
                                            <Badge variant="outline">{{
                                                device.label
                                            }}</Badge>
                                        </Link>
                                    </li>
                                </ul>
                                <span v-else class="text-muted-foreground"
                                    >—</span
                                >
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- Recent sessions -->
        <section
            class="flex flex-col gap-4"
            :aria-labelledby="`${id}-sessions`"
        >
            <h2
                :id="`${id}-sessions`"
                class="text-lg font-semibold tracking-tight"
            >
                Recent sessions
            </h2>
            <EmptyState
                v-if="recentSessions.length === 0"
                title="No sessions in this period"
            />
            <div v-else class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[56rem] text-sm">
                    <thead class="bg-muted/50 text-muted-foreground">
                        <tr class="border-b">
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Session
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Project
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Model
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
                                Started
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium"
                            >
                                Duration
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                            >
                                Actual Consumed Tokens
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                            >
                                Total Token Activity
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="session in recentSessions"
                            :key="session.id"
                            class="border-b last:border-b-0 hover:bg-muted/30"
                        >
                            <th
                                scope="row"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                <Link
                                    :href="sessionShow(session.id)"
                                    :title="session.source_session_id"
                                    class="inline-block max-w-[10rem] truncate rounded-sm align-bottom font-mono text-xs underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                >
                                    {{ session.source_session_id }}
                                </Link>
                            </th>
                            <td class="px-4 py-2.5">
                                {{ session.project ?? '—' }}
                            </td>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                {{ session.model ?? '—' }}
                            </td>
                            <td class="px-4 py-2.5">{{ session.device }}</td>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                <RelativeTime :value="session.started_at" />
                            </td>
                            <td
                                class="px-4 py-2.5 text-right whitespace-nowrap tabular-nums"
                            >
                                {{ formatDuration(session.duration_seconds) }}
                            </td>
                            <td
                                class="px-4 py-2.5 text-right tabular-nums"
                                :title="
                                    formatTokensFull(
                                        session.actual_consumed_tokens,
                                    )
                                "
                            >
                                {{
                                    formatTokens(session.actual_consumed_tokens)
                                }}
                            </td>
                            <td
                                class="px-4 py-2.5 text-right tabular-nums"
                                :title="
                                    formatTokensFull(
                                        session.total_token_activity,
                                    )
                                "
                            >
                                {{ formatTokens(session.total_token_activity) }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
    </div>

    <!-- One-time pairing code -->
    <Dialog v-model:open="pairingOpen">
        <DialogContent @interact-outside.prevent @escape-key-down.prevent>
            <DialogHeader>
                <DialogTitle>Pairing code</DialogTitle>
                <DialogDescription>
                    Install the agent, then enter this code.
                </DialogDescription>
            </DialogHeader>

            <div class="flex flex-col items-center gap-3 py-2">
                <p
                    class="rounded-lg border bg-muted/40 px-4 py-3 text-center font-mono text-3xl font-semibold tracking-[0.2em] break-all select-all"
                >
                    <span class="sr-only">Pairing code: </span>{{ pairingCode }}
                </p>
                <p class="text-sm text-muted-foreground">
                    Expires in {{ pairingCodeTtlMinutes }} minutes (at
                    {{ expiresAtLabel }})
                </p>
                <p class="text-center text-xs text-muted-foreground">
                    This code is shown only once. Copy it now; it can't be
                    viewed again after you close this dialog.
                </p>
            </div>

            <p aria-live="polite" class="sr-only">
                {{ copied ? 'Pairing code copied to clipboard' : '' }}
            </p>
            <p v-if="copyError" role="alert" class="text-sm text-destructive">
                Couldn't copy automatically. Select the code and copy it
                manually.
            </p>

            <DialogFooter class="gap-2">
                <DialogClose as-child>
                    <Button type="button" variant="secondary">Close</Button>
                </DialogClose>
                <Button type="button" @click="copyPairingCode">
                    <Check v-if="copied" class="size-4" aria-hidden="true" />
                    <Copy v-else class="size-4" aria-hidden="true" />
                    {{ copied ? 'Copied' : 'Copy' }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
