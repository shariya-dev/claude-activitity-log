<script setup lang="ts">
import { ChevronDown, ChevronRight, RefreshCw } from '@lucide/vue';
import { ref, useId } from 'vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import { Button } from '@/components/ui/button';
import { formatTokensFull } from '@/lib/format';
import SyncBatchRejections from '@/pages/Devices/components/SyncBatchRejections.vue';
import SyncBatchStatusBadge from '@/pages/Devices/components/SyncBatchStatusBadge.vue';
import type { SyncBatchRow } from '@/pages/Devices/types';

defineProps<{
    batches: SyncBatchRow[];
}>();

const id = useId();
const expanded = ref<number[]>([]);

function isExpanded(batchId: number): boolean {
    return expanded.value.includes(batchId);
}

function toggle(batchId: number): void {
    expanded.value = isExpanded(batchId)
        ? expanded.value.filter((item) => item !== batchId)
        : [...expanded.value, batchId];
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 1024) {
        return `${formatTokensFull(Math.max(0, bytes || 0))} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const countColumns: {
    field: 'accepted' | 'created' | 'updated' | 'rejected';
    label: string;
}[] = [
    { field: 'accepted', label: 'Accepted' },
    { field: 'created', label: 'Created' },
    { field: 'updated', label: 'Updated' },
    { field: 'rejected', label: 'Rejected' },
];
</script>

<template>
    <EmptyState
        v-if="batches.length === 0"
        title="No sync batches yet"
        description="Batches appear here once the agent sends data."
        :icon="RefreshCw"
    />
    <div v-else class="overflow-x-auto rounded-lg border">
        <table class="w-full min-w-[56rem] text-sm">
            <thead class="bg-muted/50 text-muted-foreground">
                <tr class="border-b">
                    <th scope="col" class="w-10 px-2 py-2.5">
                        <span class="sr-only">Rejections</span>
                    </th>
                    <th scope="col" class="px-4 py-2.5 text-left font-medium">
                        Received
                    </th>
                    <th scope="col" class="px-4 py-2.5 text-left font-medium">
                        Status
                    </th>
                    <th scope="col" class="px-4 py-2.5 text-left font-medium">
                        Initial
                    </th>
                    <th
                        v-for="column in countColumns"
                        :key="column.field"
                        scope="col"
                        class="px-4 py-2.5 text-right font-medium"
                    >
                        {{ column.label }}
                    </th>
                    <th
                        scope="col"
                        class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                    >
                        Duration
                    </th>
                    <th
                        scope="col"
                        class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                    >
                        Payload
                    </th>
                    <th scope="col" class="px-4 py-2.5 text-left font-medium">
                        Error
                    </th>
                </tr>
            </thead>
            <tbody>
                <template v-for="batch in batches" :key="batch.id">
                    <tr class="border-b last:border-b-0 hover:bg-muted/30">
                        <td class="px-2 py-2">
                            <Button
                                v-if="batch.rejections.length > 0"
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                :aria-expanded="isExpanded(batch.id)"
                                :aria-controls="`${id}-rejections-${batch.id}`"
                                :aria-label="`${isExpanded(batch.id) ? 'Hide' : 'Show'} ${batch.rejections.length} rejections`"
                                @click="toggle(batch.id)"
                            >
                                <ChevronDown
                                    v-if="isExpanded(batch.id)"
                                    aria-hidden="true"
                                />
                                <ChevronRight v-else aria-hidden="true" />
                            </Button>
                        </td>
                        <td class="px-4 py-2.5 whitespace-nowrap">
                            <RelativeTime :value="batch.received_at" />
                        </td>
                        <td class="px-4 py-2.5">
                            <SyncBatchStatusBadge :status="batch.status" />
                        </td>
                        <td class="px-4 py-2.5">
                            {{ batch.is_initial ? 'Yes' : 'No' }}
                        </td>
                        <td
                            v-for="column in countColumns"
                            :key="column.field"
                            class="px-4 py-2.5 text-right tabular-nums"
                        >
                            {{ formatTokensFull(batch[column.field]) }}
                        </td>
                        <td
                            class="px-4 py-2.5 text-right whitespace-nowrap tabular-nums"
                        >
                            {{ formatTokensFull(batch.duration_ms) }} ms
                        </td>
                        <td
                            class="px-4 py-2.5 text-right whitespace-nowrap tabular-nums"
                            :title="`${formatTokensFull(batch.payload_bytes)} bytes`"
                        >
                            {{ formatBytes(batch.payload_bytes) }}
                        </td>
                        <td class="px-4 py-2.5 font-mono text-xs">
                            <span v-if="batch.error_code">{{
                                batch.error_code
                            }}</span>
                            <span v-else class="text-muted-foreground">—</span>
                        </td>
                    </tr>
                    <tr
                        v-if="batch.rejections.length > 0"
                        v-show="isExpanded(batch.id)"
                        :id="`${id}-rejections-${batch.id}`"
                        class="border-b bg-muted/20 last:border-b-0"
                    >
                        <td :colspan="11" class="px-4 py-3 pl-12">
                            <p
                                class="mb-2 text-xs font-medium text-muted-foreground"
                            >
                                Rejected records
                            </p>
                            <SyncBatchRejections
                                :rejections="batch.rejections"
                            />
                        </td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>
</template>
