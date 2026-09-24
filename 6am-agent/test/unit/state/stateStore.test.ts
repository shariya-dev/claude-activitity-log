import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileCheckpoint } from '../../../src/core/contract/index.js';
import { openStateStore, type StateStore } from '../../../src/core/state/stateStore.js';
import { makeSettings } from '../../helpers/fakes/settings.js';

const cp = (p: string, offset: number): FileCheckpoint => ({
  path: p,
  fileIdentity: `id-${p}`,
  size: offset + 10,
  mtimeMs: 1_700_000_000_000,
  offset,
});

describe('stateStore', () => {
  let dir: string;
  let dbPath: string;
  let store: StateStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'state-'));
    dbPath = path.join(dir, 'state.db');
    store = openStateStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for unset keys and round-trips typed kv values', () => {
    expect(store.get('server_cursor')).toBeNull();
    const settings = makeSettings({ version: 4 });
    store.set('settings', settings);
    store.set('sync_sequence', 7);
    store.set('initial_sync_done', false);
    store.set('agent_state', 'backoff');
    expect(store.get('settings')).toEqual(settings);
    expect(store.get('sync_sequence')).toBe(7);
    expect(store.get('initial_sync_done')).toBe(false);
    expect(store.get('agent_state')).toBe('backoff');
  });

  it('persists across reopen', () => {
    store.commitBatch([cp('/a.jsonl', 100)], { server_cursor: 'c1' });
    store.close();
    store = openStateStore(dbPath);
    expect(store.get('server_cursor')).toBe('c1');
    expect(store.checkpoints().get('/a.jsonl')).toEqual(cp('/a.jsonl', 100));
  });

  it('commitBatch upserts checkpoints and kv together', () => {
    store.commitBatch([cp('/a.jsonl', 100), cp('/b.jsonl', 5)], {
      server_cursor: 'c1',
      sync_sequence: 1,
    });
    store.commitBatch([cp('/a.jsonl', 250)], { server_cursor: 'c2', sync_sequence: 2 });

    const map = store.checkpoints();
    expect(map.size).toBe(2);
    expect(map.get('/a.jsonl')?.offset).toBe(250);
    expect(map.get('/b.jsonl')?.offset).toBe(5);
    expect(store.get('server_cursor')).toBe('c2');
    expect(store.get('sync_sequence')).toBe(2);
  });

  it('commitBatch is atomic: a failure mid-transaction changes nothing', () => {
    store.commitBatch([cp('/a.jsonl', 100)], { server_cursor: 'c1', sync_sequence: 1 });

    // The checkpoint rows are written first; the unserializable kv value then throws.
    const poison = { server_cursor: 'c2', sync_sequence: 10n as unknown as number };
    expect(() => store.commitBatch([cp('/a.jsonl', 999), cp('/new.jsonl', 1)], poison)).toThrow();

    expect(store.checkpoints()).toEqual(new Map([['/a.jsonl', cp('/a.jsonl', 100)]]));
    expect(store.get('server_cursor')).toBe('c1');
    expect(store.get('sync_sequence')).toBe(1);

    // A bad checkpoint row after a good one rolls back as well.
    const bad = { ...cp('/b.jsonl', 1), offset: 'x' as unknown as number };
    expect(() => store.commitBatch([cp('/a.jsonl', 500), bad], { server_cursor: 'c3' })).toThrow();
    expect(store.checkpoints().get('/a.jsonl')?.offset).toBe(100);
    expect(store.get('server_cursor')).toBe('c1');
  });

  it('resetCheckpoints clears checkpoints and keeps kv', () => {
    store.commitBatch([cp('/a.jsonl', 100)], { server_cursor: 'c1' });
    store.resetCheckpoints();
    expect(store.checkpoints().size).toBe(0);
    expect(store.get('server_cursor')).toBe('c1');
  });

  it('schema migration is idempotent and sets user_version', () => {
    store.set('device_uid', 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W');
    store.close();
    store = openStateStore(dbPath);
    store.close();
    store = openStateStore(dbPath);
    expect(store.get('device_uid')).toBe('dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W');

    const db = new DatabaseSync(dbPath);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    db.close();
  });

  it('contains only the kv and file_checkpoints tables (no record tables)', () => {
    const db = new DatabaseSync(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    db.close();
    expect(tables).toEqual(['file_checkpoints', 'kv']);
  });

  it('refuses a database written by a newer schema version', () => {
    store.close();
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA user_version = 99');
    db.close();
    expect(() => openStateStore(dbPath)).toThrow(/newer/);
    store = openStateStore(':memory:');
  });

  it('works in memory', () => {
    const mem = openStateStore(':memory:');
    mem.set('agent_version', '1.0.0');
    expect(mem.get('agent_version')).toBe('1.0.0');
    mem.close();
  });
});
