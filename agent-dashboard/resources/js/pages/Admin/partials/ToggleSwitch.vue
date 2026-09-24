<script setup lang="ts">
import { cn } from '@/lib/utils';

type Props = {
    modelValue: boolean;
    id?: string;
    disabled?: boolean;
    ariaLabel?: string;
    ariaLabelledby?: string;
    ariaDescribedby?: string;
};

const props = withDefaults(defineProps<Props>(), {
    id: undefined,
    disabled: false,
    ariaLabel: undefined,
    ariaLabelledby: undefined,
    ariaDescribedby: undefined,
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
}>();

function toggle(): void {
    if (!props.disabled) {
        emit('update:modelValue', !props.modelValue);
    }
}
</script>

<template>
    <button
        :id="id"
        type="button"
        role="switch"
        :aria-checked="modelValue"
        :aria-label="ariaLabel"
        :aria-labelledby="ariaLabelledby"
        :aria-describedby="ariaDescribedby"
        :disabled="disabled"
        :data-state="modelValue ? 'checked' : 'unchecked'"
        :class="
            cn(
                'inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
                modelValue ? 'bg-primary' : 'bg-input dark:bg-input/80',
            )
        "
        @click="toggle"
    >
        <span
            aria-hidden="true"
            :class="
                cn(
                    'pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform',
                    modelValue
                        ? 'translate-x-4 dark:bg-primary-foreground'
                        : 'translate-x-0 dark:bg-foreground',
                )
            "
        />
    </button>
</template>
