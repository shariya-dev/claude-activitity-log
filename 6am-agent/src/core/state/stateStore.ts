import { DatabaseSync } from 'node:sqlite';
import type { AgentState, FileCheckpoint, TrackingSettings } from '../contract/index.js';

/**
 * Local sync state (PRD §28). SQLite holds only `kv` and `file_checkpoints`: no activity records,
 * no prompts, no secrets (the device token lives in the CredentialStore).
 */
export type KvSchema = {
  device_uid: string;
  server_cursor: string;
  settings: TrackingSettings;
  settings_version: number;
  last_settings_sync_at: string;
  last_success_sync_at: string;
  last_failure_at: string;
  last_error_code: string;
  agent_state: AgentState;
  agent_version: string;
  initial_sync_done: boolean;
  sync_sequence: number;
};

export interface StateStore {
  get<K extends keyof KvSchema>(k: K): KvSchema[K] | null;
  set<K extends keyof KvSchema>(k: K, v: KvSchema[K]): void;
  checkpoints(): Map<string, FileCheckpoint>;
  /** Upserts the checkpoints and kv values in ONE transaction: all or nothing. */
  commitBatch(checkpoints: FileCheckpoint[], kv: Partial<KvSchema>): void;
  resetCheckpoints(): void;
  close(): void;
}

const SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS file_checkpoints (
      path TEXT PRIMARY KEY,
      file_identity TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms REAL NOT NULL,
      offset INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `,
};

interface CheckpointRow {
  path: string;
  file_identity: string;
  size: number;
  mtime_ms: number;
  offset: number;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  const current = row.user_version;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `state.db schema version ${current} is newer than this agent supports (${SCHEMA_VERSION})`,
    );
  }
  for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v] as string);
      db.exec(`PRAGMA user_version = ${v}`);
    });
  }
}

function transaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    // SQLite may already have rolled back (SQLITE_FULL, IOERR); keep the original error.
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}

export function openStateStore(dbPath: string): StateStore {
  const db = new DatabaseSync(dbPath);
  try {
    if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }

  const getKv = db.prepare('SELECT value FROM kv WHERE key = ?');
  const upsertKv = db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const allCheckpoints = db.prepare(
    'SELECT path, file_identity, size, mtime_ms, offset FROM file_checkpoints',
  );
  const upsertCheckpoint = db.prepare(
    `INSERT INTO file_checkpoints (path, file_identity, size, mtime_ms, offset, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET file_identity = excluded.file_identity, size = excluded.size,
       mtime_ms = excluded.mtime_ms, offset = excluded.offset, updated_at = excluded.updated_at`,
  );

  const writeKv = (key: string, value: unknown, now: string): void => {
    upsertKv.run(key, JSON.stringify(value), now);
  };

  return {
    get(k) {
      const row = getKv.get(k) as { value: string } | undefined;
      return row === undefined ? null : (JSON.parse(row.value) as KvSchema[typeof k]);
    },
    set(k, v) {
      writeKv(k, v, new Date().toISOString());
    },
    checkpoints() {
      const map = new Map<string, FileCheckpoint>();
      for (const r of allCheckpoints.all() as unknown as CheckpointRow[]) {
        map.set(r.path, {
          path: r.path,
          fileIdentity: r.file_identity,
          size: r.size,
          mtimeMs: r.mtime_ms,
          offset: r.offset,
        });
      }
      return map;
    },
    commitBatch(checkpoints, kv) {
      const now = new Date().toISOString();
      transaction(db, () => {
        for (const c of checkpoints) {
          upsertCheckpoint.run(c.path, c.fileIdentity, c.size, c.mtimeMs, c.offset, now);
        }
        for (const [key, value] of Object.entries(kv)) {
          if (value !== undefined) writeKv(key, value, now);
        }
      });
    },
    resetCheckpoints() {
      db.exec('DELETE FROM file_checkpoints');
    },
    close() {
      if (db.isOpen) db.close();
    },
  };
}
