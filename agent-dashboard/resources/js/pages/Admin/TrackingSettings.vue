<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3';
import { ShieldAlert } from '@lucide/vue';
import { computed, ref, useId } from 'vue';
import InputError from '@/components/InputError.vue';
import RelativeTime from '@/components/monitor/RelativeTime.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import NativeSelect from '@/pages/Admin/partials/NativeSelect.vue';
import ToggleSwitch from '@/pages/Admin/partials/ToggleSwitch.vue';
import type {
    InitialSyncRange,
    InitialSyncRangeOption,
    TrackingCategory,
    TrackingCategoryKey,
    TrackingLimits,
    TrackingSettingsData,
} from '@/pages/Admin/types';
import { edit, update } from '@/routes/tracking-settings';

defineOptions({
    layout: {
        breadcrumbs: [{ title: 'Tracking settings', href: edit() }],
    },
});

const props = defineProps<{
    settings: TrackingSettingsData;
    categories: TrackingCategory[];
    initialSyncRanges: InitialSyncRangeOption[];
    limits: TrackingLimits;
}>();

const id = useId();

const PROMPT_WARNING =
    "Raw prompt text will be collected from all developers' machines and stored on this server. Only users with prompt permission can read it, and every view is audited.";

type TrackingForm = Record<TrackingCategoryKey, boolean> & {
    initial_sync_range: InitialSyncRange;
    sync_interval_seconds: number | string;
    heartbeat_interval_seconds: number | string;
    min_agent_version: string;
    retention_days: number | string;
    prompt_confirmed: boolean;
};

function formData(settings: TrackingSettingsData): TrackingForm {
    return {
        ...settings.categories,
        initial_sync_range: settings.initial_sync_range,
        sync_interval_seconds: settings.sync_interval_seconds,
        heartbeat_interval_seconds: settings.heartbeat_interval_seconds,
        min_agent_version: settings.min_agent_version,
        retention_days: settings.retention_days ?? '',
        prompt_confirmed: false,
    };
}

const form = useForm<TrackingForm>(formData(props.settings));

const confirmingPrompt = ref(false);

const rangeOptions = computed(() =>
    props.initialSyncRanges.map((range) => ({
        value: range.value,
        label: range.label,
    })),
);

function setCategory(key: TrackingCategoryKey, value: boolean): void {
    if (key !== 'prompt') {
        form[key] = value;

        return;
    }

    if (!value) {
        form.prompt = false;
        form.prompt_confirmed = false;

        return;
    }

    if (props.settings.categories.prompt) {
        form.prompt = true;

        return;
    }

    confirmingPrompt.value = true;
}

function confirmPrompt(): void {
    form.prompt = true;
    form.prompt_confirmed = true;
    form.clearErrors('prompt', 'prompt_confirmed');
    confirmingPrompt.value = false;
}

function cancelPrompt(): void {
    form.prompt = false;
    form.prompt_confirmed = false;
    confirmingPrompt.value = false;
}

function onDialogOpenChange(open: boolean): void {
    if (!open) {
        cancelPrompt();
    }
}

function categoryError(key: TrackingCategoryKey): string | undefined {
    if (key === 'prompt') {
        return form.errors.prompt ?? form.errors.prompt_confirmed;
    }

    return form.errors[key];
}

function toNumberOrBlank(value: number | string): number | string {
    if (typeof value === 'number') {
        return value;
    }

    const trimmed = value.trim();

    return trimmed === '' ? '' : Number(trimmed);
}

function submit(): void {
    form.transform((data) => {
        const retention =
            typeof data.retention_days === 'string'
                ? data.retention_days.trim()
                : data.retention_days;

        return {
            ...data,
            sync_interval_seconds: toNumberOrBlank(data.sync_interval_seconds),
            heartbeat_interval_seconds: toNumberOrBlank(
                data.heartbeat_interval_seconds,
            ),
            min_agent_version: data.min_agent_version.trim(),
            retention_days: retention === '' ? null : Number(retention),
        };
    }).put(update.url(), {
        preserveScroll: true,
        onSuccess: () => {
            form.defaults(formData(props.settings));
            form.reset();
        },
    });
}
</script>

