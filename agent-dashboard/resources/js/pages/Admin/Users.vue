<script setup lang="ts">
import { Head, router, useForm, usePage } from '@inertiajs/vue3';
import { UserPlus, Users as UsersIcon } from '@lucide/vue';
import { computed, reactive, ref, useId } from 'vue';
import InputError from '@/components/InputError.vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import PasswordInput from '@/components/PasswordInput.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { formatDateTime } from '@/lib/format';
import NativeSelect from '@/pages/Admin/partials/NativeSelect.vue';
import ToggleSwitch from '@/pages/Admin/partials/ToggleSwitch.vue';
import type { AdminUserRow, RoleOption, UserRole } from '@/pages/Admin/types';
import { index, store, update } from '@/routes/users';

defineOptions({
    layout: {
        breadcrumbs: [{ title: 'Users', href: index() }],
    },
});

const props = defineProps<{
    users: AdminUserRow[];
    roles: RoleOption[];
}>();

const id = useId();

type RowField = 'role' | 'can_view_prompts' | 'is_active';
type RowChange =
    | { role: UserRole }
    | { can_view_prompts: boolean }
    | { is_active: boolean };

const roleOptions = computed(() =>
    props.roles.map((role) => ({ value: role.value, label: role.label })),
);

const page = usePage();

const timezone = computed<string>(() => {
    const monitor = page.props.monitor as { timezone?: unknown } | undefined;

    return typeof monitor?.timezone === 'string'
        ? monitor.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone;
});

const drafts = reactive<Record<number, Partial<AdminUserRow>>>({});
const rowErrors = reactive<Record<number, Partial<Record<RowField, string>>>>(
    {},
);
const pending = reactive<Record<number, boolean>>({});

function rowValue<K extends RowField>(
    user: AdminUserRow,
    field: K,
): AdminUserRow[K] {
    const draft = drafts[user.id]?.[field];

    return (draft ?? user[field]) as AdminUserRow[K];
}

function patchUser(user: AdminUserRow, change: RowChange): void {
    drafts[user.id] = { ...drafts[user.id], ...change };
    delete rowErrors[user.id];
    pending[user.id] = true;

    router.patch(update.url(user.id), change, {
        preserveScroll: true,
        preserveState: true,
        onError: (errors) => {
            rowErrors[user.id] = errors as Partial<Record<RowField, string>>;
        },
        onFinish: () => {
            delete drafts[user.id];
            delete pending[user.id];
        },
    });
}

function changeRole(user: AdminUserRow, value: string): void {
    const role = props.roles.find((option) => option.value === value);

    if (role && role.value !== user.role) {
        patchUser(user, { role: role.value });
    }
}

const deactivating = ref<AdminUserRow | null>(null);

function requestDeactivate(user: AdminUserRow): void {
    deactivating.value = user;
}

function confirmDeactivate(): void {
    if (deactivating.value) {
        patchUser(deactivating.value, { is_active: false });
    }

    deactivating.value = null;
}

function onDeactivateOpenChange(open: boolean): void {
    if (!open) {
        deactivating.value = null;
    }
}

function rowErrorMessages(user: AdminUserRow): string[] {
    const errors = rowErrors[user.id];

    if (!errors) {
        return [];
    }

    return Object.values(errors).filter(
        (message): message is string => typeof message === 'string',
    );
}

const creating = ref(false);

const createForm = useForm({
    name: '',
    email: '',
    role: 'viewer' as UserRole,
    can_view_prompts: false,
    password: '',
    password_confirmation: '',
});

function openCreate(): void {
    createForm.reset();
    createForm.clearErrors();
    creating.value = true;
}

function submitCreate(): void {
    createForm.post(store.url(), {
        preserveScroll: true,
        onSuccess: () => {
            createForm.reset();
            creating.value = false;
        },
        onError: () => {
            createForm.reset('password', 'password_confirmation');
        },
    });
}

function setCreateRole(value: string): void {
    const role = props.roles.find((option) => option.value === value);

    if (role) {
        createForm.role = role.value;
    }
}

function setCreateCanViewPrompts(value: boolean | 'indeterminate'): void {
    createForm.can_view_prompts = value === true;
}
</script>

