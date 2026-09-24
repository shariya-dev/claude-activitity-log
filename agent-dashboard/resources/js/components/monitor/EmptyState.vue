<script setup lang="ts">
import type { LucideIcon } from '@lucide/vue';
import { ChartNoAxesColumn } from '@lucide/vue';

type Props = {
    title?: string;
    description?: string;
    icon?: LucideIcon;
};

withDefaults(defineProps<Props>(), {
    title: 'No data for this period',
    description: undefined,
    icon: undefined,
});
</script>

<template>
    <div
        class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center"
    >
        <component
            :is="icon ?? ChartNoAxesColumn"
            class="size-8 text-muted-foreground"
            aria-hidden="true"
        />
        <p class="text-sm font-medium text-foreground">{{ title }}</p>
        <p v-if="description" class="max-w-sm text-sm text-muted-foreground">
            {{ description }}
        </p>
        <div v-if="$slots.default" class="mt-2">
            <slot />
        </div>
    </div>
</template>