<template>
    <Head title="Tracking settings" />

    <div class="flex flex-1 flex-col gap-6 p-4">
        <div class="flex flex-col gap-1">
            <h1 class="text-xl font-semibold tracking-tight">
                Tracking settings
            </h1>
            <p class="text-sm text-muted-foreground">
                Configuration version
                <span class="font-medium text-foreground">{{
                    settings.version
                }}</span>
                · Last updated
                <RelativeTime :value="settings.updated_at" />
                <template v-if="settings.updated_by">
                    by
                    <span class="font-medium text-foreground">{{
                        settings.updated_by
                    }}</span>
                </template>
            </p>
        </div>

        <form
            class="flex flex-col gap-6"
            novalidate
            aria-label="Tracking settings"
            @submit.prevent="submit"
        >
            <Card>
                <CardHeader>
                    <CardTitle>Tracked categories</CardTitle>
                    <CardDescription>
                        Choose which data the agents collect from developer
                        machines. Changes apply to every device on its next
                        sync.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ul class="divide-y rounded-lg border">
                        <li
                            v-for="category in categories"
                            :key="category.key"
                            class="flex items-start justify-between gap-4 p-4"
                        >
                            <div class="flex min-w-0 flex-col gap-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span
                                        :id="`${id}-${category.key}-label`"
                                        class="text-sm font-medium"
                                    >
                                        {{ category.label }}
                                    </span>
                                    <Badge variant="outline">
                                        Default:
                                        {{ category.default ? 'On' : 'Off' }}
                                    </Badge>
                                </div>
                                <p
                                    :id="`${id}-${category.key}-description`"
                                    class="text-sm text-muted-foreground"
                                >
                                    {{ category.description }}
                                </p>
                                <InputError
                                    :message="categoryError(category.key)"
                                />
                            </div>
                            <ToggleSwitch
                                :id="`${id}-${category.key}`"
                                :model-value="form[category.key]"
                                :aria-labelledby="`${id}-${category.key}-label`"
                                :aria-describedby="`${id}-${category.key}-description`"
                                class="mt-0.5"
                                @update:model-value="
                                    setCategory(category.key, $event)
                                "
                            />
                        </li>
                    </ul>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Sync behaviour</CardTitle>
                    <CardDescription>
                        How much history a newly paired agent uploads and how
                        often agents contact the server.
                    </CardDescription>
                </CardHeader>
                <CardContent class="grid gap-6 sm:grid-cols-2">
                    <div class="grid gap-2">
                        <Label :for="`${id}-initial-sync-range`">
                            Initial sync range
                        </Label>
                        <NativeSelect
                            :id="`${id}-initial-sync-range`"
                            v-model="form.initial_sync_range"
                            name="initial_sync_range"
                            :options="rangeOptions"
                            :invalid="Boolean(form.errors.initial_sync_range)"
                        />
                        <InputError :message="form.errors.initial_sync_range" />
                    </div>

                    <div class="grid gap-2">
                        <Label :for="`${id}-min-agent-version`">
                            Minimum agent version
                        </Label>
                        <Input
                            :id="`${id}-min-agent-version`"
                            v-model="form.min_agent_version"
                            name="min_agent_version"
                            inputmode="text"
                            autocomplete="off"
                            spellcheck="false"
                            placeholder="1.0.0"
                            :aria-invalid="
                                Boolean(form.errors.min_agent_version)
                            "
                            :aria-describedby="`${id}-min-agent-version-hint`"
                        />
                        <p
                            :id="`${id}-min-agent-version-hint`"
                            class="text-xs text-muted-foreground"
                        >
                            Semantic version, e.g. 1.2.0. Older agents are
                            flagged as outdated.
                        </p>
                        <InputError :message="form.errors.min_agent_version" />
                    </div>

                    <div class="grid gap-2">
                        <Label :for="`${id}-sync-interval`">
                            Sync interval (seconds)
                        </Label>
                        <Input
                            :id="`${id}-sync-interval`"
                            v-model="form.sync_interval_seconds"
                            name="sync_interval_seconds"
                            type="number"
                            inputmode="numeric"
                            :min="limits.interval_min"
                            :max="limits.interval_max"
                            step="1"
                            required
                            :aria-invalid="
                                Boolean(form.errors.sync_interval_seconds)
                            "
                            :aria-describedby="`${id}-interval-hint`"
                        />
                        <InputError
                            :message="form.errors.sync_interval_seconds"
                        />
                    </div>

                    <div class="grid gap-2">
                        <Label :for="`${id}-heartbeat-interval`">
                            Heartbeat interval (seconds)
                        </Label>
                        <Input
                            :id="`${id}-heartbeat-interval`"
                            v-model="form.heartbeat_interval_seconds"
                            name="heartbeat_interval_seconds"
                            type="number"
                            inputmode="numeric"
                            :min="limits.interval_min"
                            :max="limits.interval_max"
                            step="1"
                            required
                            :aria-invalid="
                                Boolean(form.errors.heartbeat_interval_seconds)
                            "
                            :aria-describedby="`${id}-interval-hint`"
                        />
                        <InputError
                            :message="form.errors.heartbeat_interval_seconds"
                        />
                    </div>

                    <p
                        :id="`${id}-interval-hint`"
                        class="text-xs text-muted-foreground sm:col-span-2"
                    >
                        Intervals must be between {{ limits.interval_min }} and
                        {{ limits.interval_max }} seconds.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Data retention</CardTitle>
                    <CardDescription>
                        Raw prompt messages older than this are permanently
                        deleted every night. Daily totals, sessions and devices
                        are always kept.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div class="grid max-w-xs gap-2">
                        <Label :for="`${id}-retention-days`">
                            Retention (days)
                        </Label>
                        <Input
                            :id="`${id}-retention-days`"
                            v-model="form.retention_days"
                            name="retention_days"
                            type="number"
                            inputmode="numeric"
                            :min="limits.retention_min"
                            step="1"
                            placeholder="Keep forever"
                            :aria-invalid="Boolean(form.errors.retention_days)"
                            :aria-describedby="`${id}-retention-hint`"
                        />
                        <p
                            :id="`${id}-retention-hint`"
                            class="text-xs text-muted-foreground"
                        >
                            Leave blank to keep history forever. Minimum
                            {{ limits.retention_min }} days. Deleted data cannot
                            be recovered.
                        </p>
                        <InputError :message="form.errors.retention_days" />
                    </div>
                </CardContent>
            </Card>

            <div class="flex flex-wrap items-center gap-4">
                <Button type="submit" :disabled="form.processing">
                    Save settings
                </Button>
                <Button
                    v-if="form.isDirty"
                    type="button"
                    variant="ghost"
                    :disabled="form.processing"
                    @click="form.reset()"
                >
                    Discard changes
                </Button>
                <p
                    v-if="form.recentlySuccessful"
                    role="status"
                    class="text-sm text-muted-foreground"
                >
                    Saved.
                </p>
            </div>
        </form>
    </div>

    <Dialog :open="confirmingPrompt" @update:open="onDialogOpenChange">
        <DialogContent>
            <DialogHeader class="space-y-3">
                <DialogTitle class="flex items-center gap-2">
                    <ShieldAlert
                        class="size-5 text-destructive"
                        aria-hidden="true"
                    />
                    Enable prompt tracking?
                </DialogTitle>
                <DialogDescription>{{ PROMPT_WARNING }}</DialogDescription>
            </DialogHeader>
            <DialogFooter class="gap-2">
                <Button type="button" variant="secondary" @click="cancelPrompt">
                    Cancel
                </Button>
                <Button
                    type="button"
                    variant="destructive"
                    @click="confirmPrompt"
                >
                    Enable prompt tracking
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
