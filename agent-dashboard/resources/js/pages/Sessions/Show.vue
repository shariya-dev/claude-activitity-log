<script setup lang="ts">
import { Head, Link, router, setLayoutProps, usePage } from '@inertiajs/vue3';
import { Check, Copy, Info, ShieldAlert } from '@lucide/vue';
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import StatusBadge from '@/components/monitor/StatusBadge.vue';
import TokenMetricsGrid from '@/components/monitor/TokenMetricsGrid.vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatDateTime, formatDuration, formatTokensFull } from '@/lib/format';
import { show as developersShow } from '@/routes/developers';
import { show as devicesShow } from '@/routes/devices';
import { show as projectsShow } from '@/routes/projects';
import {
    index as sessionsIndex,
    show as sessionsShow,
} from '@/routes/sessions';
import type { BreadcrumbItem } from '@/types';
import type { SessionStatus, TokenTotals } from '@/types/monitor';

type SessionDetail = {
    id: number;
    source_session_id: string;
    status: SessionStatus;
    claude_code_version: string | null;
    entrypoint: string | null;
    git_branch: string | null;
    started_at: string;
    last_activity_at: string;
    ended_at: string | null;
    duration_seconds: number;
    activity_count: number;
    developer: { id: number; name: string };
    device: { id: number; device_uid: string; label: string };
    account: { id: number; label: string } | null;
    project: { id: number; name: string } | null;
    model: { id: number; name: string } | null;
};

type TimelineRow = {
    id: number;
    recorded_at: string;
    model: string | null;
    is_sidechain: boolean;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    actual_consumed_tokens: number;
    total_token_activity: number;
};

type PromptState = {
    available: boolean;
    message_count: number;
    tracking_enabled: boolean;
};

type SessionMessageItem = {
    id: number;
    role: string;
    recorded_at: string;
    content: string;
};

const props = defineProps<{
    session: SessionDetail;
    totals: TokenTotals;
    timeline: TimelineRow[];
    timeline_limit: number;
    prompts: PromptState;
    messages?: SessionMessageItem[];
}>();

const page = usePage();

const shortId = computed<string>(() =>
    props.session.source_session_id.slice(0, 8),
);
const title = computed<string>(() => `Session ${shortId.value}`);

watchEffect(() => {
    setLayoutProps<{ breadcrumbs: BreadcrumbItem[] }>({
        breadcrumbs: [
            { title: 'Sessions', href: sessionsIndex() },
            { title: title.value, href: sessionsShow(props.session.id) },
        ],
    });
});

const timezone = computed<string>(() => {
    const monitor = page.props.monitor as { timezone?: unknown } | undefined;

    return typeof monitor?.timezone === 'string'
        ? monitor.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone;
});

const canViewPrompts = computed<boolean>(() => {
    const can = page.props.can as { viewPrompts?: unknown } | null | undefined;

    return can?.viewPrompts === true;
});

const showPromptSection = computed<boolean>(
    () => canViewPrompts.value && props.prompts.available,
);

const endTooltip =
    'Claude Code does not record an explicit end; last activity shown';

const timelineTruncated = computed<boolean>(
    () => props.timeline.length >= props.timeline_limit,
);

// Copy source session ID
const copied = ref(false);
const copyError = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copySourceId(): Promise<void> {
    if (copiedTimer !== undefined) {
        clearTimeout(copiedTimer);
    }

    try {
        await navigator.clipboard.writeText(props.session.source_session_id);
        copied.value = true;
        copyError.value = false;
    } catch {
        copied.value = false;
        copyError.value = true;
    }

    copiedTimer = setTimeout(() => {
        copied.value = false;
        copyError.value = false;
        copiedTimer = undefined;
    }, 2000);
}

onBeforeUnmount(() => {
    if (copiedTimer !== undefined) {
        clearTimeout(copiedTimer);
    }
});

// Prompt viewing: messages are an optional prop, loaded only on request.
const messagesVisible = ref(false);
const loadingMessages = ref(false);
const messagesError = ref<string | null>(null);

const visibleMessages = computed<SessionMessageItem[] | null>(() =>
    messagesVisible.value && props.messages !== undefined
        ? props.messages
        : null,
);

