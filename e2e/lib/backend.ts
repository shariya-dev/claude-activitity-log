/**
 * Talks to the real Laravel backend the way an operator would: SQL reads through PHP's PDO (no
 * Laravel boot, so they are fast) and dashboard actions through `php artisan tinker --execute`,
 * which runs the real `App\Actions\*` classes. Nothing here re-implements app logic.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface BackendConfig {
  dashboardDir: string;
  /** Environment for every `php artisan` process (DB, APP_KEY…); never the developer's .env DB. */
  env: Record<string, string>;
}

const MARKER = '@@E2E_RESULT@@';

/** Runs a query against the e2e database and returns its rows. Params are bound, never interpolated. */
export async function sql<T = Record<string, unknown>>(
  cfg: BackendConfig,
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  const script = `
    $e = getenv();
    $pdo = new PDO(
      sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $e['DB_HOST'], $e['DB_PORT'], $e['DB_DATABASE']),
      $e['DB_USERNAME'], $e['DB_PASSWORD'],
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_STRINGIFY_FETCHES => false, PDO::ATTR_EMULATE_PREPARES => false]
    );
    $st = $pdo->prepare($e['E2E_SQL']);
    $st->execute(json_decode($e['E2E_PARAMS'], true));
    echo json_encode($st->columnCount() > 0 ? $st->fetchAll(PDO::FETCH_ASSOC) : []);
  `;
  const { stdout } = await run('php', ['-r', script], {
    env: { ...process.env, ...cfg.env, E2E_SQL: query, E2E_PARAMS: JSON.stringify(params) },
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout) as T[];
}

/** `SELECT COUNT(*)` of a table, optionally filtered. */
export async function dbCount(
  cfg: BackendConfig,
  table: string,
  where = '1 = 1',
  params: unknown[] = [],
): Promise<number> {
  if (!/^[a-z_]+$/.test(table)) throw new Error(`bad table name ${table}`);
  const rows = await sql<{ n: number }>(
    cfg,
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`,
    params,
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Runs PHP inside the booted app (`php artisan tinker --execute`). `input` is available to the
 * code as `$input` (decoded JSON); the code's `return`-like result is whatever it assigns to
 * `$result`, which comes back JSON-decoded.
 */
export async function tinker<T = unknown>(
  cfg: BackendConfig,
  code: string,
  input: unknown = null,
): Promise<T> {
  const wrapped = `$input = json_decode(getenv('E2E_INPUT'), true); $result = null; ${code}; echo PHP_EOL.'${MARKER}'.json_encode($result).PHP_EOL;`;
  const { stdout } = await run('php', ['artisan', 'tinker', '--execute', wrapped], {
    cwd: cfg.dashboardDir,
    env: { ...process.env, ...cfg.env, E2E_INPUT: JSON.stringify(input) },
    maxBuffer: 8 * 1024 * 1024,
  });
  const line = stdout.split('\n').find((l) => l.startsWith(MARKER));
  if (line === undefined) throw new Error(`tinker produced no result:\n${stdout}`);
  return JSON.parse(line.slice(MARKER.length)) as T;
}

/**
 * Empties the app cache, which holds the rate limiters. Every agent reaches the backend from
 * 127.0.0.1, so ten pairings across scenarios would otherwise hit `/register`'s 10/min/IP limit.
 */
export async function clearRateLimits(cfg: BackendConfig): Promise<void> {
  await run('php', ['artisan', 'cache:clear', '--quiet'], {
    cwd: cfg.dashboardDir,
    env: { ...process.env, ...cfg.env },
  });
}

export const ADMIN_EMAIL = 'admin@e2e.test';

/**
 * Tracking settings every scenario starts from. `initial_sync_range: all` keeps the fixtures'
 * fixed 2026-09 timestamps in range whatever the date the suite runs on; the long sync interval
 * means the daemon syncs only at start, on Sync Now and on the local sync-now signal, so each
 * scenario controls exactly when a sync happens. The agent is 0.1.0, hence min_agent_version.
 */
export const BASELINE_SETTINGS = {
  session: true,
  usage: true,
  project: true,
  model: true,
  device: true,
  account: true,
  prompt: false,
  git: false,
  network: false,
  initial_sync_range: 'all',
  sync_interval_seconds: 3600,
  heartbeat_interval_seconds: 60,
  min_agent_version: '0.1.0',
  retention_days: null,
} as const;

/** Applies settings through the admin action (`UpdateTrackingSettings`); returns the new version. */
export async function updateSettings(
  cfg: BackendConfig,
  overrides: Partial<Record<keyof typeof BASELINE_SETTINGS, unknown>> = {},
): Promise<number> {
  return tinker<number>(
    cfg,
    `$admin = App\\Models\\User::query()->where('email', '${ADMIN_EMAIL}')->firstOrFail();
     $result = app(App\\Actions\\Tracking\\UpdateTrackingSettings::class)->handle($input, $admin)->version;`,
    { ...BASELINE_SETTINGS, ...overrides },
  );
}

/** Creates an active developer and issues a pairing code for it (`IssuePairingCode`). */
export async function createDeveloperWithCode(
  cfg: BackendConfig,
  name: string,
): Promise<{ developerId: number; email: string; code: string }> {
  return tinker(
    cfg,
    `$admin = App\\Models\\User::query()->where('email', '${ADMIN_EMAIL}')->firstOrFail();
     $dev = App\\Models\\Developer::create(['name' => $input['name'], 'email' => $input['email'], 'status' => 'active']);
     $code = app(App\\Actions\\Agent\\IssuePairingCode::class)->handle($dev, $admin);
     $result = ['developerId' => $dev->id, 'email' => $dev->email, 'code' => $code];`,
    { name, email: `${name}@e2e.test` },
  );
}

/** Issues another pairing code (purpose `pair` or `repair`) for an existing developer. */
export async function issuePairingCode(
  cfg: BackendConfig,
  developerId: number,
  purpose: 'pair' | 'repair' = 'pair',
): Promise<string> {
  return tinker<string>(
    cfg,
    `$admin = App\\Models\\User::query()->where('email', '${ADMIN_EMAIL}')->firstOrFail();
     $dev = App\\Models\\Developer::findOrFail($input['id']);
     $result = app(App\\Actions\\Agent\\IssuePairingCode::class)->handle($dev, $admin, App\\Enums\\PairingPurpose::from($input['purpose']));`,
    { id: developerId, purpose },
  );
}

/** A dashboard device action, run as the admin: `DisableDevice`, `EnableDevice` or `RequestManualSync`. */
export async function deviceAction(
  cfg: BackendConfig,
  action: 'DisableDevice' | 'EnableDevice' | 'RequestManualSync',
  deviceId: number,
): Promise<void> {
  await tinker(
    cfg,
    `$admin = App\\Models\\User::query()->where('email', '${ADMIN_EMAIL}')->firstOrFail();
     app(App\\Actions\\Agent\\${action}::class)->handle(App\\Models\\Device::findOrFail($input['id']), $admin);
     $result = true;`,
    { id: deviceId },
  );
}
