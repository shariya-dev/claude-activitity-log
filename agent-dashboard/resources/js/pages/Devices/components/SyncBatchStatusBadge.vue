<script setup lang="ts">
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SyncBatchStatus } from '@/pages/Devices/types';

const props = defineProps<{
    status: SyncBatchStatus;
}>();

const statusMap: Record<
    SyncBatchStatus,
    { label: string; badge: string; dot: string }
> = {
    succeeded: {
        label: 'Succeeded',
        badge: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300',
        dot: 'bg-emerald-500',
    },
    failed: {
        label: 'Failed',
        badge: 'border-red-600/30 bg-red-500/10 text-red-700 dark:border-red-400/30 dark:text-red-300',
        dot: 'bg-red-500',
    },
    processing: {
        label: 'Processing',
        badge: 'border-sky-600/30 bg-sky-500/10 text-sky-700 dark:border-sky-400/30 dark:text-sky-300',
        dot: 'bg-sky-500',
    },
};

const resolved = computed(
    () =>
        statusMap[props.status] ?? {
            label: props.status,
            badge: 'border-border bg-muted text-muted-foreground',
            dot: 'bg-muted-foreground',
        },
);
</script>

<template>
    <Badge variant="outline" :class="cn('gap-1.5', resolved.badge)">
        <span
            :class="cn('size-1.5 rounded-full', resolved.dot)"
            aria-hidden="true"
        />
        {{ resolved.label }}
    </Badge>
</template>
