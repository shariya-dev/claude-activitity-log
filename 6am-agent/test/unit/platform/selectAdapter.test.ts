import { describe, expect, it } from 'vitest';
import { selectAdapter } from '../../../src/platform/index.js';

describe('selectAdapter', () => {
  it.each([
    ['darwin', 'darwin adapter not implemented (H19/H20/H21)'],
    ['win32', 'win32 adapter not implemented (H19/H20/H21)'],
    ['linux', 'linux adapter not implemented (H19/H20/H21)'],
  ] as const)('dispatches %s to its OS adapter', (platform, message) => {
    expect(() => selectAdapter(platform)).toThrow(message);
  });

  it('rejects unsupported platforms', () => {
    expect(() => selectAdapter('freebsd')).toThrow('Unsupported platform: freebsd');
  });
});
