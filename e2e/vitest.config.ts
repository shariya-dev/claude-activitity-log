import { defineConfig } from 'vitest/config';

// One backend, one proxy port and one global tracking-settings row are shared, so the scenario
// files run one after another. Each scenario still uses its own developer, device and temp dirs.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts', 'scenarios/**/*.test.ts'],
    globalSetup: ['./globalSetup.ts'],
    fileParallelism: false,
    sequence: { shuffle: false },
    testTimeout: 120_000,
    hookTimeout: 180_000,
    reporters: ['verbose'],
    // setup.ts reads the agent's state.db with node:sqlite, which is still flagged experimental.
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
