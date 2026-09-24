<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { computed, nextTick, ref, useId, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DatePreset, DateRangeProps } from '@/types/monitor';

type Props = {
    range: DateRangeProps;
    only?: string[];
};

const props = defineProps<Props>();

const page = usePage();
const id = useId();

const presets: { value: DatePreset; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
    { value: 'year', label: 'This Year' },
    { value: 'custom', label: 'Custom' },
];

const showCustom = ref(props.range.preset === 'custom');
const from = ref(props.range.from);
const to = ref(props.range.to);
const error = ref<string | null>(null);

watch(
    () => [props.range.preset, props.range.from, props.range.to].join('|'),
    () => {
        if (props.range.preset === 'custom') {
            showCustom.value = true;
        }

        from.value = props.range.from;
        to.value = props.range.to;
        error.value = null;
    },
);

const activePreset = computed<DatePreset>(() =>
    showCustom.value ? 'custom' : props.range.preset,
);

function currentLocation(): { path: string; query: Record<string, string> } {
    const origin =
        typeof window !== 'undefined'
            ? window.location.origin
            : 'http://localhost';
    const url = new URL(page.url, origin);

    return {
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
    };
}

function visit(params: Record<string, string>): void {
    const { path, query } = currentLocation();
    delete query.from;
    delete query.to;
    delete query.page;

    router.get(
        path,
        { ...query, ...params },
        {
            preserveState: true,
            preserveScroll: true,
            replace: true,
            ...(props.only ? { only: props.only } : {}),
        },
    );
}

function selectPreset(preset: DatePreset): void {
    if (preset === 'custom') {
        showCustom.value = true;
        void nextTick(() => document.getElementById(`${id}-from`)?.focus());

        return;
    }

    showCustom.value = false;
    error.value = null;
    visit({ range: preset });
}

function applyCustom(): void {
    if (!from.value || !to.value) {
        error.value = 'Choose both a start and an end date.';

        return;
    }

    if (from.value > to.value) {
        error.value = 'The start date must be on or before the end date.';

        return;
    }

    error.value = null;
    visit({ range: 'custom', from: from.value, to: to.value });
}
</script>

<template>
    <div class="flex flex-col gap-3">
        <div
            role="group"
            aria-label="Date range"
            class="flex flex-wrap items-center gap-1.5"
        >
            <Button
                v-for="preset in presets"
                :key="preset.value"
                type="button"
                size="sm"
                :variant="activePreset === preset.value ? 'default' : 'outline'"
                :aria-pressed="activePreset === preset.value"
                @click="selectPreset(preset.value)"
            >
                {{ preset.label }}
            </Button>
        </div>
        <form
            v-if="showCustom"
            class="flex flex-wrap items-end gap-3"
            aria-label="Custom date range"
            novalidate
            @submit.prevent="applyCustom"
        >
            <div class="grid gap-1.5">
                <Label :for="`${id}-from`">From</Label>
                <Input
                    :id="`${id}-from`"
                    :model-value="from"
                    @update:model-value="from = String($event)"
                    type="date"
                    class="w-auto"
                    required
                    :max="to || undefined"
                    :aria-invalid="error !== null"
                    :aria-describedby="error ? `${id}-error` : undefined"
                />
            </div>
            <div class="grid gap-1.5">
                <Label :for="`${id}-to`">To</Label>
                <Input
                    :id="`${id}-to`"
                    :model-value="to"
                    @update:model-value="to = String($event)"
                    type="date"
                    class="w-auto"
                    required
                    :min="from || undefined"
                    :aria-invalid="error !== null"
                    :aria-describedby="error ? `${id}-error` : undefined"
                />
            </div>
            <Button type="submit" size="sm" class="h-9">Apply</Button>
            <p
                v-if="error"
                :id="`${id}-error`"
                role="alert"
                class="w-full text-sm text-destructive"
            >
                {{ error }}
            </p>
        </form>
    </div>
</template>
