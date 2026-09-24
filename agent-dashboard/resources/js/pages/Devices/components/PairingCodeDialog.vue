<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { Check, Copy } from '@lucide/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import type { MonitorFlash } from '@/types/monitor';

const page = usePage();

// Back/forward navigation restores old page props; a code is only ever shown once per app load.
const shownCodes = new Set<string>();

const flashedCode = computed<string | null>(() => {
    const flash = page.props.flash as Partial<MonitorFlash> | undefined;
    const code = flash?.pairing_code;

    return typeof code === 'string' && code !== '' ? code : null;
});

const code = ref<string | null>(null);
const open = ref(false);
const copied = ref(false);
const copyError = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

watch(
    flashedCode,
    (value) => {
        if (value === null || shownCodes.has(value)) {
            return;
        }

        shownCodes.add(value);
        code.value = value;
        copied.value = false;
        copyError.value = false;
        open.value = true;
    },
    { immediate: true },
);

async function copy(): Promise<void> {
    if (!code.value) {
        return;
    }

    try {
        await navigator.clipboard.writeText(code.value);
        copied.value = true;
        copyError.value = false;
    } catch {
        copied.value = false;
        copyError.value = true;
    }

    if (resetTimer !== undefined) {
        clearTimeout(resetTimer);
    }

    resetTimer = setTimeout(() => {
        copied.value = false;
    }, 2000);
}

onBeforeUnmount(() => {
    if (resetTimer !== undefined) {
        clearTimeout(resetTimer);
    }
});
</script>

<template>
    <Dialog v-model:open="open">
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Re-pair code</DialogTitle>
                <DialogDescription>
                    Shown once. It expires in 15 minutes. Enter it in the agent
                    on this machine to re-pair the device.
                </DialogDescription>
            </DialogHeader>
            <p
                class="rounded-lg border bg-muted/40 px-4 py-5 text-center font-mono text-3xl font-semibold tracking-[0.3em] break-all select-all"
            >
                {{ code }}
            </p>
            <p
                class="min-h-5 text-center text-sm"
                role="status"
                aria-live="polite"
            >
                <span
                    v-if="copied"
                    class="text-emerald-700 dark:text-emerald-300"
                    >Copied</span
                >
                <span v-else-if="copyError" class="text-destructive"
                    >Could not copy. Select the code and copy it manually.</span
                >
            </p>
            <DialogFooter class="gap-2">
                <DialogClose as-child>
                    <Button type="button" variant="outline">Done</Button>
                </DialogClose>
                <Button type="button" @click="copy">
                    <Check v-if="copied" aria-hidden="true" />
                    <Copy v-else aria-hidden="true" />
                    {{ copied ? 'Copied' : 'Copy code' }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