function showPrompts(): void {
    if (loadingMessages.value) {
        return;
    }

    messagesError.value = null;

    router.reload({
        only: ['messages'],
        onStart: () => {
            loadingMessages.value = true;
        },
        onSuccess: () => {
            messagesVisible.value = true;
        },
        onHttpException: (response) => {
            messagesError.value =
                response.status === 403
                    ? 'You do not have permission to view prompts.'
                    : 'Prompts could not be loaded. Try again.';

            return false;
        },
        onNetworkError: () => {
            messagesError.value =
                'Prompts could not be loaded. Check your connection and try again.';

            return false;
        },
        onFinish: () => {
            loadingMessages.value = false;
        },
    });
}

function hidePrompts(): void {
    messagesVisible.value = false;
}

function roleLabel(role: string): string {
    const words = role.replace(/[_-]+/g, ' ').trim();

    return words.length === 0
        ? 'Unknown'
        : words.replace(/\b\w/g, (char) => char.toUpperCase());
}

const linkClass =
    'font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline';
</script>

<template>
    <Head :title="title" />

    <div class="flex flex-1 flex-col gap-6 p-4">
        <div class="flex flex-wrap items-center gap-3">
            <h1 class="text-xl font-semibold tracking-tight">{{ title }}</h1>
            <StatusBadge kind="session" :status="session.status" />
        </div>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card class="gap-4 py-4">
                <CardHeader class="px-4">
                    <CardTitle class="text-base">Details</CardTitle>
                </CardHeader>
                <CardContent class="px-4">
                    <dl
                        class="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]"
                    >
                        <dt class="text-muted-foreground">Source session ID</dt>
                        <dd class="flex min-w-0 items-start gap-2">
                            <code
                                class="min-w-0 font-mono text-xs break-all sm:text-sm"
                            >
                                {{ session.source_session_id }}
                            </code>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                class="size-7 shrink-0"
                                :aria-label="
                                    copied
                                        ? 'Source session ID copied'
                                        : 'Copy source session ID'
                                "
                                @click="copySourceId"
                            >
                                <Check
                                    v-if="copied"
                                    class="size-3.5"
                                    aria-hidden="true"
                                />
                                <Copy
                                    v-else
                                    class="size-3.5"
                                    aria-hidden="true"
                                />
                            </Button>
                            <span
                                role="status"
                                aria-live="polite"
                                class="self-center text-xs text-muted-foreground"
                            >
                                <template v-if="copied">Copied</template>
                                <template v-else-if="copyError">
                                    Copy failed
                                </template>
                            </span>
                        </dd>

                        <dt class="text-muted-foreground">Status</dt>
                        <dd>
                            <StatusBadge
                                kind="session"
                                :status="session.status"
                            />
                        </dd>

                        <dt class="text-muted-foreground">
                            Claude Code version
                        </dt>
                        <dd>
                            <span v-if="session.claude_code_version">
                                {{ session.claude_code_version }}
                            </span>
                            <span v-else class="text-muted-foreground">—</span>
                        </dd>

                        <dt class="text-muted-foreground">Entrypoint</dt>
                        <dd>
                            <span v-if="session.entrypoint">
                                {{ session.entrypoint }}
                            </span>
                            <span v-else class="text-muted-foreground">—</span>
                        </dd>

                        <template v-if="session.git_branch !== null">
                            <dt class="text-muted-foreground">Git branch</dt>
                            <dd class="font-mono text-xs break-all sm:text-sm">
                                {{ session.git_branch }}
                            </dd>
                        </template>

                        <dt class="text-muted-foreground">Developer</dt>
                        <dd>
                            <Link
                                :href="developersShow(session.developer.id)"
                                :class="linkClass"
                            >
                                {{ session.developer.name }}
                            </Link>
                        </dd>

                        <dt class="text-muted-foreground">Device</dt>
                        <dd>
                            <Link
                                :href="devicesShow(session.device.device_uid)"
                                :class="linkClass"
                            >
                                {{ session.device.label }}
                            </Link>
                        </dd>

                        <dt class="text-muted-foreground">Account</dt>
                        <dd>
                            <Link
                                v-if="session.account"
                                :href="
                                    sessionsIndex({
                                        query: { account: session.account.id },
                                    })
                                "
                                :class="linkClass"
                            >
                                {{ session.account.label }}
                            </Link>
                            <span v-else class="text-muted-foreground">—</span>
                        </dd>

                        <dt class="text-muted-foreground">Project</dt>
                        <dd>
                            <Link
                                v-if="session.project"
                                :href="projectsShow(session.project.id)"
                                :class="linkClass"
                            >
                                {{ session.project.name }}
                            </Link>
                            <span v-else class="text-muted-foreground">—</span>
                        </dd>

                        <dt class="text-muted-foreground">Model</dt>
                        <dd>
                            <Link
                                v-if="session.model"
                                :href="
                                    sessionsIndex({
                                        query: { model: session.model.id },
                                    })
                                "
                                :class="linkClass"
                            >
                                {{ session.model.name }}
                            </Link>
                            <span v-else class="text-muted-foreground">—</span>
                        </dd>
                    </dl>
                </CardContent>
            </Card>

            <Card class="gap-4 py-4">
                <CardHeader class="px-4">
                    <CardTitle class="text-base">Timing</CardTitle>
                </CardHeader>
                <CardContent class="px-4">
                    <dl
                        class="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]"
                    >
                        <dt class="text-muted-foreground">Start</dt>
                        <dd>
                            <time :datetime="session.started_at">
                                {{
                                    formatDateTime(session.started_at, timezone)
                                }}
                            </time>
                        </dd>

                        <dt class="text-muted-foreground">End</dt>
                        <dd>
                            <time
                                v-if="session.ended_at"
                                :datetime="session.ended_at"
                            >
                                {{ formatDateTime(session.ended_at, timezone) }}
                            </time>
                            <span
                                v-else
                                class="inline-flex items-center gap-1.5"
                            >
                                <span class="text-muted-foreground">—</span>
                                <TooltipProvider :delay-duration="150">
                                    <Tooltip>
                                        <TooltipTrigger
                                            type="button"
                                            class="inline-flex rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                            aria-label="Why is there no end time?"
                                        >
                                            <Info
                                                class="size-3.5"
                                                aria-hidden="true"
                                            />
                                        </TooltipTrigger>
                                        <TooltipContent class="max-w-xs">
                                            {{ endTooltip }}
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </span>
                        </dd>

                        <dt class="text-muted-foreground">Last activity</dt>
                        <dd>
                            <time :datetime="session.last_activity_at">
                                {{
                                    formatDateTime(
                                        session.last_activity_at,
                                        timezone,
                                    )
                                }}
                            </time>
                        </dd>

                        <dt class="text-muted-foreground">Duration</dt>
                        <dd class="tabular-nums">
                            {{ formatDuration(session.duration_seconds) }}
                        </dd>

                        <dt class="text-muted-foreground">Activity count</dt>
                        <dd class="tabular-nums">
                            {{ formatTokensFull(session.activity_count) }}
                        </dd>
                    </dl>
                </CardContent>
            </Card>
        </div>

        <section aria-labelledby="session-tokens-heading" class="space-y-3">
            <h2
                id="session-tokens-heading"
                class="text-base font-semibold tracking-tight"
            >
                Token activity
            </h2>
            <TokenMetricsGrid :totals="totals" />
        </section>

        <section aria-labelledby="session-timeline-heading" class="space-y-3">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h2
                    id="session-timeline-heading"
                    class="text-base font-semibold tracking-tight"
                >
                    Usage timeline
                </h2>
                <p
                    v-if="timelineTruncated && timeline.length > 0"
                    class="text-xs text-muted-foreground"
                >
                    Showing the first {{ formatTokensFull(timeline_limit) }}
                    messages
                </p>
            </div>
            <EmptyState
                v-if="timeline.length === 0"
                title="No usage recorded for this session"
            />
            <div v-else class="overflow-x-auto rounded-lg border">
                <table class="w-full text-sm">
                    <thead class="bg-muted/50 text-muted-foreground">
                        <tr class="border-b">
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                            >
                                Time
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                            >
                                Model
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                            >
                                Sidechain
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                            >
                                Input
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                            >
                                Output
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                            >
                                Cache Creation
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                            >
                                Cache Read
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                            >
                                Actual
                            </th>
                            <th
                                scope="col"
                                class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                            >
                                Total
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="row in timeline"
                            :key="row.id"
                            class="border-b last:border-b-0 hover:bg-muted/30"
                        >
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                <time :datetime="row.recorded_at">
                                    {{
                                        formatDateTime(
                                            row.recorded_at,
                                            timezone,
                                        )
                                    }}
                                </time>
                            </td>
                            <td class="px-4 py-2.5 whitespace-nowrap">
                                <span v-if="row.model">{{ row.model }}</span>
                                <span v-else class="text-muted-foreground">
                                    —
                                </span>
                            </td>
                            <td class="px-4 py-2.5">
                                <Badge
                                    v-if="row.is_sidechain"
                                    variant="secondary"
                                >
                                    Yes
                                </Badge>
                                <span v-else class="text-muted-foreground">
                                    No
                                </span>
                            </td>
                            <td class="px-4 py-2.5 text-right tabular-nums">
                                {{ formatTokensFull(row.input_tokens) }}
                            </td>
                            <td class="px-4 py-2.5 text-right tabular-nums">
                                {{ formatTokensFull(row.output_tokens) }}
                            </td>
                            <td class="px-4 py-2.5 text-right tabular-nums">
                                {{
                                    formatTokensFull(row.cache_creation_tokens)
                                }}
                            </td>
                            <td class="px-4 py-2.5 text-right tabular-nums">
                                {{ formatTokensFull(row.cache_read_tokens) }}
                            </td>
                            <td class="px-4 py-2.5 text-right tabular-nums">
                                {{
                                    formatTokensFull(row.actual_consumed_tokens)
                                }}
                            </td>
                            <td class="px-4 py-2.5 text-right tabular-nums">
                                {{ formatTokensFull(row.total_token_activity) }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <section
            v-if="showPromptSection"
            aria-labelledby="session-prompts-heading"
            class="space-y-3"
        >
            <h2
                id="session-prompts-heading"
                class="text-base font-semibold tracking-tight"
            >
                Prompts
            </h2>

            <Alert
                class="border-amber-600/30 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:text-amber-300"
            >
                <ShieldAlert aria-hidden="true" />
                <AlertTitle>Sensitive: access is logged.</AlertTitle>
            </Alert>

            <div
                v-if="!prompts.tracking_enabled"
                class="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm"
            >
                <Info
                    class="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                />
                <div>
                    <p class="font-medium">Prompt tracking is disabled</p>
                    <p class="text-muted-foreground">
                        No new prompts are collected. Messages already stored
                        remain viewable with permission until retention purges
                        them.
                    </p>
                </div>
            </div>

            <div v-if="visibleMessages === null" class="flex flex-col gap-2">
                <div>
                    <Button
                        type="button"
                        variant="outline"
                        :disabled="loadingMessages"
                        :aria-busy="loadingMessages"
                        @click="showPrompts"
                    >
                        <template v-if="loadingMessages">
                            Loading prompts…
                        </template>
                        <template v-else>
                            Show prompts ({{
                                formatTokensFull(prompts.message_count)
                            }})
                        </template>
                    </Button>
                </div>
                <Alert v-if="messagesError" variant="destructive">
                    <AlertDescription>{{ messagesError }}</AlertDescription>
                </Alert>
            </div>

            <div v-else class="flex flex-col gap-3">
                <div class="flex items-center justify-between gap-2">
                    <p class="text-sm text-muted-foreground">
                        {{ formatTokensFull(visibleMessages.length) }}
                        {{
                            visibleMessages.length === 1
                                ? 'message'
                                : 'messages'
                        }}
                    </p>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        @click="hidePrompts"
                    >
                        Hide
                    </Button>
                </div>
                <EmptyState
                    v-if="visibleMessages.length === 0"
                    title="No messages to show"
                />
                <ol v-else class="flex flex-col gap-3">
                    <li
                        v-for="message in visibleMessages"
                        :key="message.id"
                        class="rounded-lg border p-4"
                    >
                        <div
                            class="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                        >
                            <Badge variant="outline">
                                {{ roleLabel(message.role) }}
                            </Badge>
                            <time :datetime="message.recorded_at">
                                {{
                                    formatDateTime(
                                        message.recorded_at,
                                        timezone,
                                    )
                                }}
                            </time>
                        </div>
                        <!-- Plain text only (textContent): avoids stray template whitespace under pre-wrap; never v-html. -->
                        <p
                            class="text-sm break-words whitespace-pre-wrap"
                            v-text="message.content"
                        />
                    </li>
                </ol>
            </div>
        </section>
    </div>
</template>
