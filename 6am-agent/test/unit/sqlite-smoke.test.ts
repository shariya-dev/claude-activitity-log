import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('node:sqlite', () => {
  it('opens an in-memory database, writes, and reads back', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('device_uid', 'abc');

    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('device_uid');

    expect(row).toEqual({ value: 'abc' });
    db.close();
  });
});
