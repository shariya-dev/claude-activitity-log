export type TokenTotals = {
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    actual_consumed_tokens: number;
    total_token_activity: number;
    message_count: number;
};

export type TrendPoint = TokenTotals & {
    period: string;
    label: string;
};

export type BreakdownRow = TokenTotals & {
    id: number | null;
    label: string;
};

export type SessionRow = {
    id: number;
    source_session_id: string;
    developer: string;
    project: string | null;
    model: string | null;
    device: string;
    started_at: string;
    last_activity_at: string;
    duration_seconds: number;
    actual_consumed_tokens: number;
    total_token_activity: number;
};

export type AgentHealthSummary = {
    online: number;
    stale: number;
    offline: number;
    disabled: number;
    uninstalled: number;
    outdated: number;
    sync_failed: number;
};

export type DeviceStatus = 'active' | 'disabled' | 'uninstalled';

export type ConnectionState = 'online' | 'stale' | 'offline';

export type SyncHealth = 'healthy' | 'offline' | 'sync_failed' | 'disabled';

export type SessionStatus = 'active' | 'idle' | 'ended';

export type ProblemAgent = {
    device_id: number;
    device_uid: string;
    hostname: string | null;
    developer: string;
    platform: string;
    agent_version: string | null;
    last_seen_at: string | null;
    last_sync_at: string | null;
    connection: ConnectionState;
    health: SyncHealth;
    outdated: boolean;
};

export type DatePreset =
    | 'today'
    | 'yesterday'
    | 'week'
    | 'month'
    | 'year'
    | 'custom';

export type DateRangeProps = {
    preset: DatePreset;
    from: string;
    to: string;
};

export type FilterOption = {
    id: number;
    label: string;
};

export type FilterDimension =
    | 'developer'
    | 'device'
    | 'account'
    | 'project'
    | 'model';

export type FilterOptions = Partial<Record<FilterDimension, FilterOption[]>>;

export type FilterValues = Partial<Record<FilterDimension, number | null>>;

export type PaginatorLink = {
    url: string | null;
    label: string;
    active: boolean;
    page?: number | null;
};

export type Paginated<T> = {
    data: T[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
    first_page_url: string;
    last_page_url: string;
    next_page_url: string | null;
    prev_page_url: string | null;
    path: string;
    links: PaginatorLink[];
};

export type MonitorRole = 'admin' | 'viewer';

export type MonitorUser = {
    id: number;
    name: string;
    email: string;
    role: MonitorRole;
    email_verified_at: string | null;
};

export type MonitorCan = {
    manageAgents: boolean;
    configureTracking: boolean;
    viewAuditLogs: boolean;
    manageUsers: boolean;
    viewPrompts: boolean;
};

export type MonitorFlash = {
    success: string | null;
    error: string | null;
    pairing_code: string | null;
};

export type MonitorSharedProps = {
    can: MonitorCan | null;
    monitor: {
        timezone: string;
    };
    flash: MonitorFlash;
};

export type SortDirection = 'asc' | 'desc';

export type DataTableColumn = {
    key: string;
    label: string;
    sortable?: boolean;
    align?: 'left' | 'right';
    class?: string;
};
