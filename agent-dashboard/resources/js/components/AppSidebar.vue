<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';
import {
    Activity,
    BarChart3,
    FolderKanban,
    LayoutGrid,
    Monitor,
    RefreshCw,
    ScrollText,
    SlidersHorizontal,
    UserCog,
    Users,
} from '@lucide/vue';
import { computed } from 'vue';
import AppLogo from '@/components/AppLogo.vue';
import NavUser from '@/components/NavUser.vue';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useCurrentUrl } from '@/composables/useCurrentUrl';
import { dashboard } from '@/routes';
import { tokens as tokenAnalytics } from '@/routes/analytics';
import { index as auditLogsIndex } from '@/routes/audit-logs';
import { index as developersIndex } from '@/routes/developers';
import { index as devicesIndex } from '@/routes/devices';
import { index as projectsIndex } from '@/routes/projects';
import { index as sessionsIndex } from '@/routes/sessions';
import { index as syncIndex } from '@/routes/sync';
import { edit as trackingSettingsEdit } from '@/routes/tracking-settings';
import { index as usersIndex } from '@/routes/users';
import type { NavItem } from '@/types';
import type { MonitorCan } from '@/types/monitor';

type SidebarNavItem = NavItem & { exact?: boolean };
type AdminNavItem = SidebarNavItem & { ability: keyof MonitorCan };

const monitoringNavItems: SidebarNavItem[] = [
    { title: 'Overview', href: dashboard(), icon: LayoutGrid, exact: true },
    { title: 'Developers', href: developersIndex(), icon: Users },
    { title: 'Devices', href: devicesIndex(), icon: Monitor },
    { title: 'Projects', href: projectsIndex(), icon: FolderKanban },
    { title: 'Sessions', href: sessionsIndex(), icon: Activity },
    { title: 'Token Analytics', href: tokenAnalytics(), icon: BarChart3 },
    { title: 'Sync Monitor', href: syncIndex(), icon: RefreshCw },
];

const adminNavItems: AdminNavItem[] = [
    {
        title: 'Tracking Settings',
        href: trackingSettingsEdit(),
        icon: SlidersHorizontal,
        ability: 'configureTracking',
    },
    {
        title: 'Users',
        href: usersIndex(),
        icon: UserCog,
        ability: 'manageUsers',
    },
    {
        title: 'Audit Log',
        href: auditLogsIndex(),
        icon: ScrollText,
        ability: 'viewAuditLogs',
    },
];

const page = usePage<{ can: MonitorCan | null }>();
const { isCurrentUrl, isCurrentOrParentUrl } = useCurrentUrl();

const visibleAdminNavItems = computed(() =>
    adminNavItems.filter((item) => page.props.can?.[item.ability] === true),
);

function isActive(item: SidebarNavItem): boolean {
    return item.exact
        ? isCurrentUrl(item.href)
        : isCurrentOrParentUrl(item.href);
}
</script>

<template>
    <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton size="lg" as-child>
                        <Link :href="dashboard()">
                            <AppLogo />
                        </Link>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
            <SidebarGroup class="px-2 py-0">
                <SidebarGroupLabel>Monitoring</SidebarGroupLabel>
                <SidebarMenu>
                    <SidebarMenuItem
                        v-for="item in monitoringNavItems"
                        :key="item.title"
                    >
                        <SidebarMenuButton
                            as-child
                            :is-active="isActive(item)"
                            :tooltip="item.title"
                        >
                            <Link :href="item.href">
                                <component :is="item.icon" />
                                <span>{{ item.title }}</span>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup
                v-if="visibleAdminNavItems.length > 0"
                class="px-2 py-0"
            >
                <SidebarGroupLabel>Admin</SidebarGroupLabel>
                <SidebarMenu>
                    <SidebarMenuItem
                        v-for="item in visibleAdminNavItems"
                        :key="item.title"
                    >
                        <SidebarMenuButton
                            as-child
                            :is-active="isActive(item)"
                            :tooltip="item.title"
                        >
                            <Link :href="item.href">
                                <component :is="item.icon" />
                                <span>{{ item.title }}</span>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
            <NavUser />
        </SidebarFooter>
    </Sidebar>
    <slot />
</template>
