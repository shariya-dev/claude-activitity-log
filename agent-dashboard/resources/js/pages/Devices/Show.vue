<script setup lang="ts">
import { Head, Link, setLayoutProps, usePage } from '@inertiajs/vue3';
import { History, UserRound } from '@lucide/vue';
import { computed, watchEffect } from 'vue';
import DateRangeFilter from '@/components/monitor/DateRangeFilter.vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import StatusBadge from '@/components/monitor/StatusBadge.vue';
import TokenMetricsGrid from '@/components/monitor/TokenMetricsGrid.vue';
import TrendChart from '@/components/monitor/TrendChart.vue';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDuration, formatTokens, formatTokensFull } from '@/lib/format';
import DeviceActions from '@/pages/Devices/components/DeviceActions.vue';
import OutdatedBadge from '@/pages/Devices/components/OutdatedBadge.vue';
import PairingCodeDialog from '@/pages/Devices/components/PairingCodeDialog.vue';
import SyncBatchesTable from '@/pages/Devices/components/SyncBatchesTable.vue';
import type {
    DeviceAccount,
    DeviceDetail,
    DeviceSyncState,
    SyncBatchRow,
} from '@/pages/Devices/types';
import { show as showDeveloper } from '@/routes/developers';
import { index, show } from '@/routes/devices';
import { show as showSession } from '@/routes/sessions';
import type { BreadcrumbItem } from '@/types';
import type {
    DateRangeProps,
    MonitorCan,
    SessionRow,
    TokenTotals,
    TrendPoint,
} from '@/types/monitor';

const props = defineProps<{
    device: DeviceDetail;
    sync_state: DeviceSyncState | null;
    accounts: DeviceAccount[];
    range: DateRangeProps;
    totals: TokenTotals;
    trend: TrendPoint[];
    recent_sessions: SessionRow[];
    batches: SyncBatchRow[];
    min_agent_version: string;
}>();

const page = usePage();

const deviceName = computed(
    () => props.device.hostname ?? props.device.device_uid,
);

watchEffect(() => {
    setLayoutProps<{ breadcrumbs: BreadcrumbItem[] }>({
        breadcrumbs: [
            { title: 'Devices', href: index() },
            { title: deviceName.value, href: show(props.device.device_uid) },
        ],
    });
});

const canManage = computed<boolean>(
    () =>
        (page.props.can as MonitorCan | null | undefined)?.manageAgents ===
        true,
);

const rangeOnly = ['range', 'totals', 'trend', 'recent_sessions'];

const identity = computed<{ label: string; value: string | null }[]>(() => [
    { label: 'Operating system', value: props.device.platform },
    { label: 'OS version', value: props.device.platform_version },
    { label: 'Architecture', value: props.device.architecture },
    { label: 'Claude Code version', value: props.device.claude_code_version },
    { label: 'Agent state', value: props.device.agent_state },
]);

const timeline = computed<{ label: string; value: string }[]>(() =>
    (
        [
            { label: 'First seen', value: props.device.first_seen_at },
            { label: 'Last seen', value: props.device.last_seen_at },
            { label: 'Last sync', value: props.device.last_sync_at },
            {
                label: 'Last local activity',
                value: props.device.last_local_activity_at,
            },
            {
                label: 'Sync requested',
                value: props.device.sync_requested_at,
            },
            { label: 'Disabled', value: props.device.disabled_at },
            { label: 'Uninstalled', value: props.device.uninstalled_at },
        ] as { label: string; value: string | null }[]
    ).filter(
        (entry): entry is { label: string; value: string } =>
            entry.value !== null,
    ),
);

const syncTotals = computed<{ label: string; value: number }[]>(() =>
    props.sync_state
        ? [
              {
                  label: 'Records created',
                  value: props.sync_state.records_created_total,
              },
              {
                  label: 'Records updated',
                  value: props.sync_state.records_updated_total,
              },
              {
                  label: 'Records rejected',
                  value: props.sync_state.records_rejected_total,
              },
          ]
        : [],
);

