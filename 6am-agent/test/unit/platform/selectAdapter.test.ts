import { describe, expect, it } from 'vitest';
import { selectAdapter } from '../../../src/platform/index.js';

describe('selectAdapter', () => {
  it.each([
    ['darwin', 'macos'],
    ['win32', 'windows'],
    ['linux', 'linux'],
  ] as const)('dispatches %s to its OS adapter', (platform, id) => {
    expect(selectAdapter(platform).id).toBe(id);
  });

  it('rejects unsupported platforms', () => {
    expect(() => selectAdapter('freebsd')).toThrow('Unsupported platform: freebsd');
  });
});
