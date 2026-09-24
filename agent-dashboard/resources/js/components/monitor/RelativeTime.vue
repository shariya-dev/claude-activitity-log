<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { formatDateTime, formatRelative } from '@/lib/format';

type Props = {
    value: string | null;
    timezone?: string;
};

const props = defineProps<Props>();

const page = usePage();

const now = ref(new Date());
let timer: ReturnType<typeof setInterval> | undefined;

const tz = computed<string>(() => {
    if (props.timezone) {
        return props.timezone;
    }

    const monitor = page.props.monitor as { timezone?: unknown } | undefined;

    return typeof monitor?.timezone === 'string'
        ? monitor.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone;
});

const isoValue = computed<string | null>(() => {
    if (!props.value) {
        return null;
    }

    const date = new Date(props.value);

    return Number.isNaN(date.getTime()) ? null : date.toISOString();
});

const relative = computed(() => formatRelative(props.value, now.value));
const absolute = computed(() => formatDateTime(props.value, tz.value));

onMounted(() => {
    timer = setInterval(() => {
        now.value = new Date();
    }, 60_000);
});

onBeforeUnmount(() => {
    if (timer !== undefined) {
        clearInterval(timer);
    }
});
</script>

<template>
    <time v-if="isoValue" :datetime="isoValue" :title="absolute">
        {{ relative }}
    </time>
    <span v-else class="text-muted-foreground">Never</span>
</template>