function accountLabel(account: DeviceAccount): string {
    return account.display_name ?? account.email ?? 'Unknown account';
}
</script>

<template>
    <Head :title="deviceName" />

    <PairingCodeDialog v-if="canManage" />

    <div class="flex flex-1 flex-col gap-6 p-4">
        <header
            class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
        >
            <div class="flex min-w-0 flex-col gap-2">
                <h1 class="text-xl font-semibold tracking-tight break-all">
                    {{ deviceName }}
                </h1>
                <div class="flex flex-wrap items-center gap-2">
                    <StatusBadge kind="device" :status="device.status" />
                    <StatusBadge
                        kind="connection"
                        :status="device.connection"
                    />
                    <StatusBadge kind="sync" :status="device.health" />
                    <OutdatedBadge
                        v-if="device.outdated"
                        :min-version="min_agent_version"
                    />
                </div>
                <p class="text-sm text-muted-foreground">
                    Developer:
                    <Link
                        :href="showDeveloper(device.developer.id)"
                        class="rounded-sm text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                        {{ device.developer.name }}
                    </Link>
                    <span v-if="device.developer.deleted">(removed)</span>
                    <span class="break-all">
                        · {{ device.developer.email }}</span
                    >
                </p>
                <p class="text-xs text-muted-foreground">
                    Device ID:
                    <span class="font-mono break-all">{{
                        device.device_uid
                    }}</span>
                </p>
            </div>
            <DeviceActions v-if="canManage" :device="device" />
        </header>

        <div class="grid gap-4 lg:grid-cols-3">
            <Card class="gap-3 py-4">
                <CardHeader class="px-4">
                    <CardTitle class="text-base">Identity & versions</CardTitle>
                </CardHeader>
                <CardContent class="px-4">
                    <dl
                        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"
                    >
                        <template v-for="item in identity" :key="item.label">
                            <dt class="text-muted-foreground">
                                {{ item.label }}
                            </dt>
                            <dd class="break-all">{{ item.value ?? '—' }}</dd>
                        </template>
                        <dt class="text-muted-foreground">Agent version</dt>
                        <dd class="flex flex-wrap items-center gap-2">
                            <span class="font-mono text-xs">{{
                                device.agent_version ?? '—'
                            }}</span>
                            <OutdatedBadge
                                v-if="device.outdated"
                                :min-version="min_agent_version"
                            />
                        </dd>
                    </dl>
                </CardContent>
            </Card>

            <Card class="gap-3 py-4">
                <CardHeader class="px-4">
                    <CardTitle class="text-base">Status timeline</CardTitle>
                </CardHeader>
                <CardContent class="px-4">
                    <dl
                        v-if="timeline.length > 0"
                        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"
                    >
                        <template v-for="entry in timeline" :key="entry.label">
                            <dt class="text-muted-foreground">
                                {{ entry.label }}
                            </dt>
                            <dd><RelativeTime :value="entry.value" /></dd>
                        </template>
                    </dl>
                    <p v-else class="text-sm text-muted-foreground">
                        No activity recorded yet.
                    </p>
                </CardContent>
            </Card>

            <Card class="gap-3 py-4">
                <CardHeader class="px-4">
                    <CardTitle class="text-base">Sync state</CardTitle>
                </CardHeader>
                <CardContent class="px-4">
                    <dl
                        v-if="sync_state"
                        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"
                    >
                        <dt class="text-muted-foreground">Last success</dt>
                        <dd>
                            <RelativeTime :value="sync_state.last_success_at" />
                        </dd>
                        <dt class="text-muted-foreground">Last failure</dt>
                        <dd>
                            <RelativeTime :value="sync_state.last_failure_at" />
                        </dd>
                        <dt class="text-muted-foreground">Last error</dt>
                        <dd class="min-w-0">
                            <template
                                v-if="
                                    sync_state.last_error_code ||
                                    sync_state.last_error_message
                                "
                            >
                                <span
                                    v-if="sync_state.last_error_code"
                                    class="font-mono text-xs"
                                    >{{ sync_state.last_error_code }}</span
                                >
                                <p
                                    v-if="sync_state.last_error_message"
                                    class="text-xs break-words text-muted-foreground"
                                >
                                    {{ sync_state.last_error_message }}
                                </p>
                            </template>
                            <span v-else class="text-muted-foreground">—</span>
                        </dd>
                        <dt class="text-muted-foreground">
                            Consecutive failures
                        </dt>
                        <dd class="tabular-nums">
                            {{
                                formatTokensFull(
                                    sync_state.consecutive_failures,
                                )
                            }}
                        </dd>
                        <template v-for="item in syncTotals" :key="item.label">
                            <dt class="text-muted-foreground">
                                {{ item.label }}
                            </dt>
                            <dd class="tabular-nums">
                                {{ formatTokensFull(item.value) }}
                            </dd>
                        </template>
                    </dl>
                    <p v-else class="text-sm text-muted-foreground">
                        This device has not synced yet.
                    </p>
                </CardContent>
            </Card>
        </div>

        <section aria-labelledby="accounts-heading" class="flex flex-col gap-3">
            <h2 id="accounts-heading" class="text-base font-semibold">
                Claude accounts seen on this device
            </h2>
            <EmptyState
                v-if="accounts.length === 0"
                :icon="UserRound"
                title="No Claude accounts seen yet"
            />
            <div v-else class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[40rem] text-sm">
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
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Organization
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
                                class="px-4 py-2.5 text-left font-normal"
                            >
                                <span class="font-medium">{{
                                    accountLabel(account)
                                }}</span>
                                <span
                                    v-if="account.display_name && account.email"
                                    class="block text-xs break-all text-muted-foreground"
                                    >{{ account.email }}</span
                                >
                            </th>
                            <td class="px-4 py-2.5">
                                {{ account.organization_name ?? '—' }}
                            </td>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                <RelativeTime :value="account.first_seen_at" />
                            </td>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                <RelativeTime :value="account.last_seen_at" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <section aria-labelledby="tokens-heading" class="flex flex-col gap-4">
            <div
                class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
            >
                <h2 id="tokens-heading" class="text-base font-semibold">
                    Token activity
                </h2>
                <DateRangeFilter :range="range" :only="rangeOnly" />
            </div>
            <TokenMetricsGrid :totals="totals" />
            <TrendChart :points="trend" title="Token trend" />
        </section>

        <section aria-labelledby="sessions-heading" class="flex flex-col gap-3">
            <h2 id="sessions-heading" class="text-base font-semibold">
                Recent sessions
            </h2>
            <EmptyState
                v-if="recent_sessions.length === 0"
                :icon="History"
                title="No sessions in this period"
            />
            <div v-else class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[48rem] text-sm">
                    <thead class="bg-muted/50 text-muted-foreground">
                        <tr class="border-b">
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium"
                            >
                                Started
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
                            v-for="session in recent_sessions"
                            :key="session.id"
                            class="border-b last:border-b-0 hover:bg-muted/30"
                        >
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                <Link
                                    :href="showSession(session.id)"
                                    class="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                >
                                    <RelativeTime :value="session.started_at" />
                                </Link>
                            </td>
                            <td class="px-4 py-2.5 break-all">
                                {{ session.project ?? '—' }}
                            </td>
                            <td class="px-4 py-2.5 font-mono text-xs">
                                {{ session.model ?? '—' }}
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

        <section aria-labelledby="batches-heading" class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
                <h2 id="batches-heading" class="text-base font-semibold">
                    Sync batches
                </h2>
                <p class="text-sm text-muted-foreground">
                    The last 20 batches received from this device.
                </p>
            </div>
            <SyncBatchesTable :batches="batches" />
        </section>
    </div>
</template>
