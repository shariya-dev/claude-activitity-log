<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import EmptyState from '@/components/monitor/EmptyState.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import { formatDuration, formatTokens, formatTokensFull } from '@/lib/format';
import { show as sessionShow } from '@/routes/sessions';
import type { SessionRow } from '@/types/monitor';

defineProps<{
    sessions: SessionRow[];
}>();

function shortId(sourceSessionId: string): string {
    return sourceSessionId.slice(0, 8);
}
</script>

<template>
    <EmptyState
        v-if="sessions.length === 0"
        title="No sessions in this period"
        description="Claude Code sessions appear here once agents sync activity."
    />
    <div
        v-else
        class="overflow-x-auto rounded-lg border"
        role="region"
        aria-label="Recent sessions"
        tabindex="0"
    >
        <table class="w-full min-w-[48rem] text-sm">
            <thead class="bg-muted/50 text-muted-foreground">
                <tr class="border-b">
                    <th scope="col" class="px-4 py-2.5 text-left font-medium">
                        Session
                    </th>
                    <th scope="col" class="px-4 py-2.5 text-left font-medium">
                        Developer
                    </th>
                    <th scope="col" class="px-4 py-2.5 text-left font-medium">
                        Project
                    </th>
                    <th scope="col" class="px-4 py-2.5 text-left font-medium">
                        Model
                    </th>
                    <th scope="col" class="px-4 py-2.5 text-left font-medium">
                        Last activity
                    </th>
                    <th scope="col" class="px-4 py-2.5 text-right font-medium">
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
                    v-for="session in sessions"
                    :key="session.id"
                    class="border-b last:border-b-0 hover:bg-muted/30"
                >
                    <th scope="row" class="px-4 py-2.5 text-left font-medium">
                        <Link
                            :href="sessionShow.url(session.id)"
                            class="rounded-sm font-mono underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                            :title="session.source_session_id"
                            :aria-label="`Session ${session.source_session_id}`"
                        >
                            {{ shortId(session.source_session_id) }}
                        </Link>
                    </th>
                    <td class="px-4 py-2.5">
                        <span class="block max-w-48 truncate">
                            {{ session.developer }}
                        </span>
                        <span
                            class="block max-w-48 truncate text-xs text-muted-foreground"
                        >
                            {{ session.device }}
                        </span>
                    </td>
                    <td class="px-4 py-2.5">
                        <span
                            v-if="session.project"
                            class="block max-w-40 truncate"
                        >
                            {{ session.project }}
                        </span>
                        <span v-else class="text-muted-foreground"
                            >Unknown</span
                        >
                    </td>
                    <td class="px-4 py-2.5 whitespace-nowrap">
                        <span v-if="session.model">{{ session.model }}</span>
                        <span v-else class="text-muted-foreground"
                            >Unknown</span
                        >
                    </td>
                    <td class="px-4 py-2.5 whitespace-nowrap">
                        <RelativeTime :value="session.last_activity_at" />
                    </td>
                    <td
                        class="px-4 py-2.5 text-right whitespace-nowrap tabular-nums"
                    >
                        {{ formatDuration(session.duration_seconds) }}
                    </td>
                    <td
                        class="px-4 py-2.5 text-right tabular-nums"
                        :title="
                            formatTokensFull(session.actual_consumed_tokens)
                        "
                    >
                        {{ formatTokens(session.actual_consumed_tokens) }}
                    </td>
                    <td
                        class="px-4 py-2.5 text-right tabular-nums"
                        :title="formatTokensFull(session.total_token_activity)"
                    >
                        {{ formatTokens(session.total_token_activity) }}
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
