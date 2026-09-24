<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { CircleCheck } from '@lucide/vue';
import { computed } from 'vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import StatusBadge from '@/components/monitor/StatusBadge.vue';
import { Badge } from '@/components/ui/badge';
import { show as deviceShow } from '@/routes/devices';
import type { AgentHealthSummary, ProblemAgent } from '@/types/monitor';

const props = defineProps<{
    summary: AgentHealthSummary;
    agents: ProblemAgent[];
}>();

const summaryItems: {
    key: keyof AgentHealthSummary;
    label: string;
    dot: string;
}[] = [
    { key: 'online', label: 'Online', dot: 'bg-emerald-500' },
    { key: 'stale', label: 'Stale', dot: 'bg-amber-500' },
    { key: 'offline', label: 'Offline', dot: 'bg-red-500' },
    { key: 'sync_failed', label: 'Sync Failed', dot: 'bg-red-500' },
    { key: 'outdated', label: 'Outdated', dot: 'bg-sky-500' },
    { key: 'disabled', label: 'Disabled', dot: 'bg-muted-foreground' },
    { key: 'uninstalled', label: 'Uninstalled', dot: 'bg-muted-foreground' },
];

const hasAgents = computed(() =>
    Object.values(props.summary).some((count) => count > 0),
);

const platformLabels: Record<string, string> = {
    macos: 'macOS',
    windows: 'Windows',
    linux: 'Linux',
};

function platformLabel(platform: string): string {
    return platformLabels[platform] ?? platform;
}

function agentName(agent: ProblemAgent): string {
    return agent.hostname ?? agent.device_uid;
}
</script>

<template>
    <div class="flex flex-col gap-4">
        <dl class="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            <div
                v-for="item in summaryItems"
                :key="item.key"
                class="rounded-lg border px-3 py-2"
            >
                <dt
                    class="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                    <span
                        :class="['size-1.5 rounded-full', item.dot]"
                        aria-hidden="true"
                    />
                    {{ item.label }}
                </dt>
                <dd class="text-lg font-semibold tabular-nums">
                    {{ summary[item.key] }}
                </dd>
            </div>
        </dl>

        <EmptyState
            v-if="!hasAgents"
            title="No agents paired yet"
            description="Agents appear here once a developer pairs a device."
        />
        <EmptyState
            v-else-if="agents.length === 0"
            :icon="CircleCheck"
            title="No offline or stale agents"
            description="Every active agent is online, syncing and up to date."
        />
        <ul
            v-else
            class="divide-y rounded-lg border"
            aria-label="Agents needing attention"
        >
            <li
                v-for="agent in agents"
                :key="agent.device_id"
                class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
                <div class="min-w-0">
                    <Link
                        :href="deviceShow.url(agent.device_uid)"
                        class="block truncate rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                        {{ agentName(agent) }}
                    </Link>
                    <p class="truncate text-xs text-muted-foreground">
                        {{ agent.developer }} ·
                        {{ platformLabel(agent.platform) }}
                        <template v-if="agent.agent_version">
                            · v{{ agent.agent_version }}
                        </template>
                    </p>
                </div>
                <div
                    class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:justify-end"
                >
                    <StatusBadge kind="connection" :status="agent.connection" />
                    <StatusBadge
                        v-if="agent.health === 'sync_failed'"
                        kind="sync"
                        :status="agent.health"
                    />
                    <Badge v-if="agent.outdated" variant="outline">
                        Outdated
                    </Badge>
                    <span class="whitespace-nowrap">
                        Last seen
                        <RelativeTime :value="agent.last_seen_at" />
                    </span>
                </div>
            </li>
        </ul>
    </div>
</template>
