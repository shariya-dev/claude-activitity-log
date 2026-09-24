<script setup lang="ts">
import { router } from '@inertiajs/vue3';
import type { LucideIcon } from '@lucide/vue';
import { Ban, KeyRound, Power, RefreshCw } from '@lucide/vue';
import { computed, ref } from 'vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
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
import type { DeviceDetail } from '@/pages/Devices/types';
import { disable, enable, repairCode, requestSync } from '@/routes/devices';

type ActionKey = 'disable' | 'enable' | 'repair' | 'sync';

type ActionDefinition = {
    key: ActionKey;
    label: string;
    icon: LucideIcon;
    variant: 'default' | 'destructive' | 'outline';
    title: string;
    description: string;
    details: string[];
    confirmLabel: string;
    url: () => string;
};

const props = defineProps<{
    device: DeviceDetail;
}>();

const deviceName = computed(
    () => props.device.hostname ?? props.device.device_uid,
);

const definitions = computed<Record<ActionKey, ActionDefinition>>(() => ({
    disable: {
        key: 'disable',
        label: 'Disable',
        icon: Ban,
        variant: 'destructive',
        title: `Disable ${deviceName.value}?`,
        description: 'The agent on this machine will stop syncing immediately.',
        details: [
            'All agent tokens for this device are revoked, so it can no longer send data.',
            'All history is kept: sessions, token activity and sync batches stay visible in the dashboard.',
            'You can enable the device again later; the agent will then need a new pairing code.',
        ],
        confirmLabel: 'Disable device',
        url: () => disable(props.device.device_uid).url,
    },
    enable: {
        key: 'enable',
        label: 'Enable',
        icon: Power,
        variant: 'default',
        title: `Enable ${deviceName.value}?`,
        description: 'The device will be marked as active again.',
        details: [
            'Its previous agent tokens stay revoked, so the agent cannot sync yet.',
            'Generate a re-pair code and enter it in the agent on this machine before it can sync again.',
        ],
        confirmLabel: 'Enable device',
        url: () => enable(props.device.device_uid).url,
    },
    repair: {
        key: 'repair',
        label: 'Generate re-pair code',
        icon: KeyRound,
        variant: 'outline',
        title: 'Generate a re-pair code?',
        description: `Creates a one-time pairing code for ${props.device.developer.name}.`,
        details: [
            'The code expires in 15 minutes and can be used only once.',
            'Entered in the agent on this machine, it re-pairs this same device and its history stays attached. Entered on another machine, it pairs a new device.',
            ...(props.device.status === 'active'
                ? []
                : [
                      'Redeeming it on this machine re-activates this device, so it starts syncing again.',
                  ]),
            'The code is shown only once, right after it is generated.',
        ],
        confirmLabel: 'Generate code',
        url: () => repairCode(props.device.device_uid).url,
    },
    sync: {
        key: 'sync',
        label: 'Sync Now',
        icon: RefreshCw,
        variant: 'outline',
        title: 'Request a sync now?',
        description:
            'This is a diagnostic action. Normal syncing does not need it.',
        details: [
            'The agent picks up the request on its next heartbeat, usually within about 5 minutes.',
            'Use it to confirm the agent is reachable or to pull fresh data while troubleshooting.',
        ],
        confirmLabel: 'Request sync',
        url: () => requestSync(props.device.device_uid).url,
    },
}));

const available = computed<ActionDefinition[]>(() => {
    const keys: ActionKey[] = [];

    if (props.device.status === 'active') {
        keys.push('sync');
    }

    keys.push('repair');

    if (props.device.status === 'active') {
        keys.push('disable');
    }

    if (props.device.status === 'disabled') {
        keys.push('enable');
    }

    return keys.map((key) => definitions.value[key]);
});

const pending = ref<ActionKey | null>(null);
const processing = ref(false);

const current = computed<ActionDefinition | null>(() =>
    pending.value ? definitions.value[pending.value] : null,
);

const dialogOpen = computed<boolean>({
    get: () => pending.value !== null,
    set: (value) => {
        if (!value && !processing.value) {
            pending.value = null;
        }
    },
});

function open(key: ActionKey): void {
    pending.value = key;
}

function confirm(): void {
    const action = current.value;

    if (!action || processing.value) {
        return;
    }

    router.post(
        action.url(),
        {},
        {
            preserveScroll: true,
            onStart: () => {
                processing.value = true;
            },
            onSuccess: () => {
                pending.value = null;
            },
            onFinish: () => {
                processing.value = false;
            },
        },
    );
}
</script>

<template>
    <div class="flex flex-col items-start gap-2 sm:items-end">
        <div
            role="group"
            aria-label="Device actions"
            class="flex flex-wrap gap-2"
        >
            <Button
                v-for="action in available"
                :key="action.key"
                type="button"
                size="sm"
                :variant="action.variant"
                :disabled="processing"
                @click="open(action.key)"
            >
                <component :is="action.icon" aria-hidden="true" />
                {{ action.label }}
            </Button>
        </div>
        <p
            v-if="device.status === 'active' && device.sync_requested_at"
            class="text-xs text-muted-foreground"
        >
            Sync requested
            <RelativeTime :value="device.sync_requested_at" />
        </p>

        <Dialog v-model:open="dialogOpen">
            <DialogContent v-if="current" :show-close-button="!processing">
                <DialogHeader>
                    <DialogTitle>{{ current.title }}</DialogTitle>
                    <DialogDescription>
                        {{ current.description }}
                    </DialogDescription>
                </DialogHeader>
                <ul
                    class="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground"
                >
                    <li v-for="detail in current.details" :key="detail">
                        {{ detail }}
                    </li>
                </ul>
                <DialogFooter class="gap-2">
                    <DialogClose as-child>
                        <Button
                            type="button"
                            variant="outline"
                            :disabled="processing"
                        >
                            Cancel
                        </Button>
                    </DialogClose>
                    <Button
                        type="button"
                        :variant="
                            current.variant === 'destructive'
                                ? 'destructive'
                                : 'default'
                        "
                        :disabled="processing"
                        @click="confirm"
                    >
                        {{ processing ? 'Working…' : current.confirmLabel }}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </div>
</template>
