<script setup lang="ts">
import { useId } from 'vue';
import MetricCard from '@/components/monitor/MetricCard.vue';
import type { TokenTotals } from '@/types/monitor';

defineProps<{
    totals: TokenTotals;
}>();

const headingId = useId();

const actualTooltip =
    'Actual Consumed = Input + Output + Cache Creation. Monitoring figure, not billing.';
</script>

<template>
    <div class="space-y-4">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
                label="Total Token Activity"
                :value="totals.total_token_activity"
                tokens
            />
            <MetricCard
                label="Actual Consumed Tokens"
                :value="totals.actual_consumed_tokens"
                hint="Input + Output + Cache Creation"
                :tooltip="actualTooltip"
                tokens
            />
            <MetricCard
                label="Input Tokens"
                :value="totals.input_tokens"
                tokens
            />
            <MetricCard
                label="Output Tokens"
                :value="totals.output_tokens"
                tokens
            />
            <MetricCard
                label="Cache Creation Tokens"
                :value="totals.cache_creation_tokens"
                tokens
            />
        </div>
        <section class="border-t pt-4" :aria-labelledby="headingId">
            <h3
                :id="headingId"
                class="mb-1 text-sm font-medium text-foreground"
            >
                Cache
            </h3>
            <p class="mb-3 text-xs text-muted-foreground">
                Cache Read Tokens are included in Total Token Activity and
                excluded from Actual Consumed Tokens.
            </p>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard
                    label="Cache Read Tokens"
                    :value="totals.cache_read_tokens"
                    tokens
                />
            </div>
        </section>
    </div>
</template>
