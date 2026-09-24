import type { SyncBatchRow } from '@/pages/Devices/types';
import type {
    ConnectionState,
    DeviceStatus,
    SyncHealth,
} from '@/types/monitor';

export type SyncHealthCounts = {
    healthy: number;
    offline: number;
    sync_failed: number;
    disabled: number;
    uninstalled: number;
    outdated: number;
    total: number;
};

export type SyncDeviceRow = {
    device_uid: string;
    hostname: string | null;
    developer: string;
    platform: string;
    agent_version: string | null;
    outdated: boolean;
    status: DeviceStatus;
    connection: ConnectionState;
    health: SyncHealth;
    last_seen_at: string | null;
    last_success_at: string | null;
    last_failure_at: string | null;
    records_created_total: number;
    records_updated_total: number;
    records_rejected_total: number;
    last_error_code: string | null;
    last_error_message: string | null;
};

export type SyncFailureRow = SyncBatchRow & {
    device_uid: string;
    hostname: string | null;
    developer: string;
};
