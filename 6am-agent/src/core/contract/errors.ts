/**
 * Sync API v1 error codes (docs/contracts/sync-api-v1.md). Closed in v1: a new code means v2.
 */
export const API_ERROR_CODES = [
  'unauthenticated',
  'device_disabled',
  'device_uninstalled',
  'batch_in_progress',
  'batch_too_large',
  'invalid_payload',
  'agent_outdated',
  'rate_limited',
  'persistence_failed',
  'invalid_pairing_code',
] as const;

export type ApiErrorCode =
  | 'unauthenticated'
  | 'device_disabled'
  | 'device_uninstalled'
  | 'batch_in_progress'
  | 'batch_too_large'
  | 'invalid_payload'
  | 'agent_outdated'
  | 'rate_limited'
  | 'persistence_failed'
  | 'invalid_pairing_code';

/** Whether the agent may retry the same request (after backoff / splitting / Retry-After). */
export const RETRYABLE: Record<ApiErrorCode, boolean> = {
  unauthenticated: false,
  device_disabled: false,
  device_uninstalled: false,
  batch_in_progress: true,
  batch_too_large: true,
  invalid_payload: false,
  agent_outdated: false,
  rate_limited: true,
  persistence_failed: true,
  invalid_pairing_code: false,
};

/** HTTP status the backend returns with each code. */
export const HTTP_STATUS: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  device_disabled: 403,
  device_uninstalled: 403,
  batch_in_progress: 409,
  batch_too_large: 413,
  invalid_payload: 422,
  agent_outdated: 426,
  rate_limited: 429,
  persistence_failed: 500,
  invalid_pairing_code: 422,
};
