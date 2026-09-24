<script setup lang="ts">
import { ChevronDown } from '@lucide/vue';
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

type Option = {
    value: string;
    label: string;
};

type Props = {
    modelValue: string;
    options: Option[];
    id?: string;
    name?: string;
    disabled?: boolean;
    placeholder?: string;
    invalid?: boolean;
    class?: HTMLAttributes['class'];
};

const props = withDefaults(defineProps<Props>(), {
    id: undefined,
    name: undefined,
    disabled: false,
    placeholder: undefined,
    invalid: false,
    class: undefined,
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
}>();

function onChange(event: Event): void {
    emit('update:modelValue', (event.target as HTMLSelectElement).value);
}
</script>

<template>
    <div :class="cn('relative', props.class)">
        <select
            :id="id"
            :name="name"
            :value="modelValue"
            :disabled="disabled"
            :aria-invalid="invalid || undefined"
            class="h-9 w-full appearance-none truncate rounded-md border border-input bg-transparent py-1 pr-8 pl-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30"
            @change="onChange"
        >
            <option
                v-if="placeholder !== undefined"
                value=""
                class="bg-popover text-popover-foreground"
            >
                {{ placeholder }}
            </option>
            <option
                v-for="option in options"
                :key="option.value"
                :value="option.value"
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
</template>
