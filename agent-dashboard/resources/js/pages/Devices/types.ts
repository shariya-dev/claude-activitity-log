import type {
    ConnectionState,
    DeviceStatus,
    FilterOption,
    SyncHealth,
} from '@/types/monitor';

export type SyncBatchStatus = 'processing' | 'succeeded' | 'failed';

export type DeviceRow = {
    device_uid: string;
    developer: { id: number; name: string };
    hostname: string | null;
    platform: string;
    platform_version: string | null;
    architecture: string | null;
    agent_version: string | null;
    outdated: boolean;
    claude_code_version: string | null;
    status: DeviceStatus;
    connection: ConnectionState;
    health: SyncHealth;
    last_seen_at: string | null;
    last_sync_at: string | null;
};

export type DeviceIndexFilters = {
    platform: string | null;
    status: DeviceStatus | null;
    connection: ConnectionState | null;
    outdated: boolean | null;
    developer: number | null;
};

export type DeviceIndexOptions = {
    platforms: string[];
    developers: FilterOption[];
};

export type DeviceDetail = Omit<DeviceRow, 'developer'> & {
    developer: { id: number; name: string; email: string; deleted: boolean };
    agent_state: string | null;
    first_seen_at: string | null;
    last_local_activity_at: string | null;
    sync_requested_at: string | null;
    disabled_at: string | null;
    uninstalled_at: string | null;
};

export type DeviceSyncState = {
    last_success_at: string | null;
    last_failure_at: string | null;
    last_error_code: string | null;
    last_error_message: string | null;
    consecutive_failures: number;
    records_created_total: number;
    records_updated_total: number;
    records_rejected_total: number;
};

export type DeviceAccount = {
    id: number;
    email: string | null;
    display_name: string | null;
    organization_name: string | null;
    first_seen_at: string | null;
    last_seen_at: string | null;
};

export type SyncRejection = {
    type: string;
    source_id: string | null;
    reason: string;
};

export type SyncBatchRow = {
    id: number;
    batch_uuid: string;
    status: SyncBatchStatus;
    is_initial: boolean;
    accepted: number;
    created: number;
    updated: number;
    rejected: number;
    rejections: SyncRejection[];
    error_code: string | null;
    payload_bytes: number;
    duration_ms: number;
    received_at: string;
    completed_at: string | null;
};