<template>
    <Head title="Users" />

    <div class="flex flex-1 flex-col gap-6 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex flex-col gap-1">
                <h1 class="text-xl font-semibold tracking-tight">Users</h1>
                <p class="text-sm text-muted-foreground">
                    Dashboard accounts, their roles and whether they may read
                    collected prompt text.
                </p>
            </div>
            <Button type="button" @click="openCreate">
                <UserPlus class="size-4" aria-hidden="true" />
                Add user
            </Button>
        </div>

        <EmptyState
            v-if="users.length === 0"
            :icon="UsersIcon"
            title="No users yet"
        />

        <div v-else class="overflow-x-auto rounded-lg border">
            <table class="w-full text-sm">
                <caption class="sr-only">
                    Dashboard users
                </caption>
                <thead class="bg-muted/50 text-muted-foreground">
                    <tr class="border-b">
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                        >
                            User
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                        >
                            Role
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                        >
                            Prompt access
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                        >
                            Status
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                        >
                            Created
                        </th>
                        <th
                            scope="col"
                            class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                        >
                            Actions
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="user in users" :key="user.id">
                        <tr
                            :class="[
                                'hover:bg-muted/30',
                                rowErrorMessages(user).length > 0
                                    ? ''
                                    : 'border-b last:border-b-0',
                            ]"
                        >
                            <td class="px-4 py-2.5">
                                <div class="flex flex-col">
                                    <span
                                        :id="`${id}-user-${user.id}`"
                                        class="font-medium"
                                    >
                                        {{ user.name }}
                                        <span
                                            v-if="user.is_self"
                                            class="font-normal text-muted-foreground"
                                            >(you)</span
                                        >
                                    </span>
                                    <span class="text-muted-foreground">{{
                                        user.email
                                    }}</span>
                                </div>
                            </td>
                            <td class="px-4 py-2.5">
                                <Label
                                    :for="`${id}-role-${user.id}`"
                                    class="sr-only"
                                >
                                    Role for {{ user.name }}
                                </Label>
                                <NativeSelect
                                    :id="`${id}-role-${user.id}`"
                                    class="w-32"
                                    :model-value="rowValue(user, 'role')"
                                    :options="roleOptions"
                                    :disabled="
                                        user.is_self ||
                                        pending[user.id] === true
                                    "
                                    :invalid="Boolean(rowErrors[user.id]?.role)"
                                    @update:model-value="
                                        changeRole(user, $event)
                                    "
                                />
                            </td>
                            <td class="px-4 py-2.5">
                                <div class="flex items-center gap-2">
                                    <ToggleSwitch
                                        :model-value="
                                            rowValue(user, 'can_view_prompts')
                                        "
                                        :aria-label="`Allow ${user.name} to view prompts`"
                                        :disabled="pending[user.id] === true"
                                        @update:model-value="
                                            patchUser(user, {
                                                can_view_prompts: $event,
                                            })
                                        "
                                    />
                                    <span
                                        class="text-muted-foreground"
                                        aria-hidden="true"
                                    >
                                        {{
                                            rowValue(user, 'can_view_prompts')
                                                ? 'Allowed'
                                                : 'No access'
                                        }}
                                    </span>
                                </div>
                            </td>
                            <td class="px-4 py-2.5">
                                <Badge
                                    :variant="
                                        rowValue(user, 'is_active')
                                            ? 'secondary'
                                            : 'outline'
                                    "
                                >
                                    {{
                                        rowValue(user, 'is_active')
                                            ? 'Active'
                                            : 'Deactivated'
                                    }}
                                </Badge>
                            </td>
                            <td
                                class="px-4 py-2.5 whitespace-nowrap text-muted-foreground"
                            >
                                {{ formatDateTime(user.created_at, timezone) }}
                            </td>
                            <td class="px-4 py-2.5 text-right">
                                <Button
                                    v-if="rowValue(user, 'is_active')"
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    :disabled="
                                        user.is_self ||
                                        pending[user.id] === true
                                    "
                                    :aria-describedby="`${id}-user-${user.id}`"
                                    @click="requestDeactivate(user)"
                                >
                                    Deactivate
                                </Button>
                                <Button
                                    v-else
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    :disabled="
                                        user.is_self ||
                                        pending[user.id] === true
                                    "
                                    :aria-describedby="`${id}-user-${user.id}`"
                                    @click="
                                        patchUser(user, { is_active: true })
                                    "
                                >
                                    Reactivate
                                </Button>
                            </td>
                        </tr>
                        <tr
                            v-if="rowErrorMessages(user).length > 0"
                            class="border-b last:border-b-0"
                        >
                            <td colspan="6" class="px-4 pb-2.5">
                                <div role="alert">
                                    <InputError
                                        v-for="message in rowErrorMessages(
                                            user,
                                        )"
                                        :key="message"
                                        :message="message"
                                    />
                                </div>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>
    </div>

    <Dialog v-model:open="creating">
        <DialogContent class="max-h-[90vh] overflow-y-auto">
            <form
                class="flex flex-col gap-6"
                novalidate
                @submit.prevent="submitCreate"
            >
                <DialogHeader class="space-y-3">
                    <DialogTitle>Add user</DialogTitle>
                    <DialogDescription>
                        Create a dashboard account with a temporary password.
                        Share it with the person securely and ask them to change
                        it after signing in.
                    </DialogDescription>
                </DialogHeader>

                <div class="grid gap-2">
                    <Label :for="`${id}-create-name`">Name</Label>
                    <Input
                        :id="`${id}-create-name`"
                        v-model="createForm.name"
                        name="name"
                        autocomplete="off"
                        required
                        :aria-invalid="Boolean(createForm.errors.name)"
                    />
                    <InputError :message="createForm.errors.name" />
                </div>

                <div class="grid gap-2">
                    <Label :for="`${id}-create-email`">Email address</Label>
                    <Input
                        :id="`${id}-create-email`"
                        v-model="createForm.email"
                        name="email"
                        type="email"
                        autocomplete="off"
                        required
                        :aria-invalid="Boolean(createForm.errors.email)"
                    />
                    <InputError :message="createForm.errors.email" />
                </div>

                <div class="grid gap-2">
                    <Label :for="`${id}-create-role`">Role</Label>
                    <NativeSelect
                        :id="`${id}-create-role`"
                        name="role"
                        :model-value="createForm.role"
                        :options="roleOptions"
                        :invalid="Boolean(createForm.errors.role)"
                        @update:model-value="setCreateRole"
                    />
                    <InputError :message="createForm.errors.role" />
                </div>

                <div class="grid gap-2">
                    <Label
                        :for="`${id}-create-prompts`"
                        class="flex items-center gap-3"
                    >
                        <Checkbox
                            :id="`${id}-create-prompts`"
                            name="can_view_prompts"
                            :model-value="createForm.can_view_prompts"
                            @update:model-value="setCreateCanViewPrompts"
                        />
                        <span>Can view prompts</span>
                    </Label>
                    <InputError :message="createForm.errors.can_view_prompts" />
                </div>

                <div class="grid gap-2">
                    <Label :for="`${id}-create-password`">
                        Temporary password
                    </Label>
                    <PasswordInput
                        :id="`${id}-create-password`"
                        v-model="createForm.password"
                        name="password"
                        autocomplete="new-password"
                        required
                        :aria-invalid="Boolean(createForm.errors.password)"
                    />
                    <InputError :message="createForm.errors.password" />
                </div>

                <div class="grid gap-2">
                    <Label :for="`${id}-create-password-confirmation`">
                        Confirm temporary password
                    </Label>
                    <PasswordInput
                        :id="`${id}-create-password-confirmation`"
                        v-model="createForm.password_confirmation"
                        name="password_confirmation"
                        autocomplete="new-password"
                        required
                        :aria-invalid="
                            Boolean(createForm.errors.password_confirmation)
                        "
                    />
                    <InputError
                        :message="createForm.errors.password_confirmation"
                    />
                </div>

                <DialogFooter class="gap-2">
                    <Button
                        type="button"
                        variant="secondary"
                        :disabled="createForm.processing"
                        @click="creating = false"
                    >
                        Cancel
                    </Button>
                    <Button type="submit" :disabled="createForm.processing">
                        Create user
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>

    <Dialog :open="deactivating !== null" @update:open="onDeactivateOpenChange">
        <DialogContent>
            <DialogHeader class="space-y-3">
                <DialogTitle>
                    Deactivate {{ deactivating?.name ?? 'user' }}?
                </DialogTitle>
                <DialogDescription>
                    They will no longer be able to sign in to the dashboard.
                    Their account and audit history are kept, and you can
                    reactivate them at any time.
                </DialogDescription>
            </DialogHeader>
            <DialogFooter class="gap-2">
                <Button
                    type="button"
                    variant="secondary"
                    @click="deactivating = null"
                >
                    Cancel
                </Button>
                <Button
                    type="button"
                    variant="destructive"
                    @click="confirmDeactivate"
                >
                    Deactivate
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
