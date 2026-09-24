import type { AgentState } from '../contract/index.js';
import type { StateStore } from '../state/stateStore.js';
import type { ApiError } from './apiClient.js';

/** Agent states in which the agent must not call `/sync` (contract §9.2). */
const SYNC_BLOCKING_STATES: ReadonlySet<AgentState> = new Set<AgentState>([
  'needs_repair',
  'device_disabled',
  'update_required',
]);

export function blocksSync(state: AgentState | null): boolean {
  return state !== null && SYNC_BLOCKING_STATES.has(state);
}

/**
 * Records a failed API call and maps it to the contract §9.2 agent action. Returns `stopped` when
 * the agent must stop syncing until the state clears (401, 403, 426), `failed` otherwise (backoff).
 * Writes only kv values; checkpoints are never touched.
 */
export function applyApiErrorState(
  state: StateStore,
  err: ApiError,
  now: Date,
): 'stopped' | 'failed' {
  let agentState: AgentState | null = null;
  switch (err.code) {
    case 'unauthenticated':
      agentState = 'needs_repair';
      break;
    case 'device_disabled':
    case 'device_uninstalled':
      agentState = 'device_disabled';
      break;
    case 'agent_outdated':
      agentState = 'update_required';
      break;
    default:
      break;
  }
  state.commitBatch([], {
    last_failure_at: now.toISOString(),
    last_error_code: err.code,
    ...(agentState === null ? {} : { agent_state: agentState }),
  });
  return agentState === null ? 'failed' : 'stopped';
}
