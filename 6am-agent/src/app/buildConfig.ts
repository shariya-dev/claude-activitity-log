import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** `<install_dir>/app/build-config.json`, written by `scripts/build.ts` next to `agent.cjs`. */
export interface BuildConfig {
  apiBaseUrl: string;
  channel: 'stable' | 'dev';
}

const BuildConfigSchema = z
  .object({
    apiBaseUrl: z.url(),
    channel: z.enum(['stable', 'dev']),
  })
  .refine((c) => c.channel !== 'stable' || new URL(c.apiBaseUrl).protocol === 'https:', {
    message: 'a stable build must use an https apiBaseUrl',
    path: ['apiBaseUrl'],
  });

export function parseBuildConfig(value: unknown): BuildConfig {
  const parsed = BuildConfigSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`invalid build config (${issues.join('; ')})`);
  }
  return parsed.data;
}

export function loadBuildConfig(file: string): BuildConfig {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`build config not found or unreadable: ${file}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`build config is not valid JSON: ${file}`);
  }
  return parseBuildConfig(json);
}

/** Effective settings after the dev-only environment overrides (H22). */
export interface EffectiveConfig {
  apiBaseUrl: string;
  /** `AGENT_DATA_DIR`: app data and logs. Null = the adapter's directories. */
  dataDir: string | null;
  /** `AGENT_CREDENTIAL_BACKEND=file` (implied by the fake adapter): a 0600 file store in the data dir. */
  fileCredentials: boolean;
  /** `AGENT_ADAPTER=fake`: the fake adapter (bundled only in dev builds). */
  fakeAdapter: boolean;
}

/** The overrides apply only when `channel` is `dev`; a stable build ignores all of them. */
export function applyDevOverrides(
  config: BuildConfig,
  env: NodeJS.ProcessEnv = process.env,
): EffectiveConfig {
  const base: EffectiveConfig = {
    apiBaseUrl: config.apiBaseUrl,
    dataDir: null,
    fileCredentials: false,
    fakeAdapter: false,
  };
  if (config.channel !== 'dev') return base;
  const set = (v: string | undefined): string | null => (v === undefined || v === '' ? null : v);
  return {
    apiBaseUrl: set(env.AGENT_API_BASE_URL) ?? base.apiBaseUrl,
    dataDir: set(env.AGENT_DATA_DIR),
    // The fake adapter has no OS store; its in-memory one would lose the pairing between runs.
    fileCredentials: env.AGENT_CREDENTIAL_BACKEND === 'file' || env.AGENT_ADAPTER === 'fake',
    fakeAdapter: env.AGENT_ADAPTER === 'fake',
  };
}
