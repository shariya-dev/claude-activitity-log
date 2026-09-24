import type {
    BreakdownRow,
    ConnectionState,
    DeviceStatus,
    FilterOption,
} from '@/types/monitor';

export type DeveloperStatus = 'active' | 'inactive';

export type DeveloperRow = {
    id: number;
    name: string;
    email: string;
    team: string | null;
    status: DeveloperStatus;
    devices_count: number;
    claude_accounts_count: number;
    sessions_count: number;
    actual_consumed_tokens: number;
    total_token_activity: number;
    last_activity_at: string | null;
    last_sync_at: string | null;
};

export type DeveloperIndexFilters = {
    search: string | null;
    status: DeveloperStatus | null;
};

export type DeveloperDetail = {
    id: number;
    name: string;
    email: string;
    team: string | null;
    status: DeveloperStatus;
    created_at: string | null;
    last_activity_at: string | null;
    last_sync_at: string | null;
};

export type DeveloperFilterOptions = {
    device: FilterOption[];
    account: FilterOption[];
    project: FilterOption[];
    model: FilterOption[];
};

export type DeveloperBreakdowns = {
    device: BreakdownRow[];
    account: BreakdownRow[];
    project: BreakdownRow[];
    model: BreakdownRow[];
};

export type DeveloperDevice = {
    id: number;
    device_uid: string;
    hostname: string | null;
    platform: string;
    platform_version: string | null;
    architecture: string | null;
    agent_version: string | null;
    claude_code_version: string | null;
    status: DeviceStatus;
    connection: ConnectionState;
    last_seen_at: string | null;
    last_sync_at: string | null;
};

export type DeveloperAccount = {
    id: number;
    email: string | null;
    display_name: string | null;
    status: string;
    first_seen_at: string | null;
    last_seen_at: string | null;
    devices: { device_uid: string; label: string }[];
};
