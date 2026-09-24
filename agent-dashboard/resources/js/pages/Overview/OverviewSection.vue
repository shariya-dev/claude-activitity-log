<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { useId } from 'vue';

type Props = {
    title: string;
    description?: string;
    href?: string;
    linkLabel?: string;
};

withDefaults(defineProps<Props>(), {
    description: undefined,
    href: undefined,
    linkLabel: 'View all',
});

const headingId = useId();
</script>

<template>
    <section
        :aria-labelledby="headingId"
        class="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-5"
    >
        <header class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
                <h2 :id="headingId" class="text-base font-semibold">
                    {{ title }}
                </h2>
                <p
                    v-if="description"
                    class="mt-0.5 text-sm text-muted-foreground"
                >
                    {{ description }}
                </p>
            </div>
            <Link
                v-if="href"
                :href="href"
                class="rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
                {{ linkLabel }}
            </Link>
        </header>
        <slot />
    </section>
</template>
