<script setup lang="ts">
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type StatusKind = 'device' | 'connection' | 'sync' | 'session';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

type Props = {
    kind: StatusKind;
    status: string;
};

const props = defineProps<Props>();

const statusMap: Record<
    StatusKind,
    Record<string, { label: string; tone: Tone }>
> = {
    device: {
        active: { label: 'Active', tone: 'success' },
        disabled: { label: 'Disabled', tone: 'neutral' },
        uninstalled: { label: 'Uninstalled', tone: 'danger' },
    },
    connection: {
        online: { label: 'Online', tone: 'success' },
        stale: { label: 'Stale', tone: 'warning' },
        offline: { label: 'Offline', tone: 'danger' },
    },
    sync: {
        healthy: { label: 'Healthy', tone: 'success' },
        offline: { label: 'Offline', tone: 'warning' },
        sync_failed: { label: 'Sync Failed', tone: 'danger' },
        disabled: { label: 'Disabled', tone: 'neutral' },
    },
    session: {
        active: { label: 'Active', tone: 'success' },
        idle: { label: 'Idle', tone: 'info' },
        ended: { label: 'Ended', tone: 'neutral' },
    },
};

const toneClasses: Record<Tone, { badge: string; dot: string }> = {
    success: {
        badge: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300',
        dot: 'bg-emerald-500',
    },
    warning: {
        badge: 'border-amber-600/30 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:text-amber-300',
        dot: 'bg-amber-500',
    },
    danger: {
        badge: 'border-red-600/30 bg-red-500/10 text-red-700 dark:border-red-400/30 dark:text-red-300',
        dot: 'bg-red-500',
    },
    info: {
        badge: 'border-sky-600/30 bg-sky-500/10 text-sky-700 dark:border-sky-400/30 dark:text-sky-300',
        dot: 'bg-sky-500',
    },
    neutral: {
        badge: 'border-border bg-muted text-muted-foreground',
        dot: 'bg-muted-foreground',
    },
};

function humanize(value: string): string {
    const words = value.replace(/[_-]+/g, ' ').trim();

    return words.length === 0
        ? 'Unknown'
        : words.replace(/\b\w/g, (char) => char.toUpperCase());
}

const resolved = computed(() => {
    const entry = statusMap[props.kind][props.status];

    return entry ?? { label: humanize(props.status), tone: 'neutral' as Tone };
});

const classes = computed(() => toneClasses[resolved.value.tone]);
</script>

<template>
    <Badge variant="outline" :class="cn('gap-1.5', classes.badge)">
        <span
            :class="cn('size-1.5 rounded-full', classes.dot)"
            aria-hidden="true"
        />
        {{ resolved.label }}
    </Badge>
</template>
