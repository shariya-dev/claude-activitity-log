import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentState } from '../../../src/core/contract/index.js';
import { openStateStore, type StateStore } from '../../../src/core/state/stateStore.js';
import { applyApiErrorState, blocksSync } from '../../../src/core/sync/errorPolicy.js';
import { apiError, networkError, timeoutError } from '../../helpers/fakes/apiClient.js';
import { ApiError } from '../../../src/core/sync/apiClient.js';

const NOW = new Date('2026-09-24T10:00:00.000Z');

describe('errorPolicy.applyApiErrorState', () => {
  let state: StateStore;

  beforeEach(() => {
    state = openStateStore(':memory:');
    state.set('agent_state', 'ok');
  });

  afterEach(() => {
    state.close();
  });

  it.each([
    ['unauthenticated (401)', apiError('unauthenticated'), 'stopped', 'needs_repair'],
    ['device_disabled (403)', apiError('device_disabled'), 'stopped', 'device_disabled'],
    ['device_uninstalled (403)', apiError('device_uninstalled'), 'stopped', 'device_disabled'],
    ['agent_outdated (426)', apiError('agent_outdated'), 'stopped', 'update_required'],
  ] as const)('%s ⇒ %s with agent_state %s', (_name, err, outcome, agentState) => {
    expect(applyApiErrorState(state, err, NOW)).toBe(outcome);
    expect(state.get('agent_state')).toBe(agentState);
    expect(state.get('last_error_code')).toBe(err.code);
    expect(state.get('last_failure_at')).toBe(NOW.toISOString());
  });

  it.each([
    ['persistence_failed', apiError('persistence_failed')],
    ['invalid_payload', apiError('invalid_payload')],
    ['rate_limited', apiError('rate_limited', 5_000)],
    ['batch_in_progress', apiError('batch_in_progress')],
    ['batch_too_large', apiError('batch_too_large')],
    ['network', networkError()],
    ['timeout', timeoutError()],
    ['invalid_response', new ApiError({ code: 'invalid_response', status: 200, retryable: true })],
  ])('%s ⇒ failed, agent_state unchanged, failure recorded', (code, err) => {
    expect(applyApiErrorState(state, err, NOW)).toBe('failed');
    expect(state.get('agent_state')).toBe('ok');
    expect(state.get('last_error_code')).toBe(code);
    expect(state.get('last_failure_at')).toBe(NOW.toISOString());
  });

  it('a 403 without a device code (unexpected) is a plain failure', () => {
    const err = new ApiError({ code: 'invalid_response', status: 403, retryable: true });
    expect(applyApiErrorState(state, err, NOW)).toBe('failed');
  });
});

describe('errorPolicy.blocksSync', () => {
  it.each<[AgentState | null, boolean]>([
    [null, false],
    ['ok', false],
    ['syncing', false],
    ['backoff', false],
    ['error', false],
    ['claude_data_unavailable', false],
    ['needs_repair', true],
    ['device_disabled', true],
    ['update_required', true],
  ])('%s ⇒ %s', (s, blocked) => {
    expect(blocksSync(s)).toBe(blocked);
  });
});
