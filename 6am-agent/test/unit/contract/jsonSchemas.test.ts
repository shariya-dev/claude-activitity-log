import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { CONTRACT_SCHEMAS, SCHEMAS_DIR } from './helpers.js';

const ID_BASE = 'https://monitor.6amtech.com/contracts/sync-api-v1';
const UPDATE = process.env.UPDATE_CONTRACT_SCHEMAS === '1';

const TITLES: Record<string, string> = {
  'register.request': 'POST /register request',
  'register.response': 'POST /register 201 response',
  'settings.response': 'GET /settings 200 response (TrackingSettings)',
  'heartbeat.request': 'POST /heartbeat request',
  'heartbeat.response': 'POST /heartbeat 200 response',
  'sync.request': 'POST /sync request',
  'sync.response': 'POST /sync 200 response',
  'sync-status.response': 'GET /sync/status 200 response',
  error: 'Error envelope (all non-2xx JSON responses)',
};

function render(name: string): string {
  const { $schema, ...rest } = z.toJSONSchema(CONTRACT_SCHEMAS[name]!, {
    io: 'input',
    target: 'draft-2020-12',
  });
  const doc = { $schema, $id: `${ID_BASE}/${name}.json`, title: TITLES[name], ...rest };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

describe('generated JSON Schemas', () => {
  it('has a title for every contract', () => {
    expect(Object.keys(TITLES).sort()).toEqual(Object.keys(CONTRACT_SCHEMAS).sort());
  });

  it.each(Object.keys(CONTRACT_SCHEMAS))('%s.json matches the zod schema', (name) => {
    const file = path.join(SCHEMAS_DIR, `${name}.json`);
    const expected = render(name);
    if (UPDATE) {
      mkdirSync(SCHEMAS_DIR, { recursive: true });
      writeFileSync(file, expected);
    }
    expect(existsSync(file), `${file} missing; run with UPDATE_CONTRACT_SCHEMAS=1`).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(expected));
  });

  it.each(Object.keys(CONTRACT_SCHEMAS))('%s.json lets receivers ignore unknown fields', (name) => {
    expect(render(name)).not.toContain('"additionalProperties": false');
  });
});
