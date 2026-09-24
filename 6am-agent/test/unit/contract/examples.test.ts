import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  SyncRequestSchema,
  SyncResponseSchema,
} from '../../../src/core/contract/index.js';
import {
  CONTRACT_SCHEMAS,
  EXAMPLES_DIR,
  INVALID_DIR,
  contractNameFor,
  listJson,
  readJson,
} from './helpers.js';

const REQUIRED_VALID = [
  'register.request.json',
  'register.response.json',
  'settings.response.json',
  'heartbeat.request.json',
  'heartbeat.response.json',
  'sync.request.full.json',
  'sync.response.full.json',
  'sync.request.minimal.json',
  'sync.response.minimal.json',
  'sync.request.prompt-off.json',
  'sync.response.prompt-off.json',
  'sync.request.initial.json',
  'sync.response.initial.json',
  'sync.response.with-rejections.json',
  'sync-status.response.json',
  ...API_ERROR_CODES.map((code) => `error.${code}.json`),
];

const REQUIRED_INVALID = [
  'negative-token.json',
  'missing-batch-id.json',
  'bad-timestamp.json',
  'unknown-platform.json',
  'register-unknown-platform.json',
  'oversize-sessions.json',
  'oversize-usage.json',
];

const SYNC_PAIRS = ['full', 'minimal', 'prompt-off', 'initial'];

const validFiles = listJson(EXAMPLES_DIR);
const invalidFiles = listJson(INVALID_DIR);

interface InvalidExample {
  description: string;
  schema: string;
  expect: {
    zod_path: (string | number)[];
    backend: { status: number; code?: string; rejection_reason?: string };
  };
  payload: unknown;
}

function findKeys(value: unknown, keys: ReadonlySet<string>, at = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findKeys(v, keys, `${at}[${i}]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(keys.has(k) ? [`${at}.${k}`] : []),
      ...findKeys(v, keys, `${at}.${k}`),
    ]);
  }
  return [];
}

describe('contract examples', () => {
  it('ships every required valid example', () => {
    expect(validFiles).toEqual(expect.arrayContaining(REQUIRED_VALID));
  });

  it('ships every required invalid example', () => {
    expect(invalidFiles).toEqual(expect.arrayContaining(REQUIRED_INVALID));
  });

  describe.each(validFiles)('valid %s', (file) => {
    it('parses with its schema', () => {
      const schema = CONTRACT_SCHEMAS[contractNameFor(file)];
      expect(schema, `no schema for ${file}`).toBeDefined();
      const result = schema!.safeParse(readJson(path.join(EXAMPLES_DIR, file)));
      expect(result.error?.issues ?? []).toEqual([]);
    });
  });

  describe.each(invalidFiles)('invalid %s', (file) => {
    const example = readJson(path.join(INVALID_DIR, file)) as InvalidExample;

    it('declares a known schema and backend expectation', () => {
      expect(typeof example.description).toBe('string');
      expect(Object.keys(CONTRACT_SCHEMAS)).toContain(example.schema);
      expect([200, 413, 422]).toContain(example.expect.backend.status);
      if (example.expect.backend.status === 200) {
        expect(typeof example.expect.backend.rejection_reason).toBe('string');
      } else {
        expect(typeof example.expect.backend.code).toBe('string');
      }
    });

    it('fails its schema at the expected path', () => {
      const result = CONTRACT_SCHEMAS[example.schema]!.safeParse(example.payload);
      expect(result.success).toBe(false);
      expect(result.error?.issues.length).toBe(1);
      expect(result.error?.issues[0]?.path).toEqual(example.expect.zod_path);
    });
  });

  describe.each(validFiles.filter((f) => contractNameFor(f) === 'sync.request'))(
    'referential rule %s',
    (file) => {
      it('includes every referenced session, project and account in the batch', () => {
        const req = SyncRequestSchema.parse(readJson(path.join(EXAMPLES_DIR, file)));
        const sessionIds = new Set(req.sessions.map((s) => s.source_session_id));
        const projectKeys = new Set(req.projects.map((p) => p.project_key));
        const accountKeys = new Set(req.accounts.map((a) => a.account_key));
        for (const u of req.usage) expect(sessionIds).toContain(u.source_session_id);
        for (const m of req.messages) expect(sessionIds).toContain(m.source_session_id);
        for (const s of req.sessions) {
          if (s.project_key !== null) expect(projectKeys).toContain(s.project_key);
          if (s.account_key !== null) expect(accountKeys).toContain(s.account_key);
        }
      });
    },
  );

  describe.each(validFiles.filter((f) => contractNameFor(f) === 'sync.request'))(
    'timestamps %s',
    (file) => {
      it('orders first_seen_at <= last_seen_at for sessions and projects', () => {
        const req = SyncRequestSchema.parse(readJson(path.join(EXAMPLES_DIR, file)));
        for (const r of [...req.sessions, ...req.projects]) {
          expect(Date.parse(r.first_seen_at)).toBeLessThanOrEqual(Date.parse(r.last_seen_at));
        }
      });
    },
  );

  describe.each(SYNC_PAIRS)('sync pair %s', (name) => {
    it('response echoes the batch and counts every request record', () => {
      const req = SyncRequestSchema.parse(
        readJson(path.join(EXAMPLES_DIR, `sync.request.${name}.json`)),
      );
      const res = SyncResponseSchema.parse(
        readJson(path.join(EXAMPLES_DIR, `sync.response.${name}.json`)),
      );
      const total =
        req.accounts.length +
        req.projects.length +
        req.sessions.length +
        req.usage.length +
        req.messages.length;
      expect(res.batch_id).toBe(req.sync.batch_id);
      expect(res.sync.accepted + res.sync.rejected).toBe(total);
      expect(res.sync.accepted).toBe(res.sync.created + res.sync.updated);
      expect(res.settings_version).toBeGreaterThanOrEqual(req.sync.settings_version);
    });
  });

  it('keeps with-rejections counts consistent', () => {
    const res = SyncResponseSchema.parse(
      readJson(path.join(EXAMPLES_DIR, 'sync.response.with-rejections.json')),
    );
    expect(res.sync.accepted).toBe(res.sync.created + res.sync.updated);
    expect(res.sync.rejected).toBeGreaterThanOrEqual(res.rejected_records.length);
    expect(res.rejected_records.length).toBeGreaterThan(0);
  });

  it('never carries token-derived fields in any example', () => {
    const forbidden = new Set(['actual_consumed_tokens', 'total_token_activity']);
    const files = [
      ...validFiles.map((f) => path.join(EXAMPLES_DIR, f)),
      ...invalidFiles.map((f) => path.join(INVALID_DIR, f)),
    ];
    for (const file of files) expect(findKeys(readJson(file), forbidden), file).toEqual([]);
  });
});
