import type { AgentInfo } from '../../../src/core/sync/types.js';

export const FAKE_DEVICE_ID = 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W';

export function makeAgentInfo(o: Partial<AgentInfo> = {}): AgentInfo {
  return {
    device_id: FAKE_DEVICE_ID,
    platform: 'macos',
    platform_version: '15.6.1',
    architecture: 'arm64',
    agent_version: '1.0.0',
    claude_code_version: '2.1.274',
    hostname: 'dev-laptop',
    ...o,
  };
}

/** Deterministic UUID v4 generator: 00000000-0000-4000-8000-000000000001, …0002, … */
export function sequentialUuid(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
  };
}
