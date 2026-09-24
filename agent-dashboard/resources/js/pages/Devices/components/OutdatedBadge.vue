<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';

defineProps<{
    minVersion?: string | null;
}>();
</script>

<template>
    <Badge
        variant="outline"
        class="border-amber-600/30 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:text-amber-300"
        :title="
            minVersion ? `Below minimum ${minVersion}` : 'Below minimum version'
        "
    >
        <TriangleAlert aria-hidden="true" />
        Outdated
        <span v-if="minVersion" class="sr-only"
            >(below minimum {{ minVersion }})</span
        >
    </Badge>
</template>
