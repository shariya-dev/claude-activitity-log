import { createAdapter as createDarwinAdapter } from './darwin/index.js';
import { createAdapter as createLinuxAdapter } from './linux/index.js';
import type { PlatformAdapter } from './types.js';
import { createAdapter as createWin32Adapter } from './win32/index.js';

const factories: Partial<Record<NodeJS.Platform, () => PlatformAdapter>> = {
  darwin: createDarwinAdapter,
  win32: createWin32Adapter,
  linux: createLinuxAdapter,
};

export function selectAdapter(platform: string = process.platform): PlatformAdapter {
  const create = factories[platform as NodeJS.Platform];

  if (create === undefined) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return create();
}
