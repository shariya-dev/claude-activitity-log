<script setup lang="ts">
import { Head, setLayoutProps, usePage } from '@inertiajs/vue3';
import { Construction } from '@lucide/vue';
import { watchEffect } from 'vue';
import type { BreadcrumbItem } from '@/types';

const props = defineProps<{
    title: string;
}>();

const page = usePage();

watchEffect(() => {
    setLayoutProps<{ breadcrumbs: BreadcrumbItem[] }>({
        breadcrumbs: [{ title: props.title, href: page.url }],
    });
});
</script>

<template>
    <Head :title="title" />

    <div class="flex flex-1 flex-col gap-4 p-4">
        <h1 class="text-xl font-semibold tracking-tight">{{ title }}</h1>

        <div
            class="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-sidebar-border/70 p-8 text-center dark:border-sidebar-border"
        >
            <Construction
                class="size-8 text-muted-foreground"
                aria-hidden="true"
            />
            <p class="text-sm text-muted-foreground">
                This page is not available yet.
            </p>
        </div>
    </div>
</template>
