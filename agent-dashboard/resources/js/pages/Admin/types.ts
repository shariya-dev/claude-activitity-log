import type { Paginated } from '@/types/monitor';

export type TrackingCategoryKey =
    | 'session'
    | 'usage'
    | 'project'
    | 'model'
    | 'device'
    | 'account'
    | 'prompt'
    | 'git'
    | 'network';

export type InitialSyncRange = '1d' | '7d' | '30d' | 'all';

export type TrackingSettingsData = {
    categories: Record<TrackingCategoryKey, boolean>;
    initial_sync_range: InitialSyncRange;
    sync_interval_seconds: number;
    heartbeat_interval_seconds: number;
    min_agent_version: string;
    retention_days: number | null;
    version: number;
    updated_at: string | null;
    updated_by: string | null;
};

export type TrackingCategory = {
    key: TrackingCategoryKey;
    label: string;
    description: string;
    default: boolean;
};

export type InitialSyncRangeOption = {
    value: InitialSyncRange;
    label: string;
};

export type TrackingLimits = {
    interval_min: number;
    interval_max: number;
    retention_min: number;
};

export type UserRole = 'admin' | 'viewer';

export type AdminUserRow = {
    id: number;
    name: string;
    email: string;
    role: UserRole;
    can_view_prompts: boolean;
    is_active: boolean;
    created_at: string;
    is_self: boolean;
};

export type RoleOption = {
    value: UserRole;
    label: string;
};

export type AuditLogActor = {
    id: number;
    name: string;
};

export type AuditLogSubject = {
    type: string;
    id: number | null;
    label: string;
    url: string | null;
};

export type AuditLogRow = {
    id: number;
    created_at: string;
    actor: AuditLogActor | null;
    action: string;
    subject: AuditLogSubject | null;
    ip_address: string | null;
    metadata: Record<string, unknown> | null;
};

export type AuditLogPaginator = Paginated<AuditLogRow>;

export type AuditLogFilters = {
    action: string | null;
    actor: number | null;
    subject_type: string | null;
    from: string | null;
    to: string | null;
};

export type AuditLogOptions = {
    actions: string[];
    actors: AuditLogActor[];
    subjectTypes: { value: string; label: string }[];
};
