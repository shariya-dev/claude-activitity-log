<script setup lang="ts">
import type { SyncRejection } from '@/pages/Devices/types';

defineProps<{
    rejections: SyncRejection[];
}>();
</script>

<template>
    <ul class="flex flex-col gap-1 text-xs">
        <li
            v-for="(rejection, index) in rejections"
            :key="`${rejection.type}-${rejection.source_id ?? 'none'}-${index}`"
            class="flex flex-wrap items-baseline gap-x-1.5 break-all"
        >
            <span class="font-medium text-foreground">{{
                rejection.type
            }}</span>
            <span class="text-muted-foreground" aria-hidden="true">·</span>
            <span class="font-mono text-muted-foreground">{{
                rejection.source_id ?? '—'
            }}</span>
            <span class="text-muted-foreground" aria-hidden="true">·</span>
            <span class="text-foreground">{{ rejection.reason }}</span>
        </li>
    </ul>
</template>
