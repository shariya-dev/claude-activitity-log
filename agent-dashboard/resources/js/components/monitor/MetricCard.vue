<script setup lang="ts">
import type { LucideIcon } from '@lucide/vue';
import { Info } from '@lucide/vue';
import { computed } from 'vue';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatTokens, formatTokensFull } from '@/lib/format';

type Props = {
    label: string;
    value: number | string;
    hint?: string;
    tokens?: boolean;
    icon?: LucideIcon;
    tooltip?: string;
};

const props = withDefaults(defineProps<Props>(), {
    hint: undefined,
    tokens: false,
    icon: undefined,
    tooltip: undefined,
});

const displayValue = computed<string>(() => {
    if (typeof props.value === 'number') {
        return props.tokens
            ? formatTokens(props.value)
            : formatTokensFull(props.value);
    }

    return props.value;
});

const fullValue = computed<string | undefined>(() =>
    typeof props.value === 'number' && props.tokens
        ? formatTokensFull(props.value)
        : undefined,
);
</script>

<template>
    <Card class="gap-2 py-4">
        <CardHeader
            class="flex flex-row items-center justify-between gap-2 px-4"
        >
            <CardTitle
                class="flex items-center gap-1.5 text-sm font-medium text-muted-foreground"
            >
                <span>{{ label }}</span>
                <TooltipProvider v-if="tooltip" :delay-duration="150">
                    <Tooltip>
                        <TooltipTrigger
                            type="button"
                            class="inline-flex rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                            :aria-label="`About ${label}`"
                        >
                            <Info class="size-3.5" aria-hidden="true" />
                        </TooltipTrigger>
                        <TooltipContent class="max-w-xs">
                            {{ tooltip }}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </CardTitle>
            <component
                :is="icon"
                v-if="icon"
                class="size-4 text-muted-foreground"
                aria-hidden="true"
            />
        </CardHeader>
        <CardContent class="px-4">
            <p
                class="text-2xl font-semibold tracking-tight tabular-nums"
                :title="fullValue"
            >
                {{ displayValue }}
            </p>
            <p v-if="hint" class="mt-1 text-xs text-muted-foreground">
                {{ hint }}
            </p>
        </CardContent>
    </Card>
</template>
