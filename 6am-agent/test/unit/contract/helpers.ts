import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ZodType } from 'zod';
import {
  ApiErrorSchema,
  HeartbeatRequestSchema,
  HeartbeatResponseSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  SyncRequestSchema,
  SyncResponseSchema,
  SyncStatusResponseSchema,
  TrackingSettingsSchema,
} from '../../../src/core/contract/index.js';

export const CONTRACTS_DIR = path.resolve(import.meta.dirname, '../../../../docs/contracts');
export const EXAMPLES_DIR = path.join(CONTRACTS_DIR, 'examples');
export const INVALID_DIR = path.join(EXAMPLES_DIR, 'invalid');
export const SCHEMAS_DIR = path.join(CONTRACTS_DIR, 'schemas');

/** Contract name (schema file base name) → zod schema. */
export const CONTRACT_SCHEMAS: Record<string, ZodType> = {
  'register.request': RegisterRequestSchema,
  'register.response': RegisterResponseSchema,
  'settings.response': TrackingSettingsSchema,
  'heartbeat.request': HeartbeatRequestSchema,
  'heartbeat.response': HeartbeatResponseSchema,
  'sync.request': SyncRequestSchema,
  'sync.response': SyncResponseSchema,
  'sync-status.response': SyncStatusResponseSchema,
  error: ApiErrorSchema,
};

/** Maps an example file name (e.g. `sync.request.full.json`, `error.rate_limited.json`) to its contract name. */
export function contractNameFor(fileName: string): string {
  const base = fileName.replace(/\.json$/, '');
  if (base.startsWith('error.')) return 'error';
  return base.split('.').slice(0, 2).join('.');
}

export function listJson(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}
