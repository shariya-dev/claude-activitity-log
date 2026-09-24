<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { ChevronDown } from '@lucide/vue';
import { computed, useId } from 'vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type {
    FilterDimension,
    FilterOption,
    FilterOptions,
    FilterValues,
} from '@/types/monitor';

type Props = {
    options: FilterOptions;
    values: FilterValues;
    only?: string[];
};

const props = defineProps<Props>();

const page = usePage();
const id = useId();

const dimensionLabels: Record<FilterDimension, string> = {
    developer: 'Developer',
    device: 'Device',
    account: 'Account',
    project: 'Project',
    model: 'Model',
};

const dimensionOrder: FilterDimension[] = [
    'developer',
    'device',
    'account',
    'project',
    'model',
];

const dimensions = computed<
    { key: FilterDimension; label: string; options: FilterOption[] }[]
>(() =>
    dimensionOrder.flatMap((key) => {
        const options = props.options[key];

        return options ? [{ key, label: dimensionLabels[key], options }] : [];
    }),
);

const hasActiveFilters = computed(() =>
    dimensions.value.some(
        (dimension) =>
            props.values[dimension.key] !== null &&
            props.values[dimension.key] !== undefined,
    ),
);

function selectedValue(key: FilterDimension): string {
    const value = props.values[key];

    return value === null || value === undefined ? '' : String(value);
}

function visit(changes: Partial<Record<FilterDimension, string | null>>): void {
    const origin =
        typeof window !== 'undefined'
            ? window.location.origin
            : 'http://localhost';
    const url = new URL(page.url, origin);
    const query: Record<string, string> = Object.fromEntries(
        url.searchParams.entries(),
    );
    delete query.page;

    for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined || value === '') {
            delete query[key];
        } else {
            query[key] = value;
        }
    }

    router.get(url.pathname, query, {
        preserveState: true,
        preserveScroll: true,
        replace: true,
        ...(props.only ? { only: props.only } : {}),
    });
}

function onChange(key: FilterDimension, event: Event): void {
    const target = event.target as HTMLSelectElement;
    visit({ [key]: target.value === '' ? null : target.value });
}

function clearFilters(): void {
    visit(
        Object.fromEntries(
            dimensions.value.map((dimension) => [dimension.key, null]),
        ),
    );
}
</script>

<template>
    <div
        v-if="dimensions.length > 0"
        role="group"
        aria-label="Filters"
        class="flex flex-wrap items-end gap-3"
    >
        <div
            v-for="dimension in dimensions"
            :key="dimension.key"
            class="grid w-full gap-1.5 sm:w-48"
        >
            <Label :for="`${id}-${dimension.key}`">{{ dimension.label }}</Label>
            <div class="relative">
                <select
                    :id="`${id}-${dimension.key}`"
                    :name="dimension.key"
                    :value="selectedValue(dimension.key)"
                    class="h-9 w-full appearance-none truncate rounded-md border border-input bg-transparent py-1 pr-8 pl-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                    @change="onChange(dimension.key, $event)"
                >
                    <option value="" class="bg-popover text-popover-foreground">
                        All
                    </option>
                    <option
                        v-for="option in dimension.options"
                        :key="option.id"
                        :value="String(option.id)"
                        class="bg-popover text-popover-foreground"
                    >
                        {{ option.label }}
                    </option>
                </select>
                <ChevronDown
                    class="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                />
            </div>
        </div>
        <Button
            v-if="hasActiveFilters"
            type="button"
            variant="ghost"
            size="sm"
            class="h-9"
            @click="clearFilters"
        >
            Clear filters
        </Button>
    </div>
</template>
