import type { PlatformAdapter } from '../types.js';

export function createAdapter(): PlatformAdapter {
  throw new Error('win32 adapter not implemented (H19/H20/H21)');
}
