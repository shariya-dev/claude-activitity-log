import type { KvSchema, StateStore } from '../core/state/stateStore.js';
import { DEVICE_TOKEN_KEY, type AgentContainer } from './container.js';

/**
 * Removes kv values. The StateStore has no delete; a stored JSON `null` reads back as null,
 * which every reader already treats as "absent".
 */
export function clearKv(state: StateStore, keys: (keyof KvSchema)[]): void {
  const cleared: Partial<KvSchema> = {};
  for (const key of keys) (cleared as Record<string, unknown>)[key] = null;
  state.commitBatch([], cleared);
}

/** Paired = a device token in the credential store, a device_uid, and no pending re-pair. */
export async function isPaired(c: AgentContainer): Promise<boolean> {
  const uid = c.state.get('device_uid');
  if (uid === null || uid === '') return false;
  if (c.state.get('agent_state') === 'needs_repair') return false;
  return (await c.adapter.credentials.get(DEVICE_TOKEN_KEY)) !== null;
}

/** Local sync position: dropped when the device identity changes. Server history is untouched. */
export function resetSyncPosition(state: StateStore): void {
  state.resetCheckpoints();
  clearKv(state, ['server_cursor', 'initial_sync_done', 'sync_sequence']);
}

/**
 * `repair`: forgets the device token, device_uid and checkpoints, and marks the agent
 * `needs_repair` so a running agent stops syncing and shows the pairing page. Re-sync after
 * re-pairing is idempotent on the server.
 */
export async function clearPairing(c: AgentContainer): Promise<void> {
  await c.adapter.credentials.delete(DEVICE_TOKEN_KEY);
  resetSyncPosition(c.state);
  clearKv(c.state, ['device_uid']);
  c.state.set('agent_state', 'needs_repair');
  c.logger.info('pairing_cleared');
}
