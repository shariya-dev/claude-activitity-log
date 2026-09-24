/**
 * Once per run: a fresh `claude_monitor_e2e` database, an admin, baseline tracking settings, the
 * real backend on :8765 (`php artisan serve`) and the real agent built for the host target.
 * The proxy (:8766) is started per scenario file by `setup.ts`, which owns its captures.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TestProject } from 'vitest/node';
import { ADMIN_EMAIL, tinker, updateSettings, type BackendConfig } from './lib/backend.js';

const run = promisify(execFile);

export const BACKEND_PORT = 8765;
export const PROXY_PORT = 8766;
const DB_NAME = 'claude_monitor_e2e';

export interface E2eContext {
  repoRoot: string;
  runDir: string;
  backend: BackendConfig;
  backendUrl: string;
  proxyPort: number;
  agentNode: string;
  agentEntry: string;
  agentVersion: string;
  fixturesDir: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    e2e: E2eContext;
  }
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const dashboardDir = path.join(repoRoot, 'agent-dashboard');
const agentDir = path.join(repoRoot, '6am-agent');

function log(message: string): void {
  process.stdout.write(`[e2e setup] ${message}\n`);
}

async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () =>
      reject(new Error(`port ${port} is in use; stop whatever listens on it and re-run`)),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
}

async function sh(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return run(cmd, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
}

function hostTarget(): string {
  const os = ({ darwin: 'darwin', linux: 'linux' } as Record<string, string>)[process.platform];
  if (os === undefined)
    throw new Error(`the e2e harness runs on macOS or Linux, not ${process.platform}`);
  return `${os}-${process.arch}`;
}

async function waitForBackend(
  url: string,
  server: ChildProcess,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`php artisan serve exited:\n${output()}`);
    try {
      const res = await fetch(`${url}/up`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`backend did not come up on ${url}:\n${output()}`);
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const started = Date.now();
  await assertPortFree(BACKEND_PORT);
  await assertPortFree(PROXY_PORT);

  if (!existsSync(path.join(dashboardDir, 'vendor'))) {
    log('composer install (agent-dashboard/vendor is missing)');
    await sh('composer', ['install', '--no-interaction', '--quiet'], dashboardDir);
  }
  if (!existsSync(path.join(agentDir, 'node_modules'))) {
    log('npm ci (6am-agent/node_modules is missing)');
    await sh('npm', ['ci', '--silent'], agentDir);
  }

  const env: Record<string, string> = {
    APP_ENV: 'local',
    APP_DEBUG: 'false',
    APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
    APP_URL: `http://127.0.0.1:${BACKEND_PORT}`,
    DB_CONNECTION: 'mysql',
    DB_HOST: process.env.E2E_DB_HOST ?? '127.0.0.1',
    DB_PORT: process.env.E2E_DB_PORT ?? '8889',
    DB_DATABASE: DB_NAME,
    DB_USERNAME: process.env.E2E_DB_USERNAME ?? 'root',
    DB_PASSWORD: process.env.E2E_DB_PASSWORD ?? 'root',
    // Pinned so a developer's agent-dashboard/.env (Laravel still loads it) cannot redirect the
    // cache, logs or mail of the e2e run to shared stores.
    QUEUE_CONNECTION: 'sync',
    CACHE_STORE: 'database',
    SESSION_DRIVER: 'array',
    LOG_CHANNEL: 'stderr',
    LOG_LEVEL: 'warning',
    MAIL_MAILER: 'array',
    BROADCAST_CONNECTION: 'log',
    FILESYSTEM_DISK: 'local',
  };
  const backend: BackendConfig = { dashboardDir, env };

  log(`database ${DB_NAME} on ${env.DB_HOST}:${env.DB_PORT}`);
  await sh(
    'php',
    [
      '-r',
      `$e = getenv(); $pdo = new PDO(sprintf('mysql:host=%s;port=%s', $e['DB_HOST'], $e['DB_PORT']), $e['DB_USERNAME'], $e['DB_PASSWORD']);
       $pdo->exec('CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');`,
    ],
    dashboardDir,
    env,
  );
  // Every artisan call gets DB_DATABASE from the environment; confirm the app really uses it
  // before `migrate:fresh` drops anything.
  const dbInUse = await tinker<string>(backend, `$result = DB::connection()->getDatabaseName();`);
  if (dbInUse !== DB_NAME)
    throw new Error(`refusing to migrate: the app resolves database "${dbInUse}"`);
  await sh('php', ['artisan', 'migrate:fresh', '--force', '--no-interaction'], dashboardDir, env);
  await tinker(
    backend,
    `App\\Models\\User::create(['name' => 'E2E Admin', 'email' => '${ADMIN_EMAIL}', 'password' => bin2hex(random_bytes(16)), 'role' => 'admin', 'is_active' => true]); $result = true;`,
  );
  await updateSettings(backend);

  log(`php artisan serve on :${BACKEND_PORT}`);
  const server = spawn(
    'php',
    ['artisan', 'serve', '--host=127.0.0.1', `--port=${BACKEND_PORT}`, '--no-reload'],
    {
      cwd: dashboardDir,
      env: { ...process.env, ...env, PHP_CLI_SERVER_WORKERS: '4' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let serverOutput = '';
  server.stdout?.on(
    'data',
    (c: Buffer) => (serverOutput = (serverOutput + c.toString()).slice(-20_000)),
  );
  server.stderr?.on(
    'data',
    (c: Buffer) => (serverOutput = (serverOutput + c.toString()).slice(-20_000)),
  );
  const serverExited = new Promise<void>((resolve) => server.once('exit', () => resolve()));
  const stopServer = async (): Promise<void> => {
    if (server.pid === undefined || server.exitCode !== null) return;
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      return; // already gone
    }
    await Promise.race([serverExited, new Promise((r) => setTimeout(r, 10_000))]);
  };
  const backendUrl = `http://127.0.0.1:${BACKEND_PORT}`;
  let runDir: string | null = null;
  try {
    runDir = mkdtempSync(path.join(tmpdir(), '6am-e2e-'));
    await waitForBackend(backendUrl, server, () => serverOutput);

    const target = hostTarget();
    log(`building the agent (${target}, dev channel → proxy :${PROXY_PORT})`);
    const buildConfig = path.join(runDir, 'build-config.json');
    writeFileSync(
      buildConfig,
      JSON.stringify({ apiBaseUrl: `http://127.0.0.1:${PROXY_PORT}`, channel: 'dev' }),
    );
    await sh('npm', ['run', 'build', '--', '--target', target, '--config', buildConfig], agentDir);
    const agentNode = path.join(agentDir, 'dist', target, 'runtime', 'node');
    const agentEntry = path.join(agentDir, 'dist', target, 'app', 'agent.cjs');
    const { stdout: version } = await sh(agentNode, [agentEntry, '--version'], agentDir);
    const agentVersion = version.trim().replace(/^6am-agent /, '');
    log(`agent ${agentVersion} built; setup took ${((Date.now() - started) / 1000).toFixed(1)} s`);

    const context: E2eContext = {
      repoRoot,
      runDir,
      backend,
      backendUrl,
      proxyPort: PROXY_PORT,
      agentNode,
      agentEntry,
      agentVersion,
      fixturesDir: path.join(agentDir, 'test', 'fixtures', 'claude'),
    };
    project.provide('e2e', context);
  } catch (err) {
    await stopServer();
    if (runDir !== null) rmSync(runDir, { recursive: true, force: true });
    throw err;
  }

  return async () => {
    await stopServer();
    if (runDir !== null && process.env.E2E_KEEP !== '1') {
      rmSync(runDir, { recursive: true, force: true });
    }
  };
}
