import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  ApiErrorSchema,
  HTTP_STATUS,
  RETRYABLE,
} from '../../../src/core/contract/index.js';
import { EXAMPLES_DIR, readJson } from './helpers.js';

const EXPECTED: Record<string, { status: number; retryable: boolean }> = {
  unauthenticated: { status: 401, retryable: false },
  device_disabled: { status: 403, retryable: false },
  device_uninstalled: { status: 403, retryable: false },
  batch_in_progress: { status: 409, retryable: true },
  batch_too_large: { status: 413, retryable: true },
  invalid_payload: { status: 422, retryable: false },
  invalid_pairing_code: { status: 422, retryable: false },
  agent_outdated: { status: 426, retryable: false },
  rate_limited: { status: 429, retryable: true },
  persistence_failed: { status: 500, retryable: true },
};

describe('api error codes', () => {
  it('lists exactly the v1 codes', () => {
    expect([...API_ERROR_CODES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('maps every code to its retryable flag and HTTP status', () => {
    expect(Object.keys(RETRYABLE).sort()).toEqual([...API_ERROR_CODES].sort());
    expect(Object.keys(HTTP_STATUS).sort()).toEqual([...API_ERROR_CODES].sort());
    for (const code of API_ERROR_CODES) {
      expect(RETRYABLE[code], code).toBe(EXPECTED[code]!.retryable);
      expect(HTTP_STATUS[code], code).toBe(EXPECTED[code]!.status);
    }
  });

  it.each([...API_ERROR_CODES])('error.%s.json matches the code table', (code) => {
    const body = ApiErrorSchema.parse(readJson(path.join(EXAMPLES_DIR, `error.${code}.json`)));
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(code);
    expect(body.error.retryable).toBe(RETRYABLE[code]);
    if (code === 'invalid_payload') {
      expect(Object.keys(body.error.errors ?? {}).length).toBeGreaterThan(0);
    } else {
      expect(body.error.errors).toBeUndefined();
    }
  });

  it('rejects unknown error codes (closed in v1)', () => {
    const result = ApiErrorSchema.safeParse({
      success: false,
      error: { code: 'teapot', message: 'x', retryable: false },
    });
    expect(result.success).toBe(false);
  });
});
